import { randomUUID } from "node:crypto";
import type { Config } from "./config.js";
import { TestLinkMcpError, toSafeError } from "./errors.js";
import { asArray, normalizeTestCase, sanitizeAttachment } from "./normalize.js";
import { OperationManager, snapshotHash } from "./operations.js";
import { paginate } from "./pagination.js";
import { redact } from "./redaction.js";
import type { Gateway, JsonObject, McpResult, NormalizedTestCase } from "./types.js";

function value<T>(object: JsonObject, key: string, fallback: T): T {
  return (object[key] as T | undefined) ?? fallback;
}

function toCaseParams(testCase: NormalizedTestCase): JsonObject {
  return {
    ...(testCase.id ? { testcaseid: testCase.id } : {}),
    testcasename: testCase.name,
    ...(testCase.suiteId ? { testsuiteid: testCase.suiteId } : {}),
    ...(testCase.summary ? { summary: testCase.summary } : {}),
    ...(testCase.preconditions ? { preconditions: testCase.preconditions } : {}),
    ...(testCase.importance ? { importance: testCase.importance } : {}),
    ...(testCase.executionType ? { executiontype: testCase.executionType } : {}),
    steps: testCase.steps.map((step) => ({
      step_number: step.number,
      actions: step.actions,
      expected_results: step.expectedResults,
      ...(step.executionType ? { execution_type: step.executionType } : {}),
    })),
    testcase: testCase,
  };
}

export class TestLinkService {
  readonly operations: OperationManager;
  constructor(readonly gateway: Gateway, readonly config: Config, operations?: OperationManager) {
    this.operations = operations ?? new OperationManager(config.ledgerPath);
  }

  async execute(name: string, args: JsonObject): Promise<McpResult> {
    const requestId = randomUUID();
    try {
      const data = await this.dispatch(name, args);
      const nextCursor = data && typeof data === "object" && "nextCursor" in data ? (data as { nextCursor?: string }).nextCursor : undefined;
      const previewExpiresAt = data && typeof data === "object" && "expiresAt" in data ? String((data as { expiresAt: unknown }).expiresAt) : undefined;
      return {
        ok: true,
        data,
        meta: {
          source: name === "testlink_get_server_capabilities" && (!this.config.demoMode && (!this.config.url || !this.config.devKey)) ? "local" : this.gateway.source,
          requestId,
          ...(nextCursor ? { nextCursor } : {}),
          ...(previewExpiresAt ? { previewExpiresAt } : {}),
        },
      };
    } catch (error) {
      const safe = toSafeError(error);
      return {
        ok: false,
        error: {
          code: safe.code,
          message: String(redact(safe.message, [this.config.devKey ?? ""])),
          retryable: safe.retryable,
          ...(safe.details !== undefined ? { details: redact(safe.details, [this.config.devKey ?? ""]) } : {}),
        },
        meta: { source: this.gateway.source, requestId },
      };
    }
  }

  private async dispatch(name: string, args: JsonObject): Promise<unknown> {
    switch (name) {
      case "testlink_get_server_capabilities": return this.capabilities();
      case "testlink_list_projects": return this.list("getProjects", {}, args, { tool: name });
      case "testlink_list_test_plans": return this.list("getProjectTestPlans", { testprojectid: args.projectId }, args, { tool: name, projectId: args.projectId });
      case "testlink_list_builds": return this.list("getBuildsForTestPlan", { testplanid: args.testPlanId }, args, { tool: name, testPlanId: args.testPlanId });
      case "testlink_list_test_suites": return this.listSuites(args);
      case "testlink_search_test_cases": return this.search(args);
      case "testlink_get_test_case": return this.getCase(args);
      case "testlink_list_test_case_attachments": return this.attachments(args);
      case "testlink_get_traceability": return this.traceability(args);
      case "testlink_get_execution_history": return this.executionHistory(args);
      case "testlink_validate_test_case": return this.validate(args);
      case "testlink_preview_test_case_sync": return this.previewCaseSync(args);
      case "testlink_apply_test_case_sync": return this.applyCaseSync(args);
      case "testlink_preview_execution_result": return this.previewExecution(args);
      case "testlink_apply_execution_result": return this.applyExecution(args);
      default: throw new TestLinkMcpError("UNKNOWN_TOOL", `Unknown tool: ${name}`);
    }
  }

