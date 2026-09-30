import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { register } from "node:module";
import test from "node:test";

// The OAuth package only needs WorkerEntrypoint's base class in these Node
// integration tests; production uses Cloudflare's real runtime and KV.
register(`data:text/javascript,${encodeURIComponent(`
  export async function resolve(specifier, context, nextResolve) {
    if (specifier === 'cloudflare:workers') {
      return { url: 'data:text/javascript,export class WorkerEntrypoint {}', shortCircuit: true };
    }
    return nextResolve(specifier, context);
  }
`)}`);

Object.defineProperty(globalThis, "Cloudflare", {
  value: { compatibilityFlags: { global_fetch_strictly_public: true } }, configurable: true,
});
const { OAuthProvider, AuthorizationError } = await import("@cloudflare/workers-oauth-provider");
const { completeMcpAuthorization, authorizationFailure } = await import("../src/oauth-authorization.ts");
const origin = "https://mcp.xiaoman.xyz";
const clientId = "https://chatgpt.com/oauth/client.json";
const redirectUri = "https://chatgpt.com/connector_platform_oauth_redirect";
const verifier = "test-pkce-verifier-that-is-at-least-forty-three-characters";

class MemoryKV {
  values = new Map<string, string>();
  listCalls = 0;
  async get(key: string, options?: { type?: string } | string) {
    const value = this.values.get(key);
    if (value === undefined) return null;
    return options === "json" || (typeof options === "object" && options.type === "json")
      ? JSON.parse(value) : value;
  }
  async put(key: string, value: string) { this.values.set(key, value); }
  async delete(key: string) { this.values.delete(key); }
  async list(options: { prefix?: string } = {}) {
    this.listCalls++;
    return { keys: [...this.values.keys()].filter(name => name.startsWith(options.prefix ?? ""))
      .map(name => ({ name })), list_complete: true, cursor: "" };
  }
}

function harness(kv = new MemoryKV()) {
  const env: any = { OAUTH_KV: kv };
  const ctx: any = { props: {}, waitUntil() {} };
  const provider = new OAuthProvider({
    apiHandlers: Object.fromEntries(["/mcp", "/sse"].map(path => [path, {
      fetch: (_request: Request, _env: unknown, context: any) => Response.json(context.props),
    }])),
    defaultHandler: {
      async fetch(request: Request, workerEnv: any) {
        const authRequest = await workerEnv.OAUTH_PROVIDER.parseAuthRequest(request);
        const result = await completeMcpAuthorization(workerEnv.OAUTH_PROVIDER, authRequest);
        return Response.redirect(result.redirectTo, 302);
      },
    },
    authorizeEndpoint: `${origin}/authorize`,
    tokenEndpoint: `${origin}/token`,
    clientRegistrationEndpoint: `${origin}/register`,
    scopesSupported: ["mcp"],
    accessTokenTTL: 86400,
    clientIdMetadataDocumentEnabled: true,
    resourceMetadata: {
      resource: origin,
      authorization_servers: [origin],
      scopes_supported: ["mcp"],
    },
  });
  const request = (path: string, init?: RequestInit) =>
    provider.fetch(new Request(`${origin}${path}`, init), env, ctx);
  return { request };
}

function tokenRequest(body: Record<string, string>) {
  return { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString() };
}

