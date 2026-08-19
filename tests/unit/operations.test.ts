import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { OperationManager } from "../../src/operations.js";

describe("operation previews", () => {
  it("allows each confirmed preview to be claimed only once", () => {
    const manager = new OperationManager(join("/tmp", "testlink-mcp-operations-test.jsonl"));
    const preview = manager.create("execution_result", null, {}, {});

    expect(manager.require(preview.id, preview.kind, true)).toBe(preview);
    expect(() => manager.require(preview.id, preview.kind, true)).toThrow(/unknown/);
  });
});
