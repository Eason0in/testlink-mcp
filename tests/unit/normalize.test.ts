import { describe, expect, it } from "vitest";
import { normalizeTestCase, sanitizeAttachment } from "../../src/normalize.js";

describe("TestLink normalization", () => {
  it("normalizes HTML fields and steps", () => {
    const item = normalizeTestCase({ id: "1", full_external_id: "DEMO-1", name: "Case", summary: "<p>Hello</p>", steps: [{ step_number: "1", actions: "<b>Act</b>", expected_results: "Done" }] });
    expect(item.summary).toBe("Hello");
    expect(item.steps[0]).toEqual({ number: 1, actions: "Act", expectedResults: "Done" });
  });
  it("preserves normalized camel-case identifiers and execution types", () => {
    const item = normalizeTestCase({
      id: "101",
      externalId: "DEMO-1",
      version: 1,
      name: "Case",
      executionType: "automated",
      steps: [{ number: 1, actions: "Act", expectedResults: "Done", executionType: "manual" }],
    });
    expect(item.externalId).toBe("DEMO-1");
    expect(item.executionType).toBe("automated");
    expect(item.steps[0]?.executionType).toBe("manual");
  });
  it("uses TestLink's case ID instead of the version ID", () => {
    const item = normalizeTestCase({
      id: "1001",
      testcase_id: "101",
      full_tc_external_id: "PUB-1",
      name: "Case",
      steps: [],
    });
    expect(item.id).toBe("101");
    expect(item.externalId).toBe("PUB-1");
  });
  it("removes all attachment payload aliases", () => {
    expect(sanitizeAttachment({ id: "1", file_name: "x.png", content: "AAAA", base64: "BBBB", fileContent: "CCCC" })).toEqual({ id: "1", file_name: "x.png" });
  });
});
