import { createServer, type Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";
import { TestLinkService } from "../../src/service.js";
import { encodeXmlRpcValue, XmlRpcGateway } from "../../src/xmlrpc.js";

function xml(value: unknown): string {
  return `<?xml version="1.0"?><methodResponse><params><param>${encodeXmlRpcValue(value)}</param></params></methodResponse>`;
}

describe("TestLink 1.9.20 XML-RPC fixture E2E", () => {
  let server: Server;
  let endpoint: string;
  const calls: string[] = [];

  beforeEach(async () => {
    server = createServer((request, response) => {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => { body += chunk; });
      request.on("end", () => {
        const method = body.match(/<methodName>tl\.([^<]+)<\/methodName>/)?.[1] ?? "";
        calls.push(method);
        const fixtures: Record<string, unknown> = {
          about: "TestLink 1.9.20 (Raijin)",
          getProjects: [{ id: "1", name: "Public Demo", prefix: "PUB" }],
          getFirstLevelTestSuitesForTestProject: [{ id: "10", name: "Checkout" }],
          getTestCasesForTestSuite: [{ id: "101", full_external_id: "PUB-1", name: "Card payment succeeds", summary: "Happy path", status: "7", importance: "3", steps: [{ step_number: "1", actions: "Submit card", expected_results: "Payment accepted" }] }],
          getTestSuitesForTestSuite: [],
          getTestCaseAttachments: [{ id: "9", file_name: "expected.png", content: "SHOULD_NOT_ESCAPE" }],
        };
        response.writeHead(200, { "content-type": "text/xml" });
        response.end(xml(fixtures[method] ?? []));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("fixture server did not bind");
    endpoint = `http://127.0.0.1:${address.port}/lib/api/xmlrpc/v1/xmlrpc.php`;
  });

  afterEach(async () => { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); });

  it("performs discovery, search, and safe attachment reads over HTTP", async () => {
    const config = loadConfig({ TESTLINK_URL: endpoint, TESTLINK_DEV_KEY: "synthetic-dev-key", TESTLINK_REQUEST_TIMEOUT_MS: "1000", TESTLINK_LEDGER_PATH: "/tmp/testlink-mcp-xmlrpc-e2e.jsonl" });
    const gateway = new XmlRpcGateway({ baseUrl: endpoint, devKey: "synthetic-dev-key", timeoutMs: 1000, maxResponseBytes: 1024 * 1024 });
    const service = new TestLinkService(gateway, config);
    expect(await service.execute("testlink_get_server_capabilities", {})).toMatchObject({ ok: true, data: { compatibility: "TestLink 1.9.20" } });
    expect(await service.execute("testlink_list_projects", {})).toMatchObject({ ok: true, data: { items: [{ name: "Public Demo" }] } });
    expect(await service.execute("testlink_search_test_cases", { projectId: "1", query: "card" })).toMatchObject({ ok: true, data: { total: 1, items: [{ externalId: "PUB-1" }] } });
    const attachments = await service.execute("testlink_list_test_case_attachments", { testCaseId: "101" });
    expect(JSON.stringify(attachments)).not.toContain("SHOULD_NOT_ESCAPE");
    expect(calls).toEqual(expect.arrayContaining(["about", "getProjects", "getFirstLevelTestSuitesForTestProject", "getTestCasesForTestSuite", "getTestCaseAttachments"]));
  });
});
