import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { Config } from "./config.js";
import { createGateway } from "./config.js";
import { TestLinkService } from "./service.js";
import { TOOLS } from "./tools.js";
import type { JsonObject } from "./types.js";

const resources = [
  { uri: "testlink://guide/workflow", name: "TestLink AI workflow", description: "Recommended discovery, analysis, preview, and apply sequence", mimeType: "text/markdown" },
  { uri: "testlink://guide/safety", name: "Write safety", description: "Preview expiry, conflict checks, confirmation, and ledger behavior", mimeType: "text/markdown" },
  { uri: "testlink://server/config", name: "Configuration", description: "Environment variables without secret values", mimeType: "application/json" },
];

const prompts = [
  { name: "testlink-analyze-coverage", description: "Find relevant cases and analyze coverage gaps", arguments: [{ name: "projectId", required: true }, { name: "feature", required: true }] },
  { name: "testlink-sync-test-case", description: "Validate and safely synchronize a proposed test case", arguments: [{ name: "testProjectId", required: true }, { name: "intent", required: true }] },
  { name: "testlink-report-execution", description: "Review evidence and safely report an execution result", arguments: [{ name: "testCaseId", required: true }, { name: "evidence", required: true }] },
];

export function createServer(config: Config): { server: Server; service: TestLinkService } {
  const service = new TestLinkService(createGateway(config), config);
  const server = new Server(
    { name: "testlink-mcp", version: "1.0.8" },
    { capabilities: { tools: {}, resources: {}, prompts: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const result = await service.execute(request.params.name, (request.params.arguments ?? {}) as JsonObject);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      structuredContent: result as unknown as Record<string, unknown>,
      ...(result.ok ? {} : { isError: true }),
    };
  });
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources }));
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const uri = request.params.uri;
    if (uri === "testlink://guide/workflow") return { contents: [{ uri, mimeType: "text/markdown", text: "# Workflow\n\n1. Inspect capabilities. 2. Explore IDs. 3. Search and retrieve cases. 4. Validate. 5. Preview. 6. Ask the user to confirm. 7. Apply with the fresh preview ID." }] };
    if (uri === "testlink://guide/safety") return { contents: [{ uri, mimeType: "text/markdown", text: "# Safety\n\nWrites are disabled by default. Apply requires `confirm: true`, a preview younger than 10 minutes, and an unchanged server snapshot. No delete tool exists. Side effects are not retried. Every attempted apply is recorded in a redacted ledger." }] };
    if (uri === "testlink://server/config") return { contents: [{ uri, mimeType: "application/json", text: JSON.stringify({ configured: config.demoMode || Boolean(config.url && config.devKey), demoMode: config.demoMode, writeEnabled: config.writeEnabled, timeoutMs: config.requestTimeoutMs, maxResponseBytes: config.maxResponseBytes }, null, 2) }] };
    throw new Error(`Unknown resource: ${uri}`);
  });
  server.setRequestHandler(ListPromptsRequestSchema, async () => ({ prompts }));
  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const args = request.params.arguments ?? {};
    const bodies: Record<string, string> = {
      "testlink-analyze-coverage": `Analyze coverage for feature "${args.feature ?? ""}" in project ${args.projectId ?? ""}. Start with capabilities, search cases, retrieve details and traceability, then report evidence-backed gaps. Do not write.`,
      "testlink-sync-test-case": `Prepare a safe test case sync for project ${args.testProjectId ?? ""}: ${args.intent ?? ""}. Search for duplicates, validate the proposal, create a preview, and stop for explicit user confirmation before apply.`,
      "testlink-report-execution": `Review this evidence for test case ${args.testCaseId ?? ""}: ${args.evidence ?? ""}. Inspect execution history, preview the result, and stop for explicit confirmation before apply.`,
    };
    const text = bodies[request.params.name];
    if (!text) throw new Error(`Unknown prompt: ${request.params.name}`);
    return { description: request.params.name, messages: [{ role: "user", content: { type: "text", text } }] };
  });
  return { server, service };
}

export async function runStdioServer(config: Config): Promise<void> {
  const { server } = createServer(config);
  await server.connect(new StdioServerTransport());
}
