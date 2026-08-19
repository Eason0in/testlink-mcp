import { randomUUID } from "node:crypto";
import type { Config } from "./config.js";
import { TestLinkMcpError, toSafeError } from "./errors.js";
import { asArray, normalizeTestCase, sanitizeAttachment } from "./normalize.js";
import { OperationManager, snapshotHash, type Preview } from "./operations.js";
import { paginate } from "./pagination.js";
import { redact } from "./redaction.js";
import type { Gateway, JsonObject, McpResult, NormalizedTestCase } from "./types.js";

function value<T>(object: JsonObject, key: string, fallback: T): T {
  return (object[key] as T | undefined) ?? fallback;
}

function toCaseParams(testCase: NormalizedTestCase, authorLogin?: string): JsonObject {
  return {
    ...(testCase.id ? { testcaseid: testCase.id } : {}),
    testcasename: testCase.name,
    ...(testCase.suiteId ? { testsuiteid: testCase.suiteId } : {}),
    ...(testCase.summary ? { summary: testCase.summary } : {}),
    ...(testCase.preconditions ? { preconditions: testCase.preconditions } : {}),
    ...(testCase.importance ? { importance: testCase.importance } : {}),
    ...(testCase.executionType ? { executiontype: testCase.executionType } : {}),
    ...(authorLogin ? { authorlogin: authorLogin } : {}),
    steps: testCase.steps.map((step) => ({
      step_number: step.number,
      actions: step.actions,
      expected_results: step.expectedResults,
      ...(step.executionType ? { execution_type: step.executionType } : {}),
    })),
    testcase: testCase,
  };
}