  private async capabilities(): Promise<unknown> {
    const configured = this.config.demoMode || Boolean(this.config.url && this.config.devKey);
    let server: unknown;
    if (configured) server = await this.gateway.call("about");
    return {
      configured,
      demoMode: this.config.demoMode,
      writeEnabled: this.config.writeEnabled,
      transport: "stdio",
      compatibility: "TestLink 1.9.20",
      previewTtlSeconds: 600,
      destructiveTools: false,
      supportedWrites: ["test-case create/update", "test-plan membership", "execution result"],
      ...(server !== undefined ? { server } : {}),
      configurationHint: configured ? undefined : "Set TESTLINK_URL and TESTLINK_DEV_KEY, or TESTLINK_DEMO_MODE=true.",
    };
  }

  private async list(method: string, params: JsonObject, args: JsonObject, scope: unknown): Promise<unknown> {
    const items = asArray(await this.gateway.call(method, params));
    return paginate(items, Number(args.limit ?? 50), args.cursor ? String(args.cursor) : undefined, scope);
  }

  private async listSuites(args: JsonObject): Promise<unknown> {
    const parentId = args.parentId ? String(args.parentId) : undefined;
    const method = parentId ? "getTestSuitesForTestSuite" : "getFirstLevelTestSuitesForTestProject";
    const params = parentId ? { testsuiteid: parentId } : { testprojectid: args.projectId };
    return this.list(method, params, args, { tool: "suites", ...params });
  }

  private async collectSuiteCases(suiteId: string, depth: number, seen = new Set<string>()): Promise<NormalizedTestCase[]> {
    if (seen.has(suiteId)) return [];
    seen.add(suiteId);
    const own = asArray(await this.gateway.call("getTestCasesForTestSuite", { testsuiteid: suiteId, deep: false, details: "full" })).map(normalizeTestCase);
    if (depth <= 0) return own;
    const children = asArray(await this.gateway.call("getTestSuitesForTestSuite", { testsuiteid: suiteId }));
    for (const child of children) own.push(...await this.collectSuiteCases(String(child.id), depth - 1, seen));
    return own;
  }

  private async search(args: JsonObject): Promise<unknown> {
    let cases: NormalizedTestCase[] = [];
    if (args.externalId) {
      try { cases = [await this.fetchCase({ externalId: String(args.externalId) })]; } catch (error) {
        if (error instanceof TestLinkMcpError && error.code === "NOT_FOUND") cases = []; else throw error;
      }
    } else if (args.testPlanId) {
      cases = asArray(await this.gateway.call("getTestCasesForTestPlan", {
        testplanid: args.testPlanId,
        details: "full",
        getstepsinfo: true,
      })).map(normalizeTestCase);
    } else if (args.testSuiteId) {
      cases = await this.collectSuiteCases(String(args.testSuiteId), Number(args.depth ?? 3));
    } else if (args.projectId) {
      const roots = asArray(await this.gateway.call("getFirstLevelTestSuitesForTestProject", { testprojectid: args.projectId }));
      for (const root of roots) cases.push(...await this.collectSuiteCases(String(root.id), Number(args.depth ?? 3)));
    } else {
      throw new TestLinkMcpError("INVALID_ARGUMENT", "Provide projectId, testSuiteId, or externalId.");
    }
    const query = String(args.query ?? "").trim().toLowerCase();
    const status = String(args.status ?? "").trim().toLowerCase();
    cases = cases.filter((item) => (!query || JSON.stringify(item).toLowerCase().includes(query)) && (!status || item.status?.toLowerCase() === status));
    return paginate(cases, Number(args.limit ?? 50), args.cursor ? String(args.cursor) : undefined, { tool: "search", ...args, cursor: undefined, limit: undefined });
  }

