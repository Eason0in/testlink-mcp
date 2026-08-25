import { XMLParser, XMLValidator } from "fast-xml-parser";
import { TestLinkMcpError } from "./errors.js";
import { redact } from "./redaction.js";
import type { Gateway, JsonObject } from "./types.js";

function escapeXml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

export function encodeXmlRpcValue(value: unknown): string {
  if (value === null || value === undefined) return "<value><nil/></value>";
  if (typeof value === "string") return `<value><string>${escapeXml(value)}</string></value>`;
  if (typeof value === "boolean") return `<value><boolean>${value ? 1 : 0}</boolean></value>`;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TestLinkMcpError("INVALID_ARGUMENT", "XML-RPC does not support non-finite numbers.");
    return Number.isInteger(value) ? `<value><int>${value}</int></value>` : `<value><double>${value}</double></value>`;
  }
  if (value instanceof Date) return `<value><dateTime.iso8601>${value.toISOString()}</dateTime.iso8601></value>`;
  if (Buffer.isBuffer(value)) return `<value><base64>${value.toString("base64")}</base64></value>`;
  if (Array.isArray(value)) return `<value><array><data>${value.map(encodeXmlRpcValue).join("")}</data></array></value>`;
  if (typeof value === "object") {
    const members = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .map(([key, item]) => `<member><name>${escapeXml(key)}</name>${encodeXmlRpcValue(item)}</member>`)
      .join("");
    return `<value><struct>${members}</struct></value>`;
  }
  throw new TestLinkMcpError("INVALID_ARGUMENT", `Unsupported XML-RPC value type: ${typeof value}`);
}

export function encodeMethodCall(method: string, params: JsonObject): string {
  return `<?xml version="1.0"?><methodCall><methodName>${escapeXml(method)}</methodName><params><param>${encodeXmlRpcValue(params)}</param></params></methodCall>`;
}

function list<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

export function decodeXmlRpcValue(node: unknown): unknown {
  if (node === null || node === undefined) return null;
  if (typeof node === "string" || typeof node === "number" || typeof node === "boolean") return node;
  const value = node as Record<string, unknown>;
  if ("#text" in value && Object.keys(value).length === 1) return value["#text"];
  if ("string" in value) return String(value.string ?? "");
  for (const key of ["int", "i4", "i8"]) if (key in value) return Number(value[key]);
  if ("double" in value) return Number(value.double);
  if ("boolean" in value) return value.boolean === true || value.boolean === 1 || value.boolean === "1";
  if ("nil" in value) return null;
  if ("base64" in value) return Buffer.from(String(value.base64 ?? ""), "base64");
  if ("dateTime.iso8601" in value) return String(value["dateTime.iso8601"]);
  if ("array" in value) {
    const array = value.array as Record<string, unknown>;
    const data = (array?.data ?? {}) as Record<string, unknown>;
    return list(data.value).map(decodeXmlRpcValue);
  }
  if ("struct" in value) {
    const structure = value.struct as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const rawMember of list(structure?.member)) {
      const member = rawMember as Record<string, unknown>;
      result[String(member.name)] = decodeXmlRpcValue(member.value);
    }
    return result;
  }
  return value;
}

export function parseMethodResponse(xml: string, maxBytes = 5 * 1024 * 1024): unknown {
  if (Buffer.byteLength(xml) > maxBytes) throw new TestLinkMcpError("RESPONSE_TOO_LARGE", `XML-RPC response exceeded ${maxBytes} bytes.`);
  if (/^\s*(?:<!doctype\s+html|<html)/i.test(xml)) throw new TestLinkMcpError("NON_XMLRPC_RESPONSE", "Server returned HTML instead of XML-RPC.");
  if (XMLValidator.validate(xml) !== true) throw new TestLinkMcpError("MALFORMED_XML", "Server returned malformed XML.");
  const parser = new XMLParser({ parseTagValue: false, trimValues: false, processEntities: true });
  const root = parser.parse(xml) as Record<string, unknown>;
  const response = root.methodResponse as Record<string, unknown> | undefined;
  if (!response) throw new TestLinkMcpError("MALFORMED_XMLRPC", "Missing methodResponse.");
  if (response.fault) {
    const faultNode = response.fault as Record<string, unknown>;
    const fault = decodeXmlRpcValue(faultNode.value) as Record<string, unknown>;
    throw new TestLinkMcpError(
      "XMLRPC_FAULT",
      String(fault?.faultString ?? "TestLink XML-RPC fault"),
      false,
      { faultCode: fault?.faultCode },
    );
  }
  const params = response.params as Record<string, unknown> | undefined;
  const param = params?.param as Record<string, unknown> | Array<Record<string, unknown>> | undefined;
  const first = Array.isArray(param) ? param[0] : param;
  if (!first || !("value" in first)) return null;
  return decodeXmlRpcValue(first.value);
}

export interface XmlRpcGatewayOptions {
  baseUrl: string;
  devKey: string;
  timeoutMs: number;
  maxResponseBytes: number;
  fetchImpl?: typeof fetch;
}

export class XmlRpcGateway implements Gateway {
  readonly source = "testlink" as const;
  private readonly endpoint: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: XmlRpcGatewayOptions) {
    this.endpoint = options.baseUrl.endsWith("xmlrpc.php")
      ? options.baseUrl
      : `${options.baseUrl.replace(/\/$/, "")}/lib/api/xmlrpc/v1/xmlrpc.php`;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async call(method: string, params: JsonObject = {}): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      const body = encodeMethodCall(`tl.${method}`, { devKey: this.options.devKey, ...params });
      const response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: { "content-type": "text/xml", accept: "text/xml" },
        body,
        signal: controller.signal,
      });
      if (!response.ok) throw new TestLinkMcpError("HTTP_ERROR", `TestLink returned HTTP ${response.status}.`, response.status >= 500);
      const declared = Number(response.headers.get("content-length") ?? 0);
      if (declared > this.options.maxResponseBytes) throw new TestLinkMcpError("RESPONSE_TOO_LARGE", "TestLink response is too large.");
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > this.options.maxResponseBytes) throw new TestLinkMcpError("RESPONSE_TOO_LARGE", "TestLink response is too large.");
      return parseMethodResponse(bytes.toString("utf8"), this.options.maxResponseBytes);
    } catch (error) {
      if (error instanceof TestLinkMcpError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new TestLinkMcpError("TIMEOUT", `TestLink request timed out after ${this.options.timeoutMs} ms.`, true);
      }
      const safe = redact(error instanceof Error ? error.message : String(error), [this.options.devKey]);
      throw new TestLinkMcpError("NETWORK_ERROR", String(safe), true);
    } finally {
      clearTimeout(timer);
    }
  }
}
