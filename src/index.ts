import { OAuthProvider, type OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { AcMcpAgent } from "./ac-agent";
import { DeviceStateStore } from "./device-state";

// Re-export the Durable Object class so Cloudflare can find it
export { AcMcpAgent, DeviceStateStore };

// ─── Types ────────────────────────────────────────────────────────────────────

/** Props encrypted inside the OAuth access token and forwarded to the MCP agent */
export type Props = {
  userId: string;
  approvedAt: string;
};

export interface Env {
  OAUTH_KV: KVNamespace;
  AcMcpAgent: DurableObjectNamespace;
  DeviceStateStore: DurableObjectNamespace;
  COOKIE_SECRET: string;
  DEVICE_WRITE_TOKEN: string;
  // Tuya API (vars + secret)
  TUYA_BASE_URL: string;
  TUYA_CLIENT_ID: string;
  TUYA_CLIENT_SECRET: string;
  TUYA_IR_ID: string;
  TUYA_AC_ID: string;
  /** Injected at runtime by OAuthProvider — not a real wrangler binding */
  OAUTH_PROVIDER: OAuthHelpers;
}

function isAuthorizedDeviceReport(request: Request, env: Env): boolean {
  const header = request.headers.get("Authorization");
  return Boolean(env.DEVICE_WRITE_TOKEN) && header === `Bearer ${env.DEVICE_WRITE_TOKEN}`;
}

async function handleDeviceReport(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { Allow: "POST" },
    });
  }

  if (!isAuthorizedDeviceReport(request, env)) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const id = env.DeviceStateStore.idFromName("primary-phone");
  const stub = env.DeviceStateStore.get(id);
  return stub.fetch("https://device-state.internal/report", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: await request.text(),
  });
}

// ─── Authorization handler ────────────────────────────────────────────────────