async function authorize(request: ReturnType<typeof harness>["request"], id: string, redirect: string) {
  const params = new URLSearchParams({ client_id: id, redirect_uri: redirect,
    response_type: "code", scope: "mcp", state: "test-state", resource: origin,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256" });
  const response = await request(`/authorize?${params}`, { method: "POST" });
  assert.equal(response.status, 302);
  const callback = new URL(response.headers.get("Location")!);
  assert.equal(callback.searchParams.get("state"), "test-state");
  assert.equal(callback.searchParams.get("iss"), origin);
  return callback.searchParams.get("code")!;
}

test("ChatGPT CIMD negotiates none, exchanges PKCE codes and refreshes tokens", async t => {
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL) => {
    assert.equal(String(input), clientId);
    return Response.json({ client_id: clientId, client_name: "ChatGPT",
      redirect_uris: [redirectUri], token_endpoint_auth_method: "private_key_jwt",
      token_endpoint_auth_methods_supported: ["none", "private_key_jwt"],
      jwks_uri: "https://chatgpt.com/oauth/jwks.json" });
  });
  const { request } = harness();
  const code = await authorize(request, clientId, redirectUri);
  const exchange = await request("/token", tokenRequest({ grant_type: "authorization_code",
    client_id: clientId, code, redirect_uri: redirectUri, code_verifier: verifier, resource: origin }));
  const tokens = await exchange.json() as any;
  assert.equal(exchange.status, 200, JSON.stringify(tokens));
  assert.ok(tokens.refresh_token);
  for (const path of ["/mcp", "/sse"]) {
    const result = await request(path, { headers: { Authorization: `Bearer ${tokens.access_token}` } });
    assert.equal(result.status, 200);
    const props = await result.json() as any;
    assert.equal(props.userId, "local-user");
    assert.ok(props.approvedAt);
  }
  const refresh = await request("/token", tokenRequest({ grant_type: "refresh_token",
    client_id: clientId, refresh_token: tokens.refresh_token, resource: origin }));
  assert.equal(refresh.status, 200, await refresh.clone().text());
  const refreshed = await refresh.json() as any;
  assert.equal((await request("/mcp", { headers: { Authorization: `Bearer ${refreshed.access_token}` } })).status, 200);
  const invalid = await request("/token", tokenRequest({ grant_type: "authorization_code",
    client_id: clientId, code: "invalid-code", redirect_uri: redirectUri, code_verifier: verifier }));
  assert.equal((await invalid.json() as any).error, "invalid_grant");
});

test("DCR remains usable and an incorrect PKCE verifier is rejected", async () => {
  const { request } = harness();
  const registration = await request("/register", { method: "POST",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client_name: "VPS test",
      redirect_uris: ["http://localhost:8787/callback"], token_endpoint_auth_method: "none" }) });
  assert.equal(registration.status, 201);
  const client = await registration.json() as any;
  const code = await authorize(request, client.client_id, "http://localhost:8787/callback");
  const rejected = await request("/token", tokenRequest({ grant_type: "authorization_code",
    client_id: client.client_id, code, redirect_uri: "http://localhost:8787/callback",
    code_verifier: "incorrect-verifier-that-is-at-least-forty-three-characters", resource: origin }));
  assert.equal(rejected.status, 400);
  assert.equal((await rejected.json() as any).error, "invalid_grant");
  const freshCode = await authorize(request, client.client_id, "http://localhost:8787/callback");
  const accepted = await request("/token", tokenRequest({ grant_type: "authorization_code",
    client_id: client.client_id, code: freshCode, redirect_uri: "http://localhost:8787/callback",
    code_verifier: verifier, resource: origin }));
  assert.equal(accepted.status, 200, await accepted.clone().text());
  const unauthenticated = await request("/mcp");
  assert.equal(unauthenticated.status, 401);
  assert.match(unauthenticated.headers.get("WWW-Authenticate")!, /resource_metadata=/);
});

test("approval preserves existing connections without scanning legacy KV grants", async t => {
  const kv = new MemoryKV();
  for (let i = 0; i < 100; i++) {
    const id = String(i).padStart(16, "0");
    kv.values.set(`grant:local-user:${id}`, JSON.stringify({ id, userId: "local-user",
      clientId: `existing-client-${i}`, resource: origin, scope: ["mcp"] }));
  }
  const existing = new Map(kv.values);
  // A legacy scan would exceed the free Worker's 50 KV-operation budget.
  let reads = 0;
  const get = kv.get.bind(kv);
  t.mock.method(kv, "get", async (...args: Parameters<MemoryKV["get"]>) => {
    if (++reads > 50) throw new Error("Too many API requests by single worker invocation");
    return get(...args);
  });
  const { request } = harness(kv);
  const registration = await request("/register", { method: "POST",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client_name: "Another client",
      redirect_uris: ["http://localhost:8787/callback"], token_endpoint_auth_method: "none" }) });
  const client = await registration.json() as any;
  await authorize(request, client.client_id, "http://localhost:8787/callback");
  assert.equal(kv.listCalls, 0);
  for (const [key, value] of existing) assert.equal(kv.values.get(key), value);
});

test("authorization failures become controlled responses without leaking credentials", async () => {
  const invalid = authorizationFailure(new AuthorizationError("invalid_request", { description: "Invalid client_id" }));
  assert.equal(invalid.status, 400);
  assert.equal(invalid.headers.has("Location"), false);
  const limit = authorizationFailure(new Error("Too many API requests by single worker invocation secret-test-code"));
  assert.equal(limit.status, 503);
  const body = await limit.text();
  assert.match(body, /authorization_storage_limit/);
  assert.doesNotMatch(body, /secret-test-code/);
});
