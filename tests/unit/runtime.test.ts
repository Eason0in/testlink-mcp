import { describe, expect, it } from "vitest";
import { assertSupportedNodeVersion, isSupportedNodeVersion } from "../../src/runtime.js";

describe("runtime guard", () => {
  it.each(["22.23.2", "22.99.0", "24.18.1", "24.19.0", "26.5.1", "26.7.0"])("accepts %s", (version) => {
    expect(isSupportedNodeVersion(version)).toBe(true);
  });
  it.each(["14.21.3", "18.20.8", "22.23.1", "23.11.1", "24.18.0", "25.8.0", "26.5.0", "27.0.0"])("blocks %s", (version) => {
    expect(isSupportedNodeVersion(version)).toBe(false);
    expect(() => assertSupportedNodeVersion(version)).toThrow(/blocked/);
  });
});
