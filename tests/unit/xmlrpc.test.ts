import { describe, expect, it, vi } from "vitest";
import { encodeMethodCall, encodeXmlRpcValue, parseMethodResponse, XmlRpcGateway } from "../../src/xmlrpc.js";

const response = (value: string) => `<?xml version="1.0"?><methodResponse><params><param>${value}</param></params></methodResponse>`;

describe("XML-RPC mapping", () => {
  it("encodes scalars, arrays, structs, nil, and XML escaping", () => {
    const xml = encodeXmlRpcValue({ text: "<unsafe>&", count: 2, ok: true, none: null, list: [1, "x"] });
    expect(xml).toContain("&lt;unsafe&gt;&amp;");
    expect(xml).toContain("<int>2</int>");
    expect(xml).toContain("<boolean>1</boolean>");
    expect(xml).toContain("<nil/>");
    expect(xml).toContain("<array>");
  });
  it("encodes named TestLink params", () => {
    const xml = encodeMethodCall("tl.getProjects", { devKey: "placeholder" });
    expect(xml).toContain("<methodName>tl.getProjects</methodName>");
    expect(xml).toContain("<name>devKey</name>");
  });
  it("decodes nested structs, arrays, booleans and nil", () => {
    const xml = response("<value><struct><member><name>name</name><value><string>Demo</string></value></member><member><name>values</name><value><array><data><value><int>2</int></value><value><boolean>1</boolean></value><value><nil/></value></data></array></value></member></struct></value>");
    expect(parseMethodResponse(xml)).toEqual({ name: "Demo", values: [2, true, null] });
  });
  it("turns faults into safe errors", () => {
    const xml = "<methodResponse><fault><value><struct><member><name>faultCode</name><value><int>201</int></value></member><member><name>faultString</name><value><string>Bad key</string></value></member></struct></value></fault></methodResponse>";
    expect(() => parseMethodResponse(xml)).toThrow(/Bad key/);
  });
  it.each([
    ["HTML", "<!doctype html><html><body>login</body></html>", "HTML"],
    ["malformed XML", "<methodResponse>", "malformed"],
  ])("rejects %s", (_name, xml, message) => expect(() => parseMethodResponse(xml)).toThrow(new RegExp(message, "i")));
  it("rejects responses over the configured size", () => {
    expect(() => parseMethodResponse(response(`<value><string>${"x".repeat(200)}</string></value>`), 100)).toThrow(/exceeded/);
  });
});

describe("XML-RPC transport", () => {
  it("uses a timeout and redacts the developer key from network errors", async () => {
    const fetchImpl = vi.fn((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("secret-key"), { name: "AbortError" })));
    }));
    const gateway = new XmlRpcGateway({ baseUrl: "https://testlink.example.com/testlink", devKey: "secret-key", timeoutMs: 5, maxResponseBytes: 1024, fetchImpl });
    await expect(gateway.call("about")).rejects.toThrow(/timed out/);
  });
  it("does not retry side-effect calls", async () => {
    const fetchImpl = vi.fn(async () => { throw new Error("offline"); });
    const gateway = new XmlRpcGateway({ baseUrl: "https://testlink.example.com/testlink", devKey: "placeholder", timeoutMs: 100, maxResponseBytes: 1024, fetchImpl });
    await expect(gateway.call("reportTCResult", { status: "p" })).rejects.toThrow(/offline/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
