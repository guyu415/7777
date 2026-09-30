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
const { OAuthProvider } = await import("@cloudflare/workers-oauth-provider");
const origin = "https://mcp.xiaoman.xyz";
const clientId = "https://chatgpt.com/oauth/client.json";
const redirectUri = "https://chatgpt.com/connector_platform_oauth_redirect";
const verifier = "test-pkce-verifier-that-is-at-least-forty-three-characters";

class MemoryKV {
  values = new Map<string, string>();
  async get(key: string, options?: { type?: string } | string) {
    const value = this.values.get(key);
    if (value === undefined) return null;
    return options === "json" || (typeof options === "object" && options.type === "json")
      ? JSON.parse(value) : value;
  }
  async put(key: string, value: string) { this.values.set(key, value); }
  async delete(key: string) { this.values.delete(key); }
  async list(options: { prefix?: string } = {}) {
    return { keys: [...this.values.keys()].filter(name => name.startsWith(options.prefix ?? ""))
      .map(name => ({ name })), list_complete: true, cursor: "" };
  }
}

function harness() {
  const env: any = { OAUTH_KV: new MemoryKV() };
  const ctx: any = { props: {}, waitUntil() {} };
  const provider = new OAuthProvider({
    apiHandlers: Object.fromEntries(["/mcp", "/sse"].map(path => [path, {
      fetch: (_request: Request, _env: unknown, context: any) => Response.json(context.props),
    }])),
    defaultHandler: {
      async fetch(request: Request, workerEnv: any) {
        const authRequest = await workerEnv.OAUTH_PROVIDER.parseAuthRequest(request);
        const result = await workerEnv.OAUTH_PROVIDER.completeAuthorization({
          request: authRequest,
          userId: "test-user",
          metadata: { test: true },
          scope: authRequest.scope,
          props: { userId: "test-user" },
        });
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
    assert.deepEqual(await result.json(), { userId: "test-user" });
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
