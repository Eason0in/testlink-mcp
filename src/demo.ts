import { TestLinkMcpError } from "./errors.js";
import type { Gateway, JsonObject, NormalizedTestCase } from "./types.js";

const initialCases: NormalizedTestCase[] = [
  {
    id: "101",
    externalId: "DEMO-1",
    version: 1,
    name: "Successful sign in",
    summary: "Verify a registered user can sign in.",
    preconditions: "A registered active user exists.",
    status: "final",
    importance: "high",
    executionType: "automated",
    suiteId: "11",
    suitePath: ["Authentication", "Sign in"],
    steps: [
      { number: 1, actions: "Open the sign-in page.", expectedResults: "The sign-in form is visible." },
      { number: 2, actions: "Enter valid credentials and submit.", expectedResults: "The dashboard is displayed." },
    ],
    keywords: ["smoke", "authentication"],
    customFields: { automationId: "auth-signin-success" },
  },
  {
    id: "102",
    externalId: "DEMO-2",
    version: 2,
    name: "Invalid password is rejected",
    summary: "Verify an invalid password cannot sign in.",
    status: "final",
    importance: "medium",
    executionType: "manual",
    suiteId: "11",
    suitePath: ["Authentication", "Sign in"],
    steps: [{ number: 1, actions: "Submit an invalid password.", expectedResults: "A generic error is shown." }],
    keywords: ["authentication", "negative"],
  },
];

export class DemoGateway implements Gateway {
  readonly source = "demo" as const;
  readonly cases = structuredClone(initialCases);
  readonly executions: Record<string, unknown>[] = [];
  revision = 1;

  async call(method: string, params: JsonObject = {}): Promise<unknown> {
    switch (method) {
      case "about": return { version: "1.9.20", mode: "demo" };
      case "checkDevKey": return true;
      case "getProjects": return [{ id: "1", name: "Demo Project", prefix: "DEMO", notes: "Deterministic demo data" }];
      case "getProjectTestPlans": return [{ id: "21", name: "Release 1", active: "1", is_public: "1", testproject_id: "1" }];
      case "getBuildsForTestPlan": return [{ id: "31", name: "1.0.0", notes: "Demo build", active: "1", open: "1" }];
      case "getFirstLevelTestSuitesForTestProject": return [{ id: "10", name: "Authentication", parent_id: "" }];
      case "getTestSuitesForTestSuite": return params.testsuiteid === "10" ? [{ id: "11", name: "Sign in", parent_id: "10" }] : [];
      case "getTestCasesForTestSuite": return this.cases.filter((item) => item.suiteId === String(params.testsuiteid));
      case "getTestCasesForTestPlan": return this.cases;
      case "getTestCase": return this.findCase(params.testcaseid, params.testcaseexternalid);
      case "getTestCaseAttachments": return [{ id: "501", file_name: "evidence.png", file_size: 2048, file_type: "image/png", title: "Expected UI" }];
      case "getExecutionHistory": return this.executions.filter((item) => String(item.testcaseid) === String(params.testcaseid));
      case "getTestCaseTraceability": return { requirements: [{ id: "REQ-1", title: "User authentication" }], plans: [{ id: "21", name: "Release 1" }] };
      case "createTestCase": {
        const nextId = String(101 + this.cases.length);
        const created = { ...(params.testcase as NormalizedTestCase), id: nextId, version: 1 };
        this.cases.push(created);
        this.revision += 1;
        return [{ id: nextId, status: true, operation: "create" }];
      }
      case "updateTestCase": {
        const index = this.cases.findIndex((item) => item.id === String(params.testcaseid));
        if (index < 0) throw new TestLinkMcpError("NOT_FOUND", "Demo test case not found.");
        this.cases[index] = { ...this.cases[index], ...(params.testcase as Partial<NormalizedTestCase>), version: (this.cases[index]?.version ?? 0) + 1 } as NormalizedTestCase;
        this.revision += 1;
        return [{ id: params.testcaseid, status: true, operation: "update" }];
      }
      case "addTestCaseToTestPlan": return [{ status: true, operation: "membership" }];
      case "reportTCResult": {
        const execution = { id: String(900 + this.executions.length), timestamp: new Date().toISOString(), ...params };
        this.executions.push(execution);
        this.revision += 1;
        return [execution];
      }
      default: throw new TestLinkMcpError("UNSUPPORTED_METHOD", `Demo mode does not implement ${method}.`);
    }
  }

  private findCase(id: unknown, externalId: unknown): NormalizedTestCase[] {
    const item = this.cases.find((candidate) => id ? candidate.id === String(id) : candidate.externalId === String(externalId));
    if (!item) throw new TestLinkMcpError("NOT_FOUND", "Demo test case not found.");
    return [structuredClone(item)];
  }
}
