/**
 * Tuya Cloud API client for IR air-conditioner control.
 *
 * Signing algorithm: HMAC-SHA256
 *   non-token requests: client_id + access_token + t + nonce + StringToSign
 *   token request:      client_id              + t + nonce + StringToSign
 *   StringToSign = METHOD\nSHA256(body)\n\npathAndQuery
 */

export interface TuyaEnv {
  TUYA_BASE_URL: string;
  TUYA_CLIENT_ID: string;
  TUYA_CLIENT_SECRET: string;
  TUYA_IR_ID: string;
  TUYA_AC_ID: string;
}

export interface AcStatus {
  power: number; // 0 = off, 1 = on
  mode:  number; // see MODE_TO_TUYA in ac-agent.ts
  temp:  number; // °C
  wind:  number; // see WIND_TO_TUYA in ac-agent.ts
}

// ─── Crypto helpers (Web Crypto API, available in Workers) ───────────────────

async function sha256Hex(data: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}

async function hmacSha256Upper(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, "0")).join("").toUpperCase();
}

async function stringToSign(method: string, body: string, pathAndQuery: string): Promise<string> {
  const hash = await sha256Hex(body);
  return [method.toUpperCase(), hash, "", pathAndQuery].join("\n");
}

// ─── Token ───────────────────────────────────────────────────────────────────

export async function getTuyaToken(env: TuyaEnv): Promise<{ access_token: string; expire_time: number }> {
  const pathAndQuery = "/v1.0/token?grant_type=1";
  const t     = Date.now().toString();
  const nonce = crypto.randomUUID();
  const sts   = await stringToSign("GET", "", pathAndQuery);
  const sign  = await hmacSha256Upper(env.TUYA_CLIENT_SECRET, env.TUYA_CLIENT_ID + t + nonce + sts);

  const resp = await fetch(env.TUYA_BASE_URL + pathAndQuery, {
    headers: {
      client_id:   env.TUYA_CLIENT_ID,
      t,
      nonce,
      sign_method: "HMAC-SHA256",
      sign,
    },
  });
  if (!resp.ok) throw new Error(`Tuya token HTTP ${resp.status}: ${await resp.text()}`);

  const json = await resp.json() as {
    success: boolean;
    result:  { access_token: string; expire_time: number };
    msg?:    string;
  };
  if (!json.success) throw new Error(`Tuya token error: ${json.msg}`);
  return json.result;
}

// ─── Generic authenticated request ───────────────────────────────────────────

async function tuyaCall<T>(
  env:           TuyaEnv,
  token:         string,
  method:        string,
  pathAndQuery:  string,
  body?:         Record<string, unknown>
): Promise<T> {
  const t       = Date.now().toString();
  const nonce   = crypto.randomUUID();
  const bodyStr = body ? JSON.stringify(body) : "";
  const sts     = await stringToSign(method, bodyStr, pathAndQuery);
  const sign    = await hmacSha256Upper(
    env.TUYA_CLIENT_SECRET,
    env.TUYA_CLIENT_ID + token + t + nonce + sts
  );

  const resp = await fetch(env.TUYA_BASE_URL + pathAndQuery, {
    method,
    headers: {
      client_id:    env.TUYA_CLIENT_ID,
      access_token: token,
      t,
      nonce,
      sign_method:  "HMAC-SHA256",
      sign,
      "Content-Type": "application/json",
    },
    body: body ? bodyStr : undefined,
  });
  if (!resp.ok) throw new Error(`Tuya API HTTP ${resp.status}: ${await resp.text()}`);

  const json = await resp.json() as { success: boolean; result: T; msg?: string; code?: number };
  if (!json.success) throw new Error(`Tuya API error ${json.code}: ${json.msg}`);
  return json.result;
}

// ─── AC-specific calls ───────────────────────────────────────────────────────

export function sendAcCommand(
  env:   TuyaEnv,
  token: string,
  cmd:   { power: number; mode: number; temp: number; wind: number }
): Promise<unknown> {
  const path = `/v2.0/infrareds/${env.TUYA_IR_ID}/air-conditioners/${env.TUYA_AC_ID}/scenes/command`;
  return tuyaCall(env, token, "POST", path, cmd);
}

export function getAcStatus(env: TuyaEnv, token: string): Promise<AcStatus> {
  const path = `/v2.0/infrareds/${env.TUYA_IR_ID}/remotes/${env.TUYA_AC_ID}/ac/status`;
  return tuyaCall<AcStatus>(env, token, "GET", path);
}
