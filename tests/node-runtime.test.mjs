import { request as httpRequest } from "node:http";
import { Readable } from "node:stream";
import assert from "node:assert/strict";
import { once } from "node:events";
import { before, test } from "node:test";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { loadConfig } from "../dist/node/config.js";
import { createBackends, validatePublicTarget } from "../dist/node/backends.js";
import { createTokenVerifier } from "../dist/node/auth.js";
import { createNodeServer } from "../dist/node/server.js";


async function httpFetch(input, init = {}) {
  const url = new URL(input instanceof Request ? input.url : input);
  return new Promise((resolve, reject) => {
    const request = httpRequest(url, {
      method: init.method ?? "GET",
      headers: Object.fromEntries(new Headers(init.headers)),
      signal: init.signal ?? undefined,
    }, response => {
      const headers = new Headers();
      for (const [name, value] of Object.entries(response.headers)) {
        if (Array.isArray(value)) for (const item of value) headers.append(name, item);
        else if (value !== undefined) headers.set(name, value);
      }
      resolve(new Response(
        [204, 304].includes(response.statusCode) ? null : Readable.toWeb(response),
        { status: response.statusCode, headers },
      ));
    });
    request.on("error", reject);
    request.end(init.body);
  });
}

const environment = {
  MCP_PUBLIC_URL: "https://mcp.example.test/mcp",
  READER_URL: "http://reader:8081/",
  SEARXNG_URL: "http://search:8080/search",
  OAUTH_ISSUER_URL: "https://auth.example.test",
  OAUTH_JWKS_URL: "https://auth.example.test/jwks",
  OAUTH_ALLOWED_SUBJECTS: "test-user",
};
let privateKey;
let jwk;
before(async () => {
  const keys = await generateKeyPair("ES256");
  privateKey = keys.privateKey;
  jwk = { ...await exportJWK(keys.publicKey), kid: "test-key", alg: "ES256", use: "sig" };
});
const config = () => loadConfig(environment);
async function token(overrides = {}) {
  return new SignJWT({ scope: "mcp:read", ...overrides })
    .setProtectedHeader({ alg: "ES256", kid: "test-key" })
    .setIssuer(overrides.iss ?? environment.OAUTH_ISSUER_URL)
    .setAudience(overrides.aud ?? environment.MCP_PUBLIC_URL)
    .setSubject(overrides.sub ?? "test-user")
    .setIssuedAt()
    .setExpirationTime(overrides.exp ?? "5m")
    .sign(privateKey);
}
function backendFixture() {
  const calls = [];
  const fetchImpl = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : input);
    calls.push({ url: url.href, init });
    if (url.href === environment.OAUTH_JWKS_URL) {
      return Response.json({ keys: [jwk] });
    }
    if (url.href === environment.READER_URL) {
      const { url: target } = JSON.parse(init.body);
      return Response.json({
        code: 200, status: 20000,
        data: { title: "Example page", url: target, content: "Verified fixture content.", links: [], images: [] },
      });
    }
    if (url.href === environment.SEARXNG_URL) {
      const query = new URLSearchParams(init.body).get("q");
      return Response.json({
        query, number_of_results: 2, answers: [], corrections: [], infoboxes: [], suggestions: [],
        unresponsive_engines: [],
        results: [
          { title: "Public result", url: "https://example.com/source", content: "Independent result snippet.", engine: "test", engines: ["test"] },
          { title: "Internal result", url: "http://127.0.0.1/admin", content: "Must be excluded.", engine: "test", engines: ["test"] },
        ],
      });
    }
    throw new Error("Unexpected outbound destination");
  };
  return { calls, fetchImpl };
}
async function fixture(t, extra = {}, customFetch) {
  const backend = backendFixture();
  const server = createNodeServer({ ...config(), ...extra }, { fetchImpl: customFetch ?? backend.fetchImpl });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = "http://127.0.0.1:" + server.address().port;
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });
  return {
    ...backend, server, base,
    async request(path, options = {}) {
      return httpFetch(base + path, {
        ...options,
        headers: { host: "mcp.example.test", ...options.headers },
      });
    },
    async client() {
      const client = new Client({ name: "node-runtime-test", version: "1.0.0" });
      const transport = new StreamableHTTPClientTransport(new URL(base + "/mcp"), {
        fetch: httpFetch,
        requestInit: { headers: { host: "mcp.example.test", Authorization: "Bearer " + await token() } },
      });
      await client.connect(transport);
      t.after(() => client.close());
      return client;
    },
  };
}
test("configuration requires explicit backends and authentication settings", () => {
  for (const key of Object.keys(environment)) {
    const missing = { ...environment };
    delete missing[key];
    assert.throws(() => loadConfig(missing), new RegExp(key));
  }
  assert.equal(config().host, "127.0.0.1");
  assert.throws(() => loadConfig({ ...environment, OAUTH_JWKS_URL: "http://auth.example.test/jwks" }));
  assert.throws(() => loadConfig({ ...environment, PORT: "3000garbage" }));
  assert.throws(() => loadConfig({ ...environment, READER_URL: "http://user:password@reader:8081/" }));
  assert.throws(() => loadConfig({ ...environment, MCP_PUBLIC_URL: "https://mcp.example.test/mcp?key=not-a-real-key" }));
});
test("public targets reject local addresses, encoded loopback, and credentials", () => {
  for (const value of [
    "http://localhost/", "http://127.0.0.1/", "http://2130706433/",
    "http://10.0.0.1/", "http://169.254.169.254/", "http://100.64.0.1/",
    "http://[::1]/", "http://[::ffff:127.0.0.1]/", "http://[fc00::1]/",
    "http://service.internal/", "file:///etc/passwd", "https://user:password@example.com/",
  ]) assert.throws(() => validatePublicTarget(value), undefined, value);
  assert.equal(validatePublicTarget("https://example.com/page#section"), "https://example.com/page");
});
test("JWT verification checks signature, issuer, audience, expiry, scope, and identity", async () => {
  const { fetchImpl } = backendFixture();
  const verify = createTokenVerifier(config(), fetchImpl);
  assert.equal((await verify(await token())).sub, "test-user");
  for (const claims of [
    { iss: "https://other.example.test" }, { aud: "other-resource" },
    { exp: Math.floor(Date.now() / 1000) - 120 }, { scope: "other:read" }, { sub: "other-user" },
  ]) await assert.rejects(() => verifyTokenWithClaims(verify, claims));
  await assert.rejects(() => verify("not-a-jwt"));
  const keys = await generateKeyPair("ES256");
  const forged = await new SignJWT({ scope: "mcp:read" }).setProtectedHeader({ alg: "ES256", kid: "test-key" })
    .setIssuer(environment.OAUTH_ISSUER_URL).setAudience(environment.MCP_PUBLIC_URL)
    .setSubject("test-user").setIssuedAt().setExpirationTime("5m").sign(keys.privateKey);
  await assert.rejects(() => verify(forged));
});
async function verifyTokenWithClaims(verify, claims) { return verify(await token(claims)); }
test("self-hosted adapters map results without cloud fallback or incoming credentials", async () => {
  const { calls, fetchImpl } = backendFixture();
  const backend = createBackends(config(), fetchImpl);
  const read = await backend.readUrl({ url: "https://example.com/page" });
  assert.equal(read.structuredData.content, "Verified fixture content.");
  const search = await backend.searchWeb({ query: "public information", num: 5 });
  assert.equal(search.results.length, 1);
  assert.equal(search.results[0].url, "https://example.com/source");
  assert.equal(new URLSearchParams(calls[1].init.body).get("q"), "public information");
  for (const { init } of calls) {
    const headers = new Headers(init.headers);
    assert.equal(headers.get("Authorization"), null);
    assert.equal(headers.get("X-Forwarded-For"), null);
    assert.equal(init.redirect, "error");
    assert.ok(init.signal);
  }
  const before = calls.length;
  assert.ok("error" in await backend.readUrl({ url: "http://127.0.0.1/" }));
  assert.ok("error" in await backend.readUrl({ url: "https://example.com/", question: "private question" }));
  assert.ok("error" in await backend.readUrl({ url: "https://example.com/", ocr: true }));
  assert.ok("error" in await backend.searchWeb({ query: "x".repeat(2049) }));
  assert.equal(calls.length, before);
});
test("backend failures, redirects, and oversized bodies are bounded and sanitized", async () => {
  for (const fetchImpl of [
    async () => new Response("", { status: 302, headers: { location: "http://127.0.0.1/" } }),
    async () => new Response("x".repeat(1024 * 1024 + 1)),
    async () => { throw new Error("sensitive-internal-destination"); },
    async () => Response.json({ unexpected: true }),
  ]) {
    const result = await createBackends(config(), fetchImpl).readUrl({ url: "https://example.com/" });
    assert.ok("error" in result);
    assert.ok(!result.error.includes("sensitive-internal-destination"));
  }
});
test("backend cancellation is propagated", async () => {
  const controller = new AbortController();
  const backend = createBackends(config(), async (_url, { signal }) => {
    return new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
  }, controller.signal);
  const pending = backend.readUrl({ url: "https://example.com/" });
  controller.abort();
  assert.ok("error" in await pending);
});
test("HTTP rejects missing authentication and spoofed hosts/origins", async t => {
  const f = await fixture(t);
  const response = await f.request("/mcp", { method: "POST", body: "{}" });
  assert.equal(response.status, 401);
  assert.match(response.headers.get("WWW-Authenticate"), /resource_metadata/);
  assert.equal(f.calls.length, 0);
  const credential = "Bearer " + await token();
  assert.equal((await f.request("/mcp", { method: "POST", headers: { host: "evil.example.test", Authorization: credential } })).status, 403);
  assert.equal((await f.request("/mcp", { method: "POST", headers: { Origin: "https://evil.example.test", Authorization: credential } })).status, 403);
});
test("OAuth resource metadata is public and contains no backend configuration", async t => {
  const f = await fixture(t);
  const response = await f.request("/.well-known/oauth-protected-resource/mcp");
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.resource, environment.MCP_PUBLIC_URL);
  assert.deepEqual(data.authorization_servers, [environment.OAUTH_ISSUER_URL]);
  assert.ok(!JSON.stringify(data).includes("reader:"));
  assert.equal(f.calls.length, 0);
});
test("real MCP client initializes, lists only allowed tools, and reads/searches concurrently", async t => {
  const f = await fixture(t);
  const client = await f.client();
  const tools = (await client.listTools()).tools;
  assert.deepEqual(tools.map(tool => tool.name).sort(), ["read_url", "search_web"]);
  assert.equal(tools.find(tool => tool.name === "read_url").inputSchema.properties.question, undefined);
  assert.equal(tools.find(tool => tool.name === "read_url").inputSchema.properties.ocr, undefined);
  const [read, search] = await Promise.all([
    client.callTool({ name: "read_url", arguments: { url: "https://example.com/" } }),
    client.callTool({ name: "search_web", arguments: { query: "public information" } }),
  ]);
  assert.ok(!read.isError);
  assert.match(read.content[0].text, /Verified fixture content/);
  assert.ok(!search.isError);
  assert.match(search.content[0].text, /Independent result snippet/);
  for (const call of f.calls.filter(call => call.url !== environment.OAUTH_JWKS_URL)) {
    assert.equal(new Headers(call.init.headers).get("Authorization"), null);
  }
  assert.ok((await client.callTool({ name: "extract_pdf", arguments: { url: "https://example.com/" } })).isError);
});
test("caller query filters cannot enable disabled tools or remove server response bounds", async t => {
  const f = await fixture(t);
  const response = await f.request("/mcp?include_tools=extract_pdf&max_tokens=0", {
    method: "POST",
    headers: { Authorization: "Bearer " + await token(), "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).result.tools.map(tool => tool.name).sort(), ["read_url", "search_web"]);
});
test("oversized and malformed HTTP requests fail without invoking backends", async t => {
  const f = await fixture(t);
  const headers = { Authorization: "Bearer " + await token(), "Content-Type": "application/json", Accept: "application/json, text/event-stream" };
  assert.equal((await f.request("/mcp", { method: "POST", headers, body: " ".repeat(65537) })).status, 413);
  assert.equal((await f.request("/mcp", { method: "POST", headers, body: "{" })).status, 400);
  assert.equal(f.calls.filter(call => call.url !== environment.OAUTH_JWKS_URL).length, 0);
});

test("chunked oversized requests return 413 rather than resetting the connection", async t => {
  const f = await fixture(t);
  const response = await f.request("/mcp", {
    method: "POST", headers: {
      Authorization: "Bearer " + await token(),
      "Content-Type": "application/json", "Transfer-Encoding": "chunked",
    },
    body: " ".repeat(65537),
  });
  assert.equal(response.status, 413);
});
test("the fixed response budget cannot be disabled by caller query parameters", async t => {
  const backend = backendFixture();
  const f = await fixture(t, {}, async (input, init) => {
    if (input === environment.READER_URL) return Response.json({
      data: { url: "https://example.com/", title: "Large page", content: "text ".repeat(40000) },
    });
    return backend.fetchImpl(input, init);
  });
  const response = await f.request("/mcp?max_tokens=0", {
    method: "POST", headers: {
      Authorization: "Bearer " + await token(),
      "Content-Type": "application/json", Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call",
      params: { name: "read_url", arguments: { url: "https://example.com/" } } }),
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.ok(!result.result.isError);
  assert.ok(Buffer.byteLength(JSON.stringify(result)) < 65536);
  assert.ok(result.result.content.some(item => /truncat/i.test(item.text)));
});
test("concurrency overload is rejected and capacity is released after completion", async t => {
  let entered;
  let release;
  const started = new Promise(resolve => { entered = resolve; });
  const unblock = new Promise(resolve => { release = resolve; });
  t.after(() => release());
  const backend = backendFixture();
  const f = await fixture(t, { maxConcurrentRequests: 1 }, async (input, init) => {
    if (input === environment.READER_URL) { entered(); await unblock; }
    return backend.fetchImpl(input, init);
  });
  const headers = {
    Authorization: "Bearer " + await token(),
    "Content-Type": "application/json", Accept: "application/json, text/event-stream",
  };
  const first = f.request("/mcp", {
    method: "POST", headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call",
      params: { name: "read_url", arguments: { url: "https://example.com/" } } }),
  });
  await started;
  assert.equal((await f.request("/mcp", { method: "POST", headers, body: "{}" })).status, 503);
  release();
  assert.equal((await first).status, 200);
  assert.equal((await f.request("/mcp", {
    method: "POST", headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
  })).status, 200);
});
test("disconnecting the HTTP client aborts the active backend request", { timeout: 5000 }, async t => {
  let entered;
  let aborted;
  const started = new Promise(resolve => { entered = resolve; });
  const cancelled = new Promise(resolve => { aborted = resolve; });
  const backend = backendFixture();
  const f = await fixture(t, {}, async (input, init) => {
    if (input === environment.READER_URL) {
      entered();
      return new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => {
        aborted(); reject(init.signal.reason);
      }, { once: true }));
    }
    return backend.fetchImpl(input, init);
  });
  const request = httpRequest(new URL(f.base + "/mcp"), {
    method: "POST", headers: {
      host: "mcp.example.test", Authorization: "Bearer " + await token(),
      "Content-Type": "application/json", Accept: "application/json, text/event-stream",
    },
  });
  request.on("error", () => {});
  request.end(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call",
    params: { name: "read_url", arguments: { url: "https://example.com/" } } }));
  await started;
  request.destroy();
  await cancelled;
});

