import { describe, expect, it } from "vitest";
import { normalizeTestCase, sanitizeAttachment } from "../../src/normalize.js";

describe("TestLink normalization", () => {
  it("normalizes HTML fields and steps", () => {
    const item = normalizeTestCase({ id: "1", full_external_id: "DEMO-1", name: "Case", summary: "<p>Hello</p>", steps: [{ step_number: "1", actions: "<b>Act</b>", expected_results: "Done" }] });
    expect(item.summary).toBe("Hello");
    expect(item.steps[0]).toEqual({ number: 1, actions: "Act", expectedResults: "Done" });
  });
  it("removes all attachment payload aliases", () => {
    expect(sanitizeAttachment({ id: "1", file_name: "x.png", content: "AAAA", base64: "BBBB", fileContent: "CCCC" })).toEqual({ id: "1", file_name: "x.png" });
  });
});
