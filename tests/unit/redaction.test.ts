import { describe, expect, it } from "vitest";
import { redact } from "../../src/redaction.js";

describe("redaction", () => {
  it("masks secret fields, explicit secrets, and token-like strings", () => {
    const secret = "a-very-private-developer-key";
    const output = redact({ devKey: secret, nested: `failure ${secret}`, authorization: "Bearer abc" }, [secret]);
    expect(JSON.stringify(output)).not.toContain(secret);
    expect(output).toEqual({ devKey: "[REDACTED]", nested: "failure [REDACTED]", authorization: "[REDACTED]" });
  });
});
