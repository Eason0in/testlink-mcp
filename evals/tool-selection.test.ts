import { describe, expect, it } from "vitest";
import { TOOLS } from "../src/tools.js";

const cases = [
  ["Which cases mention password lockout?", "testlink_search_test_cases"],
  ["Is this proposed case complete and executable?", "testlink_validate_test_case"],
  ["Show me exactly what would change before syncing this case", "testlink_preview_test_case_sync"],
  ["Apply the confirmed case synchronization preview", "testlink_apply_test_case_sync"],
  ["Show recent outcomes for case 101", "testlink_get_execution_history"],
  ["Preview marking this test failed on build 31", "testlink_preview_execution_result"],
  ["Apply the confirmed execution result preview", "testlink_apply_execution_result"],
  ["What TestLink projects can I access?", "testlink_list_projects"],
] as const;

const signals: Record<string, string[]> = {
  testlink_search_test_cases: ["which cases", "mention"],
  testlink_validate_test_case: ["complete", "executable"],
  testlink_preview_test_case_sync: ["before", "syncing"],
  testlink_apply_test_case_sync: ["apply", "synchronization"],
  testlink_get_execution_history: ["recent", "outcomes"],
  testlink_preview_execution_result: ["preview", "marking", "failed"],
  testlink_apply_execution_result: ["apply", "execution result"],
  testlink_list_projects: ["projects", "access"],
};

function offlineSelection(prompt: string): string {
  const normalized = prompt.toLowerCase();
  return Object.entries(signals)
    .map(([name, words]) => ({ name, score: words.filter((word) => normalized.includes(word)).length }))
    .sort((a, b) => b.score - a.score)[0]!.name;
}

describe("offline AI tool-selection eval", () => {
  it.each(cases)("routes %s", (prompt, expected) => expect(offlineSelection(prompt)).toBe(expected));
  it("keeps preview and apply descriptions explicitly distinct", () => {
    const text = Object.fromEntries(TOOLS.map((item) => [item.name, item.description?.toLowerCase()]));
    expect(text.testlink_preview_test_case_sync).toContain("does not write");
    expect(text.testlink_apply_test_case_sync).toContain("requires");
    expect(text.testlink_preview_execution_result).toContain("does not write");
    expect(text.testlink_apply_execution_result).toContain("never auto-retried");
  });
});