test("malformed request targets cannot crash the HTTP process before authentication", { timeout: 5000 }, async t => {
  const { spawn } = await import("node:child_process");
  const script = `
    import { createNodeServer } from "./dist/node/server.js";
    import { loadConfig } from "./dist/node/config.js";
    const server = createNodeServer(loadConfig(${JSON.stringify(environment)}));
    server.listen(0, "127.0.0.1", () => console.log(server.address().port));
  `;
  const child = spawn(process.execPath, ["--input-type=module", "-e", script], {
    cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"],
  });
  child.stderr.resume();
  t.after(() => child.kill());
  const [data] = await once(child.stdout, "data");
  const port = Number(data.toString().trim());
  const status = await new Promise(resolve => {
    const request = httpRequest({
      hostname: "127.0.0.1", port, path: "/" + String.fromCharCode(92) + "[",
      headers: { Host: "mcp.example.test" },
    }, response => { response.resume(); resolve(response.statusCode); });
    request.on("error", () => resolve("connection-reset"));
    request.end();
  });
  assert.equal(status, 400);
});

test("unsuccessful backend streaming responses are cancelled", async () => {
  let cancelled = false;
  const backend = createBackends(config(), async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode("backend error")); },
    cancel() { cancelled = true; },
  }), { status: 503 }));
  assert.ok("error" in await backend.readUrl({ url: "https://example.com/" }));
  assert.equal(cancelled, true);
});
