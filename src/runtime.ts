import { TestLinkMcpError } from "./errors.js";

export const SUPPORTED_NODE_RANGE = "^22.23.2 || ^24.18.1 || ^26.5.1";

function tuple(version: string): [number, number, number] {
  const match = version.replace(/^v/, "").match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) throw new TestLinkMcpError("UNSUPPORTED_NODE", `Cannot parse Node.js version: ${version}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function atLeast(actual: [number, number, number], minimum: [number, number, number]): boolean {
  return actual[0] > minimum[0] ||
    (actual[0] === minimum[0] && (actual[1] > minimum[1] ||
      (actual[1] === minimum[1] && actual[2] >= minimum[2])));
}

export function isSupportedNodeVersion(version: string): boolean {
  const actual = tuple(version);
  const minimum = actual[0] === 22 ? [22, 23, 2] as const
    : actual[0] === 24 ? [24, 18, 1] as const
      : actual[0] === 26 ? [26, 5, 1] as const
        : undefined;
  return minimum ? atLeast(actual, [...minimum]) : false;
}

export function assertSupportedNodeVersion(version = process.versions.node): void {
  if (!isSupportedNodeVersion(version)) {
    throw new TestLinkMcpError(
      "UNSUPPORTED_NODE",
      `Node.js ${version} is blocked. Supported runtime range: ${SUPPORTED_NODE_RANGE}.`,
    );
  }
}
