import type { JsonObject, NormalizedTestCase, TestCaseStep } from "./types.js";

export function asArray(value: unknown): JsonObject[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter((item): item is JsonObject => Boolean(item && typeof item === "object"));
  if (typeof value !== "object") return [];
  const object = value as JsonObject;
  if ("id" in object || "name" in object || "testcase_id" in object) return [object];
  return Object.values(object).filter((item): item is JsonObject => Boolean(item && typeof item === "object"));
}

function text(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  const result = String(value).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return result || undefined;
}

function number(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function normalizeStep(raw: JsonObject, index: number): TestCaseStep {
  const executionType = text(raw.execution_type ?? raw.executionType);
  return {
    number: number(raw.step_number ?? raw.step_number_display ?? raw.id) ?? index + 1,
    actions: text(raw.actions ?? raw.step_actions) ?? "",
    expectedResults: text(raw.expected_results ?? raw.expectedResults) ?? "",
    ...(executionType ? { executionType } : {}),
  };
}

export function normalizeTestCase(raw: JsonObject): NormalizedTestCase {
  const stepsRaw = Array.isArray(raw.steps) ? raw.steps : asArray(raw.steps);
  const id = text(raw.id ?? raw.testcase_id);
  const externalId = text(raw.full_external_id ?? raw.external_id ?? raw.testcase_external_id ?? raw.externalId);
  const version = number(raw.version);
  const summary = text(raw.summary);
  const preconditions = text(raw.preconditions);
  const status = text(raw.status);
  const importance = text(raw.importance);
  const executionType = text(raw.execution_type ?? raw.executionType);
  const suiteId = text(raw.testsuite_id ?? raw.suiteId);
  return {
    ...(id ? { id } : {}),
    ...(externalId ? { externalId } : {}),
    ...(version !== undefined ? { version } : {}),
    name: text(raw.name ?? raw.testcasename) ?? "Untitled test case",
    ...(summary ? { summary } : {}),
    ...(preconditions ? { preconditions } : {}),
    ...(status ? { status } : {}),
    ...(importance ? { importance } : {}),
    ...(executionType ? { executionType } : {}),
    ...(suiteId ? { suiteId } : {}),
    ...(Array.isArray(raw.suitePath) ? { suitePath: raw.suitePath.map(String) } : {}),
    steps: stepsRaw.map(normalizeStep),
    ...(Array.isArray(raw.keywords) ? { keywords: raw.keywords.map((item) => typeof item === "object" ? text((item as JsonObject).keyword) ?? "" : String(item)).filter(Boolean) } : {}),
    ...(raw.customFields && typeof raw.customFields === "object" ? { customFields: Object.fromEntries(Object.entries(raw.customFields as JsonObject).map(([key, value]) => [key, String(value)])) } : {}),
  };
}

export function sanitizeAttachment(raw: JsonObject): JsonObject {
  const { content: _content, base64: _base64, fileContent: _fileContent, ...metadata } = raw;
  return metadata;
}
