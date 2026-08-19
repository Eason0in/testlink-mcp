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
  const requestBodies = new Map<string, string>();

  beforeEach(async () => {
    calls.length = 0;
    requestBodies.clear();
    server = createServer((request, response) => {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => { body += chunk; });
      request.on("end", () => {
        const method = body.match(/<methodName>tl\.([^<]+)<\/methodName>/)?.[1] ?? "";
        calls.push(method);
        requestBodies.set(method, body);
        const fixtures: Record<string, unknown> = {
          about: "TestLink 1.9.20 (Raijin)",
          getProjects: [{ id: "1", name: "Public Demo", prefix: "PUB" }],
          getFirstLevelTestSuitesForTestProject: [{ id: "10", name: "Checkout" }],
          getTestCasesForTestSuite: [{ id: "101", full_external_id: "PUB-1", name: "Card payment succeeds", summary: "Happy path", status: "7", importance: "3", steps: [{ step_number: "1", actions: "Submit card", expected_results: "Payment accepted" }] }],
          getTestSuitesForTestSuite: [],
          getTestCaseAttachments: [{ id: "9", file_name: "expected.png", content: "SHOULD_NOT_ESCAPE" }],
          getTestCase: [{ id: "1001", testcase_id: "101", full_tc_external_id: "PUB-1", name: "Card payment succeeds", steps: [] }],
          getTestCaseRequirements: [{ id: "REQ-1", title: "Card payments" }],
          getTestCasesForTestPlan: { 101: { 1001: { testcase_id: "101", tcversion_id: "1001", full_tc_external_id: "PUB-1", name: "Card payment succeeds", summary: "Happy path", steps: [] } } },
          createTestCase: [{ id: "102", status: true, operation: "create" }],
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

  it("uses TestLink 1.9.20 methods for requirement and plan traceability", async () => {
    const config = loadConfig({ TESTLINK_URL: endpoint, TESTLINK_DEV_KEY: "synthetic-dev-key", TESTLINK_REQUEST_TIMEOUT_MS: "1000", TESTLINK_LEDGER_PATH: "/tmp/testlink-mcp-xmlrpc-e2e.jsonl" });
    const gateway = new XmlRpcGateway({ baseUrl: endpoint, devKey: "synthetic-dev-key", timeoutMs: 1000, maxResponseBytes: 1024 * 1024 });
    const service = new TestLinkService(gateway, config);

    expect(await service.execute("testlink_get_traceability", {
      testCaseId: "101",
      testPlanId: "21",
    })).toMatchObject({
      ok: true,
      data: {
        requirements: [{ id: "REQ-1" }],
        plans: [{ id: "21", included: true }],
      },
    });
    expect(calls).toEqual(expect.arrayContaining([
      "getTestCase",
      "getTestCaseRequirements",
      "getTestCasesForTestPlan",
    ]));
    expect(calls).not.toEqual(expect.arrayContaining(["getReqCoverage", "getTestPlansOfTestCase"]));
    expect(requestBodies.get("getTestCaseRequirements")).toContain("<name>testcaseversionid</name><value><string>1001</string></value>");
    expect(requestBodies.get("getTestCasesForTestPlan")).toContain("<name>testcaseid</name><value><string>101</string></value>");
    expect(requestBodies.get("getTestCasesForTestPlan")).toContain("<name>testplanid</name><value><string>21</string></value>");
  });

  it("flattens TestLink's map-of-map test-plan response into normalized cases", async () => {
    const config = loadConfig({ TESTLINK_URL: endpoint, TESTLINK_DEV_KEY: "synthetic-dev-key", TESTLINK_REQUEST_TIMEOUT_MS: "1000", TESTLINK_LEDGER_PATH: "/tmp/testlink-mcp-xmlrpc-plan-search-ledger.jsonl" });
    const gateway = new XmlRpcGateway({ baseUrl: endpoint, devKey: "synthetic-dev-key", timeoutMs: 1000, maxResponseBytes: 1024 * 1024 });
    const service = new TestLinkService(gateway, config);

    expect(await service.execute("testlink_search_test_cases", { testPlanId: "21" })).toMatchObject({
      ok: true,
      data: { items: [{ id: "101", externalId: "PUB-1", name: "Card payment succeeds" }] },
    });
  });

  it("passes an explicit test case version to TestLink", async () => {
    const config = loadConfig({ TESTLINK_URL: endpoint, TESTLINK_DEV_KEY: "synthetic-dev-key", TESTLINK_REQUEST_TIMEOUT_MS: "1000", TESTLINK_LEDGER_PATH: "/tmp/testlink-mcp-xmlrpc-version-ledger.jsonl" });
    const gateway = new XmlRpcGateway({ baseUrl: endpoint, devKey: "synthetic-dev-key", timeoutMs: 1000, maxResponseBytes: 1024 * 1024 });
    const service = new TestLinkService(gateway, config);

    expect(await service.execute("testlink_get_test_case", { testCaseId: "101", version: 2 })).toMatchObject({ ok: true });
    expect(requestBodies.get("getTestCase")).toContain("<name>version</name><value><int>2</int></value>");
  });

  it("sends all TestLink 1.9.20 mandatory create parameters", async () => {
    const config = loadConfig({
      TESTLINK_URL: endpoint,
      TESTLINK_DEV_KEY: "synthetic-dev-key",
      TESTLINK_REQUEST_TIMEOUT_MS: "1000",
      TESTLINK_WRITE_ENABLED: "true",
      TESTLINK_LEDGER_PATH: "/tmp/testlink-mcp-xmlrpc-create-ledger.jsonl",
    });
    const gateway = new XmlRpcGateway({ baseUrl: endpoint, devKey: "synthetic-dev-key", timeoutMs: 1000, maxResponseBytes: 1024 * 1024 });
    const service = new TestLinkService(gateway, config);
    const preview = await service.execute("testlink_preview_test_case_sync", {
      testProjectId: "1",
      authorLogin: "api-user",
      desiredCase: {
        name: "New payment case",
        summary: "Verify a new payment path.",
        suiteId: "10",
        steps: [{ number: 1, actions: "Submit payment", expectedResults: "Payment succeeds" }],
      },
    });
    const applied = await service.execute("testlink_apply_test_case_sync", {
      previewId: (preview.data as { id: string }).id,
      confirm: true,
    });

    expect(applied).toMatchObject({ ok: true, data: { action: "create", testCaseId: "102" } });
    const body = requestBodies.get("createTestCase");
    expect(body).toContain("<name>authorlogin</name><value><string>api-user</string></value>");
    expect(body).toContain("<name>testprojectid</name><value><string>1</string></value>");
    expect(body).toContain("<name>testsuiteid</name><value><string>10</string></value>");
    expect(body).toContain("<name>testcasename</name><value><string>New payment case</string></value>");
    expect(body).toContain("<name>summary</name><value><string>Verify a new payment path.</string></value>");
  });
});
