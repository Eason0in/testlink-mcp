import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { TOOLS } from "../../src/tools.js";

describe("release metadata", () => {
  it("keeps npm and MCP Registry identities aligned", async () => {
    const packageJson = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"));
    const serverJson = JSON.parse(await readFile(new URL("../../server.json", import.meta.url), "utf8"));
    expect(packageJson.version).toBe("1.0.7");
    expect(packageJson.mcpName).toBe("io.github.Eason0in/testlink-mcp");
    expect(serverJson.name).toBe(packageJson.mcpName);
    expect(serverJson.version).toBe(packageJson.version);
    expect(serverJson.packages[0].identifier).toBe(packageJson.name);
    expect(serverJson.packages[0].version).toBe(packageJson.version);
  });

  it("requires a test plan for traceability membership", () => {
    const traceability = TOOLS.find((tool) => tool.name === "testlink_get_traceability");
    expect(traceability?.inputSchema.required).toEqual(expect.arrayContaining(["testCaseId", "testPlanId"]));
  });
});