function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function handleAuthorize(request: Request, env: Env): Promise<Response> {
  const oauthReq = await env.OAUTH_PROVIDER.parseAuthRequest(request);
  const clientInfo = await env.OAUTH_PROVIDER.lookupClient(oauthReq.clientId);
  const clientName = clientInfo?.clientName ?? oauthReq.clientId;

  if (request.method === "POST") {
    const form = await request.formData();
    if (form.get("action") === "approve") {
      const now = new Date().toISOString();
      const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
        request: oauthReq,
        userId: "local-user",
        metadata: { approvedAt: now },
        scope: oauthReq.scope,
        props: { userId: "local-user", approvedAt: now },
      });
      return Response.redirect(redirectTo, 302);
    }
    return new Response("授权已拒绝", { status: 400 });
  }

  // GET — render the approval UI
  const scopeLabel = oauthReq.scope.length ? oauthReq.scope.join(", ") : "基本访问";

  return new Response(
    `<!DOCTYPE html>
<html lang="zh">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>授权访问 — 空调控制器</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Helvetica Neue", sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px;
    }
    .card {
      background: #fff; border-radius: 16px; padding: 36px 32px;
      max-width: 440px; width: 100%; box-shadow: 0 20px 60px rgba(0,0,0,.2);
    }
    .icon { font-size: 56px; text-align: center; margin-bottom: 20px; }
    h1 { font-size: 21px; color: #1a1a2e; text-align: center; margin-bottom: 8px; }
    .subtitle { color: #666; text-align: center; font-size: 14px; margin-bottom: 24px; }
    .client { color: #0066ff; font-weight: 600; }
    .perms {
      background: #f8faff; border: 1px solid #d0e4ff; border-radius: 10px;
      padding: 16px 20px; margin: 20px 0;
    }
    .perms h3 { font-size: 12px; color: #666; font-weight: 500; text-transform: uppercase; letter-spacing: .5px; margin-bottom: 10px; }
    .perm { display: flex; align-items: center; gap: 8px; padding: 6px 0; font-size: 14px; color: #333; border-bottom: 1px solid #e8f0fe; }
    .perm:last-child { border-bottom: none; }
    .check { color: #22c55e; }
    .btns { display: flex; gap: 12px; margin-top: 28px; }
    .btn { flex: 1; padding: 13px 20px; border: none; border-radius: 10px; font-size: 15px; font-weight: 600; cursor: pointer; transition: all .2s; }
    .approve { background: linear-gradient(135deg, #0066ff, #0052cc); color: #fff; }
    .approve:hover { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(0,102,255,.4); }
    .deny { background: #f0f0f0; color: #555; }
    .deny:hover { background: #e0e0e0; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">❄️</div>
    <h1>授权访问空调控制器</h1>
    <p class="subtitle"><span class="client">${escHtml(clientName)}</span> 请求控制您的空调设备</p>
    <div class="perms">
      <h3>将获得以下权限</h3>
      <div class="perm"><span class="check">✓</span> 查看空调状态（温度、模式、风速）</div>
      <div class="perm"><span class="check">✓</span> 控制空调开关</div>
      <div class="perm"><span class="check">✓</span> 调节温度（16–30°C）</div>
      <div class="perm"><span class="check">✓</span> 切换运行模式与风速</div>
      <div class="perm"><span class="check">✓</span> 查看手机主动上报的设备、位置和天气状态（只读）</div>
      <div class="perm"><span class="check">✓</span> 读取用户手写的互动准则（只读）</div>
      <div class="perm"><span class="check">✓</span> 在用户明确要求时新增互动准则</div>
      <div class="perm"><span class="check">✓</span> 权限范围：${escHtml(scopeLabel)}</div>
    </div>
    <form method="POST">
      <div class="btns">
        <button type="submit" name="action" value="approve" class="btn approve">✓ 授权</button>
        <button type="submit" name="action" value="deny"    class="btn deny">✕ 拒绝</button>
      </div>
    </form>
  </div>
</body>
</html>`,
    { headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}

// ─── Landing page ─────────────────────────────────────────────────────────────

function landingPage(origin: string): Response {
  return new Response(
    `<!DOCTYPE html>
<html lang="zh">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>空调 MCP 控制器</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif; max-width: 640px; margin: 72px auto; padding: 0 20px; color: #1a1a2e; }
    h1 { font-size: 28px; margin-bottom: 6px; }
    .badge { display: inline-block; background: #e8f0fe; color: #1a56db; border-radius: 4px; padding: 2px 8px; font-size: 12px; font-weight: 600; margin-bottom: 18px; }
    p { color: #444; line-height: 1.7; margin: 12px 0; }
    code { background: #f3f4f6; padding: 2px 6px; border-radius: 4px; font-size: 14px; }
    h2 { font-size: 16px; margin: 28px 0 10px; color: #333; }
    .tool { display: flex; gap: 12px; align-items: flex-start; padding: 10px 14px; border: 1px solid #e5e7eb; border-radius: 8px; margin: 6px 0; }
    .tool-name { font-weight: 600; font-size: 14px; min-width: 160px; color: #0052cc; font-family: monospace; }
    .tool-desc { font-size: 14px; color: #555; }
  </style>
</head>
<body>
  <h1>❄️ 空调 MCP 控制器</h1>
  <span class="badge">MCP · SSE · OAuth 2.0</span>
  <p>这是一个运行在 Cloudflare Workers 上的 MCP 服务器，支持通过 Claude 应用控制空调设备。</p>
  <h2>如何连接</h2>
  <p>在 Claude 应用的 MCP 连接器设置中，填入以下地址：</p>
  <p><code>${origin}/sse</code></p>
  <p>Claude 会自动引导完成 OAuth 授权流程，授权后即可使用以下工具：</p>
  <h2>可用工具</h2>
  <div class="tool"><span class="tool-name">get_ac_status</span><span class="tool-desc">获取空调当前状态（电源、温度、模式、风速）</span></div>
  <div class="tool"><span class="tool-name">turn_on_ac</span><span class="tool-desc">开启空调</span></div>
  <div class="tool"><span class="tool-name">turn_off_ac</span><span class="tool-desc">关闭空调</span></div>
  <div class="tool"><span class="tool-name">set_temperature</span><span class="tool-desc">设置目标温度（16–30°C）</span></div>
  <div class="tool"><span class="tool-name">set_mode</span><span class="tool-desc">切换运行模式（制冷 / 制热 / 送风 / 自动 / 除湿）</span></div>
  <div class="tool"><span class="tool-name">set_fan_speed</span><span class="tool-desc">调节风速（低速 / 中速 / 高速 / 自动）</span></div>
  <div class="tool"><span class="tool-name">get_device_status</span><span class="tool-desc">查看手机最近主动上报的电量、定位、天气、App 使用动态与数据新鲜度</span></div>
  <div class="tool"><span class="tool-name">get_interaction_rules</span><span class="tool-desc">读取记忆库中用户手写的长期互动准则</span></div>
  <div class="tool"><span class="tool-name">add_interaction_rule</span><span class="tool-desc">在用户明确要求时新增一条长期互动准则</span></div>
</body>
</html>`,
    { headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}

// ─── Default handler (non-API routes: landing page + authorize UI) ────────────

const defaultHandler = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);

    if (pathname === "/device/report") return handleDeviceReport(request, env);
    if (pathname === "/authorize") return handleAuthorize(request, env);
    if (pathname === "/" || pathname === "") return landingPage(new URL(request.url).origin);

    return new Response("Not Found", { status: 404 });
  },
};

