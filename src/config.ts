import { homedir } from "node:os";
import { join } from "node:path";
import type { Gateway } from "./types.js";
import { TestLinkMcpError } from "./errors.js";
import { DemoGateway } from "./demo.js";
import { XmlRpcGateway } from "./xmlrpc.js";

export interface Config {
  url?: string;
  devKey?: string;
  demoMode: boolean;
  writeEnabled: boolean;
  requestTimeoutMs: number;
  maxResponseBytes: number;
  ledgerPath: string;
}

function bool(value: string | undefined): boolean {
  return value?.toLowerCase() === "true" || value === "1";
}

function integer(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = value ? Number(value) : fallback;
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const url = env.TESTLINK_URL?.trim();
  const devKey = env.TESTLINK_DEV_KEY?.trim();
  return {
    ...(url ? { url } : {}),
    ...(devKey ? { devKey } : {}),
    demoMode: bool(env.TESTLINK_DEMO_MODE),
    writeEnabled: bool(env.TESTLINK_WRITE_ENABLED),
    requestTimeoutMs: integer(env.TESTLINK_REQUEST_TIMEOUT_MS, 30_000, 100, 300_000),
    maxResponseBytes: integer(env.TESTLINK_MAX_RESPONSE_BYTES, 5 * 1024 * 1024, 1024, 50 * 1024 * 1024),
    ledgerPath: env.TESTLINK_LEDGER_PATH?.trim() || join(homedir(), ".local", "state", "testlink-mcp", "operations.jsonl"),
  };
}

class UnconfiguredGateway implements Gateway {
  readonly source = "testlink" as const;
  async call(): Promise<never> {
    throw new TestLinkMcpError(
      "CONFIG_REQUIRED",
      "Set TESTLINK_URL and TESTLINK_DEV_KEY, or explicitly set TESTLINK_DEMO_MODE=true.",
    );
  }
}

export function createGateway(config: Config): Gateway {
  if (config.demoMode) return new DemoGateway();
  if (!config.url || !config.devKey) return new UnconfiguredGateway();
  return new XmlRpcGateway({
    baseUrl: config.url,
    devKey: config.devKey,
    timeoutMs: config.requestTimeoutMs,
    maxResponseBytes: config.maxResponseBytes,
  });
}