  private async fetchCase(locator: { id?: string; externalId?: string }): Promise<NormalizedTestCase> {
    if (!locator.id && !locator.externalId) throw new TestLinkMcpError("INVALID_ARGUMENT", "Provide testCaseId or externalId.");
    const raw = await this.gateway.call("getTestCase", locator.id ? { testcaseid: locator.id } : { testcaseexternalid: locator.externalId });
    const first = asArray(raw)[0];
    if (!first) throw new TestLinkMcpError("NOT_FOUND", "Test case was not found.");
    return normalizeTestCase(first);
  }

  private getCase(args: JsonObject): Promise<NormalizedTestCase> {
    return this.fetchCase({ ...(args.testCaseId ? { id: String(args.testCaseId) } : {}), ...(args.externalId ? { externalId: String(args.externalId) } : {}) });
  }

  private async attachments(args: JsonObject): Promise<unknown> {
    const rows = asArray(await this.gateway.call("getTestCaseAttachments", { testcaseid: args.testCaseId })).map(sanitizeAttachment);
    return paginate(rows, Number(args.limit ?? 50), args.cursor ? String(args.cursor) : undefined, { tool: "attachments", testCaseId: args.testCaseId });
  }

  private async traceability(args: JsonObject): Promise<unknown> {
    if (this.gateway.source === "demo") return this.gateway.call("getTestCaseTraceability", { testcaseid: args.testCaseId, testplanid: args.testPlanId });
    const [requirements, plans] = await Promise.all([
      this.gateway.call("getReqCoverage", { testcaseid: args.testCaseId }),
      this.gateway.call("getTestPlansOfTestCase", { testcaseid: args.testCaseId }),
    ]);
    return { requirements: asArray(requirements), plans: asArray(plans) };
  }

  private async executionHistory(args: JsonObject): Promise<unknown> {
    const method = this.gateway.source === "demo" ? "getExecutionHistory" : "getLastExecutionResult";
    const rows = asArray(await this.gateway.call(method, { testcaseid: args.testCaseId, testplanid: args.testPlanId }));
    return paginate(rows, Number(args.limit ?? 50), args.cursor ? String(args.cursor) : undefined, { tool: "history", testCaseId: args.testCaseId, testPlanId: args.testPlanId });
  }

  private async validate(args: JsonObject): Promise<unknown> {
    const testCase = args.testCase && typeof args.testCase === "object"
      ? normalizeTestCase(args.testCase as JsonObject)
      : await this.fetchCase({ ...(args.testCaseId ? { id: String(args.testCaseId) } : {}), ...(args.externalId ? { externalId: String(args.externalId) } : {}) });
    const findings: JsonObject[] = [];
    if (testCase.name.trim().length < 5) findings.push({ severity: "error", field: "name", message: "Use a specific test case name of at least five characters." });
    if (!testCase.summary) findings.push({ severity: "warning", field: "summary", message: "Add intent and scope for AI retrieval." });
    if (testCase.steps.length === 0) findings.push({ severity: "error", field: "steps", message: "At least one executable step is required." });
    testCase.steps.forEach((step, index) => {
      if (!step.actions.trim()) findings.push({ severity: "error", field: `steps[${index}].actions`, message: "Step action is empty." });
      if (!step.expectedResults.trim()) findings.push({ severity: "error", field: `steps[${index}].expectedResults`, message: "Expected result is empty." });
    });
    if (!testCase.importance) findings.push({ severity: "info", field: "importance", message: "Set importance to improve prioritization." });
    return { valid: !findings.some((item) => item.severity === "error"), findings, normalizedTestCase: testCase };
  }

  private async previewCaseSync(args: JsonObject): Promise<unknown> {
    const desired = normalizeTestCase(value(args, "desiredCase", {}) as JsonObject);
    const validation = await this.validate({ testCase: desired }) as { valid: boolean; findings: JsonObject[] };
    if (!validation.valid) throw new TestLinkMcpError("VALIDATION_FAILED", "Desired test case has blocking validation findings.", false, validation.findings);
    let current: NormalizedTestCase | null = null;
    const locator = value(args, "testCaseId", undefined) ?? desired.id ?? desired.externalId;
    if (locator) {
      try { current = await this.fetchCase(desired.id || args.testCaseId ? { id: String(desired.id ?? args.testCaseId) } : { externalId: String(desired.externalId) }); }
      catch (error) { if (!(error instanceof TestLinkMcpError && error.code === "NOT_FOUND")) throw error; }
    }
    const action = current ? "update" : "create";
    return this.operations.create("test_case_sync", current, {
      action,
      desiredCase: desired,
      currentCaseId: current?.id,
      testProjectId: args.testProjectId,
      testPlanIds: Array.isArray(args.testPlanIds) ? args.testPlanIds : [],
    }, { action, before: current, after: desired, planMemberships: args.testPlanIds ?? [] });
  }

