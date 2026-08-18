import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";
import { DemoGateway } from "../../src/demo.js";
import { OperationManager } from "../../src/operations.js";
import { TestLinkService } from "../../src/service.js";

async function fixture(writeEnabled = true) {
  const directory = await mkdtemp(join(tmpdir(), "testlink-mcp-e2e-"));
  const config = loadConfig({ TESTLINK_DEMO_MODE: "true", TESTLINK_WRITE_ENABLED: String(writeEnabled), TESTLINK_LEDGER_PATH: join(directory, "ledger.jsonl") });
  const gateway = new DemoGateway();
  return { directory, config, gateway, service: new TestLinkService(gateway, config) };
}

const desiredCase = {
  externalId: "DEMO-3",
  name: "Locked user cannot sign in",
  summary: "Verify lockout enforcement.",
  importance: "high",
  suiteId: "11",
  steps: [{ number: 1, actions: "Submit valid credentials for a locked user.", expectedResults: "Sign in is rejected without revealing account state." }],
};

describe("TestLink 1.9.20 demo E2E", () => {
  it("searches, gets traceability, and validates cases", async () => {
    const { service } = await fixture();
    const search = await service.execute("testlink_search_test_cases", { projectId: "1", query: "invalid password" });
    expect(search).toMatchObject({ ok: true, data: { total: 1 } });
    expect(await service.execute("testlink_search_test_cases", { testPlanId: "21", query: "sign in" })).toMatchObject({ ok: true, data: { total: 2 } });
    expect(await service.execute("testlink_get_traceability", { testCaseId: "101" })).toMatchObject({ ok: true, data: { requirements: [{ id: "REQ-1" }] } });
    expect(await service.execute("testlink_validate_test_case", { testCaseId: "101" })).toMatchObject({ ok: true, data: { valid: true } });
  });

  it("previews and applies a test case plus plan membership", async () => {
    const { service, config } = await fixture();
    const preview = await service.execute("testlink_preview_test_case_sync", { testProjectId: "1", desiredCase, testPlanIds: ["21"] });
    expect(preview).toMatchObject({ ok: true, data: { kind: "test_case_sync", proposedChanges: { action: "create" } } });
    const previewId = (preview.data as { id: string }).id;
    const applied = await service.execute("testlink_apply_test_case_sync", { previewId, confirm: true });
    expect(applied).toMatchObject({ ok: true, data: { action: "create", memberships: [{ 0: { status: true } }] } });
    const ledger = await readFile(config.ledgerPath, "utf8");
    expect(ledger).toContain('"outcome":"applied"');
    expect(ledger).not.toContain("your-testlink-dev-key");
  });

  it("previews and applies an execution result", async () => {
    const { service, gateway } = await fixture();
    const preview = await service.execute("testlink_preview_execution_result", { testCaseId: "101", testPlanId: "21", buildId: "31", status: "passed", notes: "Automated checks passed." });
    const applied = await service.execute("testlink_apply_execution_result", { previewId: (preview.data as { id: string }).id, confirm: true });
    expect(applied.ok).toBe(true);
    expect(gateway.executions).toHaveLength(1);
    expect(gateway.executions[0]).toMatchObject({ status: "p" });
  });

  it("blocks writes by default and requires explicit confirmation", async () => {
    const disabled = await fixture(false);
    const preview = await disabled.service.execute("testlink_preview_test_case_sync", { testProjectId: "1", desiredCase });
    expect(await disabled.service.execute("testlink_apply_test_case_sync", { previewId: (preview.data as { id: string }).id, confirm: true })).toMatchObject({ ok: false, error: { code: "WRITE_DISABLED" } });
    const enabled = await fixture(true);
    const second = await enabled.service.execute("testlink_preview_test_case_sync", { testProjectId: "1", desiredCase });
    expect(await enabled.service.execute("testlink_apply_test_case_sync", { previewId: (second.data as { id: string }).id, confirm: false })).toMatchObject({ ok: false, error: { code: "CONFIRMATION_REQUIRED" } });
  });

  it("detects state conflicts between preview and apply", async () => {
    const { service, gateway } = await fixture();
    const current = gateway.cases[0]!;
    const preview = await service.execute("testlink_preview_test_case_sync", { testProjectId: "1", testCaseId: current.id, desiredCase: { ...current, summary: "Proposed summary" } });
    await gateway.call("updateTestCase", { testcaseid: current.id, testcase: { summary: "Concurrent edit" } });
    expect(await service.execute("testlink_apply_test_case_sync", { previewId: (preview.data as { id: string }).id, confirm: true })).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
  });

  it("expires previews after ten minutes", async () => {
    const { config, gateway, directory } = await fixture();
    let now = new Date("2026-08-18T00:00:00Z");
    const operations = new OperationManager(join(directory, "expiry-ledger.jsonl"), () => now);
    const service = new TestLinkService(gateway, config, operations);
    const preview = await service.execute("testlink_preview_test_case_sync", { testProjectId: "1", desiredCase });
    now = new Date("2026-08-18T00:10:01Z");
    expect(await service.execute("testlink_apply_test_case_sync", { previewId: (preview.data as { id: string }).id, confirm: true })).toMatchObject({ ok: false, error: { code: "PREVIEW_EXPIRED" } });
  });
});
