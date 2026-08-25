import { createHash } from "node:crypto";
import { TestLinkMcpError } from "./errors.js";
import type { Page } from "./types.js";

interface Cursor { offset: number; fingerprint: string }

function fingerprint(scope: unknown): string {
  return createHash("sha256").update(JSON.stringify(scope)).digest("hex").slice(0, 16);
}

export function paginate<T>(items: T[], limit = 50, cursor: string | undefined, scope: unknown): Page<T> {
  const safeLimit = Math.max(1, Math.min(limit, 200));
  const expected = fingerprint(scope);
  let offset = 0;
  if (cursor) {
    try {
      const decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Cursor;
      if (!Number.isInteger(decoded.offset) || decoded.offset < 0 || decoded.fingerprint !== expected) throw new Error();
      offset = decoded.offset;
    } catch {
      throw new TestLinkMcpError("INVALID_CURSOR", "Cursor is invalid or belongs to another query.");
    }
  }
  const pageItems = items.slice(offset, offset + safeLimit);
  const nextOffset = offset + pageItems.length;
  const nextCursor = nextOffset < items.length
    ? Buffer.from(JSON.stringify({ offset: nextOffset, fingerprint: expected })).toString("base64url")
    : undefined;
  return { items: pageItems, ...(nextCursor ? { nextCursor } : {}), total: items.length };
}
