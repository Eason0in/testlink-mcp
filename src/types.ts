export type JsonObject = Record<string, unknown>;

export interface McpResult {
  ok: boolean;
  data?: unknown;
  error?: {
    code: string;
    message: string;
    retryable: boolean;
    details?: unknown;
  };
  meta: {
    source: "testlink" | "demo" | "local";
    requestId: string;
    nextCursor?: string;
    previewExpiresAt?: string;
  };
}

export interface Page<T> {
  items: T[];
  nextCursor?: string;
  total: number;
}

export interface TestCaseStep {
  number: number;
  actions: string;
  expectedResults: string;
  executionType?: string;
}

export interface NormalizedTestCase {
  id?: string;
  externalId?: string;
  version?: number;
  name: string;
  summary?: string;
  preconditions?: string;
  status?: string;
  importance?: string;
  executionType?: string;
  suiteId?: string;
  suitePath?: string[];
  steps: TestCaseStep[];
  keywords?: string[];
  customFields?: Record<string, string>;
}

export interface Gateway {
  readonly source: "testlink" | "demo";
  call(method: string, params?: JsonObject): Promise<unknown>;
}