  private async applyCaseSync(args: JsonObject): Promise<unknown> {
    this.requireWrites();
    const preview = this.operations.require(String(args.previewId), "test_case_sync", args.confirm === true);
    const payload = preview.payload;
    const desired = payload.desiredCase as NormalizedTestCase;
    const currentId = payload.currentCaseId ? String(payload.currentCaseId) : undefined;
    const current = currentId ? await this.fetchCase({ id: currentId }) : null;
    if (snapshotHash(current) !== preview.snapshotHash) {
      await this.operations.record(preview, "conflict", { reason: "state_changed" });
      throw new TestLinkMcpError("CONFLICT", "Test case changed after preview. Create a new preview.");
    }
    try {
      const action = String(payload.action);
      const result = action === "update"
        ? await this.gateway.call("updateTestCase", { ...toCaseParams(desired), testcaseid: currentId })
        : await this.gateway.call("createTestCase", { ...toCaseParams(desired), testprojectid: payload.testProjectId });
      const resolvedId = currentId ?? String(asArray(result)[0]?.id ?? "");
      const memberships = [];
      for (const planId of payload.testPlanIds as unknown[] ?? []) {
        memberships.push(await this.gateway.call("addTestCaseToTestPlan", { testprojectid: payload.testProjectId, testplanid: planId, testcaseexternalid: desired.externalId, testcaseid: resolvedId, version: desired.version ?? 1 }));
      }
      const output = { action, testCaseId: resolvedId, result, memberships };
      await this.operations.record(preview, "applied", output);
      return output;
    } catch (error) {
      await this.operations.record(preview, "failed", { code: toSafeError(error).code });
      throw error;
    }
  }

  private async previewExecution(args: JsonObject): Promise<unknown> {
    const status = String(args.status ?? "").toLowerCase();
    if (!["passed", "failed", "blocked"].includes(status)) throw new TestLinkMcpError("INVALID_ARGUMENT", "status must be passed, failed, or blocked.");
    const prior = await this.executionHistory({ testCaseId: args.testCaseId, testPlanId: args.testPlanId, limit: 1 });
    return this.operations.create("execution_result", prior, {
      testcaseid: args.testCaseId,
      testplanid: args.testPlanId,
      buildid: args.buildId,
      status,
      notes: args.notes,
      platformname: args.platformName,
    }, { previous: prior, proposed: args });
  }

  private async applyExecution(args: JsonObject): Promise<unknown> {
    this.requireWrites();
    const preview = this.operations.require(String(args.previewId), "execution_result", args.confirm === true);
    const prior = await this.executionHistory({ testCaseId: preview.payload.testcaseid, testPlanId: preview.payload.testplanid, limit: 1 });
    if (snapshotHash(prior) !== preview.snapshotHash) {
      await this.operations.record(preview, "conflict", { reason: "execution_changed" });
      throw new TestLinkMcpError("CONFLICT", "Execution state changed after preview. Create a new preview.");
    }
    const statusMap: Record<string, string> = { passed: "p", failed: "f", blocked: "b" };
    try {
      const result = await this.gateway.call("reportTCResult", { ...preview.payload, status: statusMap[String(preview.payload.status)] });
      await this.operations.record(preview, "applied", result);
      return result;
    } catch (error) {
      await this.operations.record(preview, "failed", { code: toSafeError(error).code });
      throw error;
    }
  }

  private requireWrites(): void {
    if (!this.config.writeEnabled) throw new TestLinkMcpError("WRITE_DISABLED", "Writes are disabled. Set TESTLINK_WRITE_ENABLED=true and restart.");
  }
}
