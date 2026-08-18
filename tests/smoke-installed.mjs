import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const executable = process.argv[2];
if (!executable) throw new Error("Usage: node tests/smoke-installed.mjs /path/to/testlink-mcp");
const args = process.argv.slice(3);

const client = new Client({ name: "installed-tarball-smoke", version: "1.0.0" });
const transport = new StdioClientTransport({
  command: executable,
  args,
  env: { ...process.env, TESTLINK_DEMO_MODE: "true", TESTLINK_WRITE_ENABLED: "false" },
  stderr: "pipe",
});

try {
  await client.connect(transport);
  const tools = await client.listTools();
  const capabilities = await client.callTool({ name: "testlink_get_server_capabilities", arguments: {} });
  if (tools.tools.length !== 15) throw new Error(`Expected 15 tools, received ${tools.tools.length}`);
  if (capabilities.structuredContent?.ok !== true) throw new Error("Capabilities call did not return structured success output");
  process.stdout.write(`${JSON.stringify({ tools: tools.tools.length, structuredOutput: true, source: capabilities.structuredContent.meta?.source })}\n`);
} finally {
  await client.close();
}
