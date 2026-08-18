export class TestLinkMcpError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = false,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "TestLinkMcpError";
  }
}

export function toSafeError(error: unknown): TestLinkMcpError {
  if (error instanceof TestLinkMcpError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new TestLinkMcpError("INTERNAL_ERROR", message, false);
}
