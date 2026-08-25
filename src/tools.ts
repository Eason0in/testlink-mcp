import type { Tool } from "@modelcontextprotocol/sdk/types.js";

const pagination = {
  cursor: { type: "string", description: "Opaque cursor returned by the previous call. Never edit it." },
  limit: { type: "integer", minimum: 1, maximum: 200, default: 50 },
};

const outputSchema = {
  type: "object" as const,
  required: ["ok", "meta"],
  properties: {
    ok: { type: "boolean" },
    data: {},
    error: {
      type: "object",
      required: ["code", "message", "retryable"],
      properties: {
        code: { type: "string" },
        message: { type: "string" },
        retryable: { type: "boolean" },
        details: {},
      },
      additionalProperties: false,
    },
    meta: {
      type: "object",
      required: ["source", "requestId"],
      properties: {
        source: { enum: ["testlink", "demo", "local"] },
        requestId: { type: "string" },
        nextCursor: { type: "string" },
        previewExpiresAt: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
};

const readAnnotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
const previewAnnotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
const applyAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };

const caseSchema = {
  type: "object",
  required: ["name", "steps"],
  properties: {
    id: { type: "string" },
    externalId: { type: "string" },
    version: { type: "integer", minimum: 1 },
    name: { type: "string", minLength: 1 },
    summary: { type: "string" },
    preconditions: { type: "string" },
    status: { type: "string" },
    importance: { type: "string" },
    executionType: { type: "string" },
    suiteId: { type: "string" },
    steps: {
      type: "array",
      items: {
        type: "object",
        required: ["number", "actions", "expectedResults"],
        properties: {
          number: { type: "integer", minimum: 1 },
          actions: { type: "string" },
          expectedResults: { type: "string" },
          executionType: { type: "string" },
        },
        additionalProperties: false,
      },
    },
    keywords: { type: "array", items: { type: "string" } },
    customFields: { type: "object", additionalProperties: { type: "string" } },
  },
  additionalProperties: false,
};

function tool(name: string, description: string, properties: Record<string, unknown>, required: string[], annotations = readAnnotations): Tool {
  return {
    name,
    description,
    inputSchema: { type: "object", properties, required, additionalProperties: false },
    outputSchema,
    annotations,
  } as Tool;
}

export const TOOLS: Tool[] = [
  tool(
    "testlink_get_server_capabilities",
    "Start here. Inspect configuration, TestLink compatibility, demo/write mode, and safety constraints. Works without credentials and never writes.",
    {}, [],
  ),
  tool(
    "testlink_list_projects",
    "Explore TestLink projects. Use this before plans or suites when the project ID is unknown. Returns a cursor page.",
    pagination, [],
  ),
  tool(
    "testlink_list_test_plans",
    "Explore test plans belonging to one known project. This does not search test cases.",
    { projectId: { type: "string", description: "TestLink test project ID." }, ...pagination }, ["projectId"],
  ),
  tool(
    "testlink_list_builds",
    "Explore builds belonging to one known test plan. Use before previewing an execution result.",
    { testPlanId: { type: "string" }, ...pagination }, ["testPlanId"],
  ),
  tool(
    "testlink_list_test_suites",
    "Explore one suite level. Omit parentId for project roots; pass parentId to walk children deliberately.",
    { projectId: { type: "string" }, parentId: { type: "string" }, ...pagination }, ["projectId"],
  ),
  tool(
    "testlink_search_test_cases",
    "Search and filter test cases for AI analysis. Supply externalId for an exact lookup, or a project/suite scope plus query. Prefer this over recursively listing suites.",
    {
      projectId: { type: "string" }, testPlanId: { type: "string" }, testSuiteId: { type: "string" },
      externalId: { type: "string" }, query: { type: "string" }, status: { type: "string" },
      depth: { type: "integer", minimum: 0, maximum: 10, default: 3 }, ...pagination,
    }, [],
  ),
  tool(
    "testlink_get_test_case",
    "Retrieve one normalized test case with steps and expected results. Provide exactly one stable ID or external ID.",
    { testCaseId: { type: "string" }, externalId: { type: "string" }, version: { type: "integer", minimum: 1 } }, [],
  ),
  tool(
    "testlink_list_test_case_attachments",
    "List safe attachment metadata only. File/base64 content is always removed to keep model context bounded.",
    { testCaseId: { type: "string" }, ...pagination }, ["testCaseId"],
  ),
  tool(
    "testlink_get_traceability",
    "Analyze requirement links and membership in one specific test plan for a test case. Use for coverage questions, not generic search.",
    { testCaseId: { type: "string" }, testPlanId: { type: "string" } }, ["testCaseId", "testPlanId"],
  ),
  tool(
    "testlink_get_execution_history",
    "Inspect recent execution evidence for one test case, optionally scoped to a test plan. This never reports a result.",
    { testCaseId: { type: "string" }, testPlanId: { type: "string" }, ...pagination }, ["testCaseId"],
  ),
  tool(
    "testlink_validate_test_case",
    "Validate an existing or proposed test case for actionable names, steps, expected results, and AI retrieval quality. Call before synchronization.",
    { testCaseId: { type: "string" }, externalId: { type: "string" }, testCase: caseSchema }, [],
  ),
  tool(
    "testlink_preview_test_case_sync",
    "Preview a safe create/update plus optional test-plan memberships. It does not write and returns a 10-minute preview ID required by apply.",
    {
      testCaseId: { type: "string" }, testProjectId: { type: "string" }, desiredCase: caseSchema,
      authorLogin: { type: "string", description: "TestLink author login. Required when the preview will create a new test case." },
      testPlanIds: { type: "array", items: { type: "string" }, default: [] },
    }, ["desiredCase", "testProjectId"], previewAnnotations,
  ),
  tool(
    "testlink_apply_test_case_sync",
    "Apply exactly a recent test-case sync preview. Requires write mode, confirm:true, and unchanged server state. Never deletes and never auto-retries side effects.",
    { previewId: { type: "string", format: "uuid" }, confirm: { type: "boolean", const: true } }, ["previewId", "confirm"], applyAnnotations,
  ),
  tool(
    "testlink_preview_execution_result",
    "Preview reporting passed/failed/blocked for one case, plan, and build. It does not write and returns a 10-minute preview ID.",
    {
      testCaseId: { type: "string" }, testPlanId: { type: "string" }, buildId: { type: "string" },
      status: { enum: ["passed", "failed", "blocked"] }, notes: { type: "string" }, platformName: { type: "string" },
    }, ["testCaseId", "testPlanId", "buildId", "status"], previewAnnotations,
  ),
  tool(
    "testlink_apply_execution_result",
    "Apply exactly a recent execution preview. Requires write mode, confirm:true, and unchanged execution state. The report call is never auto-retried.",
    { previewId: { type: "string", format: "uuid" }, confirm: { type: "boolean", const: true } }, ["previewId", "confirm"], applyAnnotations,
  ),
];
