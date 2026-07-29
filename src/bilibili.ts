import type { Env } from "./index";

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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

function normalizeCookie(rawCookie: string): string {
  const compact = rawCookie.replace(/[\r\n]+/g, " ").trim();
  if (!compact) return "";
  return /(?:^|;\s*)SESSDATA=/i.test(compact) ? compact : `SESSDATA=${compact}`;
}

function bilibiliHeaders(cookie: string): HeadersInit {
  return {
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    Cookie: cookie,
    Origin: "https://www.bilibili.com",
    Referer: "https://www.bilibili.com/",
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-site",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/138.0.0.0 Safari/537.36",
  };
}

function noStoreJson(body: unknown, init?: ResponseInit): Response {
  const response = Response.json(body, init);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function timestampToIso(value: unknown): string | null {
  const timestamp = cleanNumber(value);
  if (timestamp === undefined || timestamp <= 0) return null;
  const milliseconds = timestamp > 1_000_000_000_000 ? timestamp : timestamp * 1000;
  const date = new Date(milliseconds);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function uniqueEpisodeTitle(item: UnknownRecord, history: UnknownRecord, title: string) {
  const candidates = [
    cleanText(item.long_title),
    cleanText(item.show_title),
    cleanText(history.part),
    cleanText(item.current),
  ];
  return candidates.find((candidate) => candidate && candidate !== title) ?? null;
}

export function extractLatestHistory(payload: UnknownRecord, checkedAtMs: number) {
  const data = payload.data;
  const list = Array.isArray(data)
    ? data
    : isRecord(data) && Array.isArray(data.list)
      ? data.list
      : [];
  const item = isRecord(list[0]) ? list[0] : null;
  // The cursor API nests identity fields under `history`; the legacy API
  // returns the same fields directly on each item.
  const history = item && isRecord(item.history) ? item.history : item;
  if (!item || !history) return null;

  const title = cleanText(item.title);
  if (!title) return null;

  const duration = cleanNumber(item.duration);
  const rawProgress = cleanNumber(item.progress);
  const completed = rawProgress === -1 || (
    rawProgress !== undefined &&
    duration !== undefined &&
    duration > 0 &&
    rawProgress >= duration * 0.95
  );
  const progress = rawProgress === undefined
    ? null
    : rawProgress < 0
      ? duration ?? null
      : Math.max(0, rawProgress);
  const viewedAt = timestampToIso(item.view_at);
  const viewedAtMs = viewedAt ? new Date(viewedAt).getTime() : undefined;
  const ageSeconds = viewedAtMs === undefined
    ? null
    : Math.max(0, Math.round((checkedAtMs - viewedAtMs) / 1000));

  // Bilibili's history is not a live-player feed. The freshness window allows
  // for long videos while capping stale "still watching" guesses at four hours.
  const freshnessWindow = duration === undefined
    ? 10 * 60
    : Math.min(4 * 60 * 60, Math.max(10 * 60, duration + 2 * 60));
  const likelyWatching = ageSeconds !== null && ageSeconds <= freshnessWindow && !completed;

  const business = cleanText(history.business) ?? "archive";
  const bvid = cleanText(history.bvid) ?? cleanText(item.bvid) ?? null;
  const page = cleanNumber(history.page) ?? null;
  const episodeId = cleanNumber(history.epid) ?? null;
  const oid = cleanNumber(history.oid) ?? null;
  const cid = cleanNumber(history.cid) ?? null;
  const seasonId = cleanNumber(history.season_id) ?? null;
  const historyKey = episodeId !== null
    ? `${business}:ep${episodeId}`
    : bvid
      ? `${business}:${bvid}:p${page ?? 1}`
      : `${business}:oid${oid ?? "unknown"}:p${page ?? 1}`;

  return {
    source: "account-history" as const,
    historyKey,
    title,
    episodeTitle: uniqueEpisodeTitle(item, history, title),
    authorName: cleanText(item.author_name) ?? null,
    business,
    aid: business === "archive" ? oid : null,
    bvid,
    cid,
    episodeId,
    seasonId,
    page,
    url: cleanText(item.uri) ?? null,
    cover: cleanText(item.cover) ?? null,
    durationSeconds: duration === undefined ? null : Math.max(0, Math.round(duration)),
    progressSeconds: progress === null ? null : Math.round(progress),
    progressPercent: progress !== null && duration !== undefined && duration > 0
      ? Math.min(100, Math.max(0, Math.round((progress / duration) * 100)))
      : null,
    viewedAt,
    ageSeconds,
    completed,
    likelyWatching,
  };
}

export async function handleBilibiliRecentProbe(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { Allow: "GET", "Cache-Control": "no-store" },
    });
  }

  const rawCookie = env.BILIBILI_COOKIE?.trim();
  if (!rawCookie) {
    return noStoreJson(
      { ok: false, error: "BILIBILI_COOKIE secret is not configured" },
      { status: 503 }
    );
  }

  const cookie = normalizeCookie(rawCookie);
  const headers = bilibiliHeaders(cookie);
  const checkedAtMs = Date.now();

  try {
    const historyUrl = new URL("https://api.bilibili.com/x/web-interface/history/cursor");
    historyUrl.searchParams.set("max", "0");
    historyUrl.searchParams.set("view_at", "0");
    historyUrl.searchParams.set("business", "");
    historyUrl.searchParams.set("ps", "1");

    const historyResponse = await fetch(historyUrl, { headers });
    let payload = await historyResponse.json<unknown>().catch(() => null);
    let upstreamCode = isRecord(payload) ? cleanNumber(payload.code) : undefined;
    let upstreamStatus = historyResponse.status;

    if (historyResponse.status === 412 || upstreamCode === -412) {
      const legacyUrl = new URL("https://api.bilibili.com/x/v2/history");
      legacyUrl.searchParams.set("pn", "1");
      legacyUrl.searchParams.set("ps", "1");
      const legacyResponse = await fetch(legacyUrl, { headers });
      payload = await legacyResponse.json<unknown>().catch(() => null);
      upstreamCode = isRecord(payload) ? cleanNumber(payload.code) : undefined;
      upstreamStatus = legacyResponse.status;
    }

    if (upstreamStatus < 200 || upstreamStatus >= 300 || !isRecord(payload) || upstreamCode !== 0) {
      const loginExpired = upstreamCode === -101;
      return noStoreJson(
        {
          ok: false,
          error: loginExpired ? "B站登录态已失效" : "B站最近观看接口请求失败",
          upstreamHttpStatus: upstreamStatus,
          upstreamCode: upstreamCode ?? null,
        },
        { status: 502 }
      );
    }

    return noStoreJson({
      ok: true,
      checkedAt: new Date(checkedAtMs).toISOString(),
      video: extractLatestHistory(payload, checkedAtMs),
    });
  } catch (error) {
    return noStoreJson(
      {
        ok: false,
        error: "B站最近观看接口连接失败",
        detail: error instanceof Error ? error.message.slice(0, 160) : String(error).slice(0, 160),
      },
      { status: 502 }
    );
  }
}