// ─── Main export: OAuthProvider wraps the MCP agent ──────────────────────────

export default new OAuthProvider({
  // /sse = legacy HTTP+SSE transport, /mcp = Streamable HTTP (ChatGPT uses this).
  // binding must match the Durable Object binding name in wrangler.toml —
  // the library default is "MCP_OBJECT", which silently 500s if omitted.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  apiHandlers: {
    "/sse": AcMcpAgent.serveSSE("/sse", { binding: "AcMcpAgent" }),
    "/mcp": AcMcpAgent.serve("/mcp", { binding: "AcMcpAgent" }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  defaultHandler: defaultHandler as any,
  // Absolute URLs so DCR responses (registration_client_uri) and AS metadata
  // are absolute — ChatGPT's DCR client rejects relative URIs.
  authorizeEndpoint: "https://mcp.xiaoman.xyz/authorize",
  tokenEndpoint: "https://mcp.xiaoman.xyz/token",
  clientRegistrationEndpoint: "https://mcp.xiaoman.xyz/register",
  scopesSupported: ["mcp"],
  accessTokenTTL: 86400, // 24 h
  // Tokens carry an origin-only resource; accept them for /sse and /mcp paths.
  resourceMatchOriginOnly: true,
  // CIMD (URL-shaped client_ids) preferred by ChatGPT; DCR stays as fallback.
  // Requires the global_fetch_strictly_public compatibility flag.
  clientIdMetadataDocumentEnabled: true,
  // RFC 9728 — served at /.well-known/oauth-protected-resource
  resourceMetadata: {
    resource: "https://mcp.xiaoman.xyz",
    authorization_servers: ["https://mcp.xiaoman.xyz"],
    scopes_supported: ["mcp"],
    resource_name: "AC MCP Controller",
  },
  // The library's WWW-Authenticate omits scope; MCP clients use it to
  // request the right scope during discovery, so append it on 401s.
  onError({ code, description, status, headers }) {
    const www = headers["WWW-Authenticate"];
    if (status === 401 && www && !/\bscope=/.test(www)) {
      return new Response(
        JSON.stringify({ error: code, error_description: description }),
        {
          status,
          headers: {
            "Content-Type": "application/json",
            ...headers,
            "WWW-Authenticate": `${www}, scope="mcp"`,
          },
        }
      );
    }
  },
});
