import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

if (!process.env.TESTLINK_URL || !process.env.TESTLINK_DEV_KEY) {
  throw new Error("TESTLINK_URL and TESTLINK_DEV_KEY are required");
}

const command = process.argv[2] ?? "node";
const args = process.argv[2] ? process.argv.slice(3) : ["dist/cli.js"];
const client = new Client({ name: "testlink-live-readonly-smoke", version: "1.0.0" });
const transport = new StdioClientTransport({
  command,
  args,
  env: {
    ...process.env,
    TESTLINK_DEMO_MODE: "false",
    TESTLINK_WRITE_ENABLED: "false",
  },
  stderr: "pipe",
});

try {
  await client.connect(transport);
  const capabilities = await client.callTool({
    name: "testlink_get_server_capabilities",
    arguments: {},
  });
  const projects = await client.callTool({
    name: "testlink_list_projects",
    arguments: { limit: 1 },
  });
  if (capabilities.structuredContent?.ok !== true) {
    throw new Error("Capability discovery failed");
  }
  if (capabilities.structuredContent?.data?.configured !== true) {
    throw new Error("The live TestLink server is not configured");
  }
  if (projects.structuredContent?.ok !== true) {
    throw new Error("Read-only project discovery failed");
  }
  process.stdout.write(
    `${JSON.stringify({
      configured: true,
      source: projects.structuredContent.meta?.source,
      projectCountObserved: projects.structuredContent.data?.items?.length ?? 0,
    })}\n`,
  );
} finally {
  await client.close();
}
