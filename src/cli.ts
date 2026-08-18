#!/usr/bin/env node
import { config as loadDotEnv } from "dotenv";
import { loadConfig } from "./config.js";
import { assertSupportedNodeVersion } from "./runtime.js";
import { runStdioServer } from "./server.js";

loadDotEnv({ quiet: true });

try {
  assertSupportedNodeVersion();
  await runStdioServer(loadConfig());
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`testlink-mcp: ${message}\n`);
  process.exitCode = 1;
}
