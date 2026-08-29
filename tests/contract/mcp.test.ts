import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";
import { createServer } from "../../src/server.js";

const closeables: Array<{ close(): Promise<void> }> = [];
afterEach(async () => { while (closeables.length) await closeables.pop()?.close(); });

async function connected(env: NodeJS.ProcessEnv) {
  const config = loadConfig(env);
  const { server } = createServer(config);
  const client = new Client({ name: "contract-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  closeables.push(client, server);
  return client;
}

describe("MCP contract", () => {
  it("starts without credentials and exposes schemas", async () => {
    const client = await connected({ TESTLINK_LEDGER_PATH: "/tmp/testlink-mcp-contract.jsonl" });
    expect(client.getServerVersion()).toEqual({ name: "testlink-mcp", version: "1.0.8" });
    const tools = await client.listTools();
    expect(tools.tools).toHaveLength(15);
    expect(tools.tools.every((item) => item.outputSchema?.type === "object")).toBe(true);
    expect(tools.tools.filter((item) => item.name.includes("apply")).every((item) => item.annotations?.readOnlyHint === false)).toBe(true);
    const result = await client.callTool({ name: "testlink_get_server_capabilities", arguments: {} });
    expect(result.structuredContent).toMatchObject({ ok: true, data: { configured: false }, meta: { source: "local" } });
  });
  it("covers every exposed tool and declares all safety annotations", async () => {
    const client = await connected({ TESTLINK_DEMO_MODE: "true", TESTLINK_LEDGER_PATH: "/tmp/testlink-mcp-contract.jsonl" });
    const tools = await client.listTools();
    const expectedTools = [
      "testlink_get_server_capabilities",
      "testlink_list_projects",
      "testlink_list_test_plans",
      "testlink_list_builds",
      "testlink_list_test_suites",
      "testlink_search_test_cases",
      "testlink_get_test_case",
      "testlink_list_test_case_attachments",
      "testlink_get_traceability",
      "testlink_get_execution_history",
      "testlink_validate_test_case",
      "testlink_preview_test_case_sync",
      "testlink_apply_test_case_sync",
      "testlink_preview_execution_result",
      "testlink_apply_execution_result",
    ];

    expect(tools.tools.map((tool) => tool.name)).toEqual(expectedTools);
    expect(tools.tools.every((tool) => {
      const annotations = tool.annotations;
      return annotations
        && typeof annotations.readOnlyHint === "boolean"
        && typeof annotations.destructiveHint === "boolean"
        && typeof annotations.idempotentHint === "boolean"
        && typeof annotations.openWorldHint === "boolean";
    })).toBe(true);
    expect(tools.tools.filter((tool) => tool.name.includes("apply")).every((tool) => (
      tool.annotations?.readOnlyHint === false
      && tool.annotations?.destructiveHint === false
      && tool.annotations?.idempotentHint === false
      && tool.annotations?.openWorldHint === true
    ))).toBe(true);
  });
  it("exercises the remaining exploration and history tools in demo mode", async () => {
    const client = await connected({ TESTLINK_DEMO_MODE: "true", TESTLINK_LEDGER_PATH: "/tmp/testlink-mcp-contract.jsonl" });
    const requests = [
      { name: "testlink_list_test_plans", arguments: { projectId: "1" } },
      { name: "testlink_list_builds", arguments: { testPlanId: "21" } },
      { name: "testlink_list_test_suites", arguments: { projectId: "1" } },
      { name: "testlink_get_execution_history", arguments: { testCaseId: "101" } },
    ] as const;

    for (const request of requests) {
      expect((await client.callTool(request)).structuredContent).toMatchObject({ ok: true });
    }
  });
  it("lists resources and prompts", async () => {
    const client = await connected({ TESTLINK_DEMO_MODE: "true", TESTLINK_LEDGER_PATH: "/tmp/testlink-mcp-contract.jsonl" });
    expect((await client.listResources()).resources).toHaveLength(3);
    expect((await client.listPrompts()).prompts).toHaveLength(3);
    expect((await client.readResource({ uri: "testlink://guide/safety" })).contents[0]).toMatchObject({ mimeType: "text/markdown" });
    expect((await client.getPrompt({ name: "testlink-sync-test-case", arguments: { testProjectId: "1", intent: "add sign-in coverage" } })).messages[0]?.content).toMatchObject({ type: "text" });
  });
  it("returns structured demo output and never attachment content", async () => {
    const client = await connected({ TESTLINK_DEMO_MODE: "true", TESTLINK_LEDGER_PATH: "/tmp/testlink-mcp-contract.jsonl" });
    const projects = await client.callTool({ name: "testlink_list_projects", arguments: { limit: 1 } });
    expect(projects.structuredContent).toMatchObject({ ok: true, data: { total: 1 }, meta: { source: "demo" } });
    const attachments = await client.callTool({ name: "testlink_list_test_case_attachments", arguments: { testCaseId: "101" } });
    expect(JSON.stringify(attachments.structuredContent)).not.toMatch(/base64|fileContent|AAAA/);
  });
});
