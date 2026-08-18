import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { TestLinkMcpError } from "./errors.js";
import { redact } from "./redaction.js";
import type { JsonObject } from "./types.js";

export type PreviewKind = "test_case_sync" | "execution_result";

export interface Preview {
  id: string;
  kind: PreviewKind;
  createdAt: string;
  expiresAt: string;
  snapshotHash: string;
  payload: JsonObject;
  proposedChanges: unknown;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as JsonObject).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function snapshotHash(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

export class OperationManager {
  private readonly previews = new Map<string, Preview>();
  constructor(private readonly ledgerPath: string, private readonly now: () => Date = () => new Date()) {}

  create(kind: PreviewKind, snapshot: unknown, payload: JsonObject, proposedChanges: unknown): Preview {
    const created = this.now();
    const preview: Preview = {
      id: randomUUID(),
      kind,
      createdAt: created.toISOString(),
      expiresAt: new Date(created.getTime() + 10 * 60_000).toISOString(),
      snapshotHash: snapshotHash(snapshot),
      payload,
      proposedChanges,
    };
    this.previews.set(preview.id, preview);
    return preview;
  }

  require(id: string, kind: PreviewKind, confirm: boolean): Preview {
    if (!confirm) throw new TestLinkMcpError("CONFIRMATION_REQUIRED", "Apply requires confirm: true.");
    const preview = this.previews.get(id);
    if (!preview || preview.kind !== kind) throw new TestLinkMcpError("PREVIEW_NOT_FOUND", "Preview ID is unknown or belongs to another operation.");
    if (this.now().getTime() > Date.parse(preview.expiresAt)) {
      this.previews.delete(id);
      throw new TestLinkMcpError("PREVIEW_EXPIRED", "Preview expired after 10 minutes. Create a new preview.");
    }
    return preview;
  }

  async record(preview: Preview, outcome: "applied" | "conflict" | "failed", result: unknown): Promise<void> {
    await mkdir(dirname(this.ledgerPath), { recursive: true, mode: 0o700 });
    const row = redact({
      timestamp: this.now().toISOString(),
      operationId: randomUUID(),
      previewId: preview.id,
      kind: preview.kind,
      outcome,
      payloadHash: snapshotHash(preview.payload),
      result,
    });
    await appendFile(this.ledgerPath, `${JSON.stringify(row)}\n`, { encoding: "utf8", mode: 0o600 });
    if (outcome === "applied") this.previews.delete(preview.id);
  }
}