function asTestCaseArray(value: unknown): JsonObject[] {
  const cases: JsonObject[] = [];
  const visit = (item: unknown): void => {
    if (!item || typeof item !== "object") return;
    if (Array.isArray(item)) {
      item.forEach(visit);
      return;
    }
    const object = item as JsonObject;
    if ("id" in object || "name" in object || "testcase_id" in object) {
      cases.push(object);
      return;
    }
    Object.values(object).forEach(visit);
  };
  visit(value);
  return cases;
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
      cases = asTestCaseArray(await this.gateway.call("getTestCasesForTestPlan", {
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

  private async fetchCase(locator: { id?: string; externalId?: string; version?: number }): Promise<NormalizedTestCase> {
    if (!locator.id && !locator.externalId) throw new TestLinkMcpError("INVALID_ARGUMENT", "Provide testCaseId or externalId.");
    const raw = await this.gateway.call("getTestCase", {
      ...(locator.id ? { testcaseid: locator.id } : { testcaseexternalid: locator.externalId }),
      ...(locator.version !== undefined ? { version: locator.version } : {}),
    });
    const first = asArray(raw)[0];
    if (!first) throw new TestLinkMcpError("NOT_FOUND", "Test case was not found.");
    return normalizeTestCase(first);
  }

  private getCase(args: JsonObject): Promise<NormalizedTestCase> {
    return this.fetchCase({
      ...(args.testCaseId ? { id: String(args.testCaseId) } : {}),
      ...(args.externalId ? { externalId: String(args.externalId) } : {}),
      ...(args.version !== undefined ? { version: Number(args.version) } : {}),
    });
  }

  private async attachments(args: JsonObject): Promise<unknown> {
    const rows = asArray(await this.gateway.call("getTestCaseAttachments", { testcaseid: args.testCaseId })).map(sanitizeAttachment);
    return paginate(rows, Number(args.limit ?? 50), args.cursor ? String(args.cursor) : undefined, { tool: "attachments", testCaseId: args.testCaseId });
  }

  private async traceability(args: JsonObject): Promise<unknown> {
    if (!args.testPlanId) {
      throw new TestLinkMcpError("INVALID_ARGUMENT", "testPlanId is required to verify traceability against a specific test plan.");
    }
    if (this.gateway.source === "demo") return this.gateway.call("getTestCaseTraceability", { testcaseid: args.testCaseId, testplanid: args.testPlanId });
    const rawCase = asArray(await this.gateway.call("getTestCase", {
      testcaseid: args.testCaseId,
    }))[0];
    const versionId = rawCase?.id ?? rawCase?.tcversion_id ?? rawCase?.testcaseversionid;
    if (!versionId) {
      throw new TestLinkMcpError(
        "UNSUPPORTED_RESPONSE",
        "TestLink did not return the test case version ID required for requirement traceability.",
      );
    }
    const requirements = await this.gateway.call("getTestCaseRequirements", {
      testcaseversionid: versionId,
    });
    const linkedCases = asArray(await this.gateway.call("getTestCasesForTestPlan", {
      testplanid: args.testPlanId,
      testcaseid: args.testCaseId,
      details: "simple",
    }));
    const plans = [{ id: String(args.testPlanId), included: linkedCases.length > 0 }];
    return { requirements: asArray(requirements), plans };
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
    const authorLogin = String(args.authorLogin ?? "").trim();
    if (action === "create" && !authorLogin) {
      throw new TestLinkMcpError(
        "INVALID_ARGUMENT",
        "authorLogin is required when creating a TestLink test case.",
      );
    }
    if (action === "create" && !desired.suiteId) {
      throw new TestLinkMcpError(
        "INVALID_ARGUMENT",
        "desiredCase.suiteId is required when creating a TestLink test case.",
      );
    }
    if (action === "create" && !desired.summary) {
      throw new TestLinkMcpError(
        "INVALID_ARGUMENT",
        "desiredCase.summary is required when creating a TestLink test case.",
      );
    }
    return this.operations.create("test_case_sync", current, {
      action,
      desiredCase: desired,
      ...(action === "create" ? { authorLogin } : {}),
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
    let current: NormalizedTestCase | null;
    try {
      current = currentId ? await this.fetchCase({ id: currentId }) : null;
    } catch (error) {
      await this.recordPreflightFailure(preview, error);
      throw error;
    }
    if (snapshotHash(current) !== preview.snapshotHash) {
      await this.operations.record(preview, "conflict", { reason: "state_changed" });
      throw new TestLinkMcpError("CONFLICT", "Test case changed after preview. Create a new preview.");
    }
    const action = String(payload.action);
    await this.recordAttempt(preview, { action });
    let output: unknown;
    try {
      const result = action === "update"
        ? await this.gateway.call("updateTestCase", { ...toCaseParams(desired), testcaseid: currentId })
        : await this.gateway.call("createTestCase", {
          ...toCaseParams(desired, String(payload.authorLogin)),
          testprojectid: payload.testProjectId,
        });
      const resolvedId = currentId ?? String(asArray(result)[0]?.id ?? "");
      const memberships = [];
      for (const planId of payload.testPlanIds as unknown[] ?? []) {
        memberships.push(await this.gateway.call("addTestCaseToTestPlan", { testprojectid: payload.testProjectId, testplanid: planId, testcaseexternalid: desired.externalId, testcaseid: resolvedId, version: desired.version ?? 1 }));
      }
      output = { action, testCaseId: resolvedId, result, memberships };
    } catch (error) {
      return this.throwOutcomeUnknown(preview, error);
    }
    try {
      await this.operations.record(preview, "applied", output);
    } catch (error) {
      return this.throwOutcomeUnknown(preview, error);
    }
    return output;
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
    let prior: unknown;
    try {
      prior = await this.executionHistory({ testCaseId: preview.payload.testcaseid, testPlanId: preview.payload.testplanid, limit: 1 });
    } catch (error) {
      await this.recordPreflightFailure(preview, error);
      throw error;
    }
    if (snapshotHash(prior) !== preview.snapshotHash) {
      await this.operations.record(preview, "conflict", { reason: "execution_changed" });
      throw new TestLinkMcpError("CONFLICT", "Execution state changed after preview. Create a new preview.");
    }
    const statusMap: Record<string, string> = { passed: "p", failed: "f", blocked: "b" };
    await this.recordAttempt(preview, { action: "report_execution_result" });
    let result: unknown;
    try {
      result = await this.gateway.call("reportTCResult", { ...preview.payload, status: statusMap[String(preview.payload.status)] });
    } catch (error) {
      return this.throwOutcomeUnknown(preview, error);
    }
    try {
      await this.operations.record(preview, "applied", result);
    } catch (error) {
      return this.throwOutcomeUnknown(preview, error);
    }
    return result;
  }

  private async recordAttempt(preview: Preview, result: unknown): Promise<void> {
    try {
      await this.operations.record(preview, "attempted", result);
    } catch (error) {
      throw new TestLinkMcpError(
        "LEDGER_WRITE_FAILED",
        "The audit ledger could not record the attempt, so no remote write was made. Create a new preview after fixing ledger access.",
        false,
        { causeCode: toSafeError(error).code },
      );
    }
  }

  private async recordPreflightFailure(preview: Preview, error: unknown): Promise<void> {
    try {
      await this.operations.record(preview, "failed", { phase: "revalidation", code: toSafeError(error).code });
    } catch (ledgerError) {
      throw new TestLinkMcpError(
        "LEDGER_WRITE_FAILED",
        "Revalidation failed before any remote write, and the audit ledger could not record the failure. Create a new preview after fixing ledger access.",
        false,
        { causeCode: toSafeError(ledgerError).code },
      );
    }
  }

  private async throwOutcomeUnknown(preview: Preview, error: unknown): Promise<never> {
    const causeCode = toSafeError(error).code;
    try {
      await this.operations.record(preview, "outcome_unknown", { causeCode });
    } catch {
      // The durable attempted row still tells operators to reconcile before retrying.
    }
    throw new TestLinkMcpError(
      "OUTCOME_UNKNOWN",
      "A remote write may have succeeded, but its final outcome could not be confirmed. Do not retry automatically; reconcile TestLink state first.",
      false,
      { causeCode },
    );
  }

  private requireWrites(): void {
    if (!this.config.writeEnabled) throw new TestLinkMcpError("WRITE_DISABLED", "Writes are disabled. Set TESTLINK_WRITE_ENABLED=true and restart.");
  }
}
