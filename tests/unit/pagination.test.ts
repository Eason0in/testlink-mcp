import { describe, expect, it } from "vitest";
import { paginate } from "../../src/pagination.js";

describe("cursor pagination", () => {
  it("paginates without exposing offsets", () => {
    const first = paginate([1, 2, 3, 4], 2, undefined, { query: "a" });
    expect(first.items).toEqual([1, 2]);
    expect(first.nextCursor).toBeTruthy();
    const second = paginate([1, 2, 3, 4], 2, first.nextCursor, { query: "a" });
    expect(second.items).toEqual([3, 4]);
    expect(second.nextCursor).toBeUndefined();
  });
  it("rejects cursors reused for another query", () => {
    const cursor = paginate([1, 2], 1, undefined, { query: "a" }).nextCursor;
    expect(() => paginate([1, 2], 1, cursor, { query: "b" })).toThrow(/another query/);
  });
  it("caps the page size", () => {
    expect(paginate(Array.from({ length: 250 }, (_, i) => i), 999, undefined, {}).items).toHaveLength(200);
  });
});
