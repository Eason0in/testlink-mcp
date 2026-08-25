const SENSITIVE_KEY = /(dev[_-]?key|api[_-]?key|token|password|secret|authorization)/i;
const TOKENISH = /\b(?:Bearer\s+)?[A-Za-z0-9_+/=-]{24,}\b/g;

export function redact(value: unknown, secrets: string[] = []): unknown {
  const redactText = (text: string): string => {
    let safe = text.replace(TOKENISH, "[REDACTED]");
    for (const secret of secrets.filter(Boolean)) safe = safe.split(secret).join("[REDACTED]");
    return safe;
  };
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) return value.map((item) => redact(item, secrets));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      SENSITIVE_KEY.test(key) ? "[REDACTED]" : redact(item, secrets),
    ]));
  }
  return value;
}
