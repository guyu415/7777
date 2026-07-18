import type { Env } from "./index";

const TEXT_ENCODER = new TextEncoder();
const WEAPI_IV = "0102030405060708";
const WEAPI_PRESET_KEY = "0CoJUm6Qyw8W8jud";
const WEAPI_BASE62 = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const WEAPI_PUBLIC_EXPONENT = 0x10001n;
const WEAPI_MODULUS = BigInt(
  "0xe0b509f6259df8642dbc35662901477df22677ec152b5ff68ace615bb7b725152b3ab17a876aea8a5aa76d2e417629ec4ee341f56135fccf695280104e0312ecbda92557c93870114af6c9d05c4f7f0c3685b7a46bee255932575cce10b424d813cfe4875d3e82047b97ddef52741d546b8e289dc6935b3ece0462db0a22b8e7"
);

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function aesCbcBase64(plaintext: string, keyText: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    TEXT_ENCODER.encode(keyText),
    { name: "AES-CBC" },
    false,
    ["encrypt"]
  );
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-CBC", iv: TEXT_ENCODER.encode(WEAPI_IV) },
    key,
    TEXT_ENCODER.encode(plaintext)
  );
  return bytesToBase64(new Uint8Array(encrypted));
}

function randomSecretKey(): string {
  const random = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(random, (byte) => WEAPI_BASE62[byte % WEAPI_BASE62.length]).join("");
}

function bytesToBigInt(bytes: Uint8Array): bigint {
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  return value;
}

function modPow(base: bigint, exponent: bigint, modulus: bigint): bigint {
  let result = 1n;
  let factor = base % modulus;
  let power = exponent;
  while (power > 0n) {
    if (power & 1n) result = (result * factor) % modulus;
    factor = (factor * factor) % modulus;
    power >>= 1n;
  }
  return result;
}

function rsaEncryptWithoutPadding(plaintext: string): string {
  const message = bytesToBigInt(TEXT_ENCODER.encode(plaintext));
  return modPow(message, WEAPI_PUBLIC_EXPONENT, WEAPI_MODULUS)
    .toString(16)
    .padStart(256, "0");
}

async function encryptWeapi(payload: UnknownRecord): Promise<{ params: string; encSecKey: string }> {
  const secretKey = randomSecretKey();
  const firstPass = await aesCbcBase64(JSON.stringify(payload), WEAPI_PRESET_KEY);
  return {
    params: await aesCbcBase64(firstPass, secretKey),
    encSecKey: rsaEncryptWithoutPadding(secretKey.split("").reverse().join("")),
  };
}

function normalizeCookie(rawCookie: string): string {
  const compact = rawCookie.replace(/[\r\n]+/g, " ").trim();
  if (!compact) return "";
  const cookie = /(?:^|;\s*)MUSIC_U=/i.test(compact) ? compact : `MUSIC_U=${compact}`;
  return /(?:^|;\s*)os=/i.test(cookie) ? cookie : `${cookie}; os=pc`;
}

function cookieValue(cookie: string, name: string): string {
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`, "i"));
  return match?.[1] ?? "";
}

function cleanText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text || undefined;
}

function cleanNumber(value: unknown): number | undefined {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function artistNames(song: UnknownRecord): string[] {
  const candidates = Array.isArray(song.ar)
    ? song.ar
    : Array.isArray(song.artists)
      ? song.artists
      : [];
  return candidates
    .map((artist) => isRecord(artist) ? cleanText(artist.name) : undefined)
    .filter((name): name is string => Boolean(name));
}

function albumName(song: UnknownRecord): string | undefined {
  const album = isRecord(song.al) ? song.al : isRecord(song.album) ? song.album : null;
  return album ? cleanText(album.name) : undefined;
}

function extractRecentSong(payload: UnknownRecord, checkedAtMs: number) {
  const data = isRecord(payload.data) ? payload.data : null;
  const list = data && Array.isArray(data.list) ? data.list : [];
  const first = isRecord(list[0]) ? list[0] : null;
  const resource = first && isRecord(first.resource) ? first.resource : null;
  if (!first || !resource) return null;

  const id = cleanNumber(resource.id ?? first.resourceId);
  const name = cleanText(resource.name);
  if (id === undefined || !name) return null;

  const playTimeMs = cleanNumber(first.playTime);
  const durationMs = cleanNumber(resource.dt ?? resource.duration);
  const ageSeconds = playTimeMs === undefined
    ? undefined
    : Math.max(0, Math.round((checkedAtMs - playTimeMs) / 1000));
  const likelyPlaying = ageSeconds !== undefined && durationMs !== undefined
    ? ageSeconds <= Math.ceil(durationMs / 1000) + 120
    : ageSeconds !== undefined && ageSeconds <= 10 * 60;

  return {
    id,
    name,
    artists: artistNames(resource),
    album: albumName(resource) ?? null,
    durationSeconds: durationMs === undefined ? null : Math.round(durationMs / 1000),
    playedAt: playTimeMs === undefined ? null : new Date(playTimeMs).toISOString(),
    ageSeconds: ageSeconds ?? null,
    likelyPlaying,
  };
}

function noStoreJson(body: unknown, init?: ResponseInit): Response {
  const response = Response.json(body, init);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function handleNeteaseRecentProbe(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { Allow: "GET", "Cache-Control": "no-store" },
    });
  }

  const rawCookie = env.NCM_COOKIE?.trim();
  if (!rawCookie) {
    return noStoreJson(
      { ok: false, error: "NCM_COOKIE secret is not configured" },
      { status: 503 }
    );
  }

  const cookie = normalizeCookie(rawCookie);
  const encrypted = await encryptWeapi({
    limit: 1,
    csrf_token: cookieValue(cookie, "__csrf"),
  });
  const body = new URLSearchParams(encrypted);
  const checkedAtMs = Date.now();

  try {
    const upstream = await fetch("https://music.163.com/weapi/play-record/song/list", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Cookie": cookie,
        "Referer": "https://music.163.com/",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36",
      },
      body: body.toString(),
    });
    const payload = await upstream.json<unknown>().catch(() => null);
    const upstreamCode = isRecord(payload) ? cleanNumber(payload.code) : undefined;

    if (!upstream.ok || !isRecord(payload) || upstreamCode !== 200) {
      const loginExpired = upstreamCode === 301 || upstream.status === 301;
      return noStoreJson(
        {
          ok: false,
          error: loginExpired ? "网易云登录态已失效" : "网易云最近播放接口请求失败",
          upstreamHttpStatus: upstream.status,
          upstreamCode: upstreamCode ?? null,
        },
        { status: 502 }
      );
    }

    return noStoreJson({
      ok: true,
      checkedAt: new Date(checkedAtMs).toISOString(),
      song: extractRecentSong(payload, checkedAtMs),
    });
  } catch (error) {
    return noStoreJson(
      {
        ok: false,
        error: "网易云最近播放接口连接失败",
        detail: error instanceof Error ? error.message.slice(0, 160) : String(error).slice(0, 160),
      },
      { status: 502 }
    );
  }
}
