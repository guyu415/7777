// Shadowrocket http-request script for:
// ^https:\/\/api\.bilibili\.com\/x\/v2\/history\/report
// Enable request-body access and MITM for api.bilibili.com.

const REPORT_URL = "https://mcp.xiaoman.xyz/device/bilibili-report";
const MODULE_ARGUMENT = typeof $argument === "string" ? $argument.trim() : "";
const DEVICE_WRITE_TOKEN = MODULE_ARGUMENT || "把DEVICE_WRITE_TOKEN粘贴到这里";

function finish() {
  $done({});
}

function requestHeader(name) {
  const target = name.toLowerCase();
  const headers = $request.headers || {};
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === target) return headers[key];
  }
  return "";
}

function parseForm(body) {
  const result = {};
  for (const pair of String(body || "").split("&")) {
    if (!pair) continue;
    const separator = pair.indexOf("=");
    const rawKey = separator < 0 ? pair : pair.slice(0, separator);
    const rawValue = separator < 0 ? "" : pair.slice(separator + 1);
    try {
      const key = decodeURIComponent(rawKey.replace(/\+/g, " "));
      result[key] = decodeURIComponent(rawValue.replace(/\+/g, " "));
    } catch {
      // Ignore malformed telemetry fields rather than interrupting playback.
    }
  }
  return result;
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function getJson(url) {
  const cookie = requestHeader("Cookie");
  const userAgent = requestHeader("User-Agent");
  return new Promise((resolve, reject) => {
    $httpClient.get({
      url,
      headers: {
        Accept: "application/json, text/plain, */*",
        ...(cookie ? { Cookie: cookie } : {}),
        ...(userAgent ? { "User-Agent": userAgent } : {}),
      },
    }, (error, response, data) => {
      if (error) return reject(error);
      const status = response && (response.status || response.statusCode);
      if (!status || status < 200 || status >= 300) {
        return reject(new Error(`B站详情请求失败：HTTP ${status || "unknown"}`));
      }
      try {
        resolve(JSON.parse(data));
      } catch (parseError) {
        reject(parseError);
      }
    });
  });
}

function postReport(report) {
  return new Promise((resolve, reject) => {
    $httpClient.post({
      url: REPORT_URL,
      headers: {
        Authorization: `Bearer ${DEVICE_WRITE_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(report),
    }, (error, response, data) => {
      if (error) return reject(error);
      const status = response && (response.status || response.statusCode);
      if (!status || status < 200 || status >= 300) {
        return reject(new Error(`小G上报失败：HTTP ${status || "unknown"} ${data || ""}`));
      }
      resolve();
    });
  });
}

function cachedMetadata(key) {
  if (typeof $persistentStore === "undefined") return null;
  const raw = $persistentStore.read(`bilibili-metadata:${key}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveMetadata(key, metadata) {
  if (typeof $persistentStore === "undefined") return;
  $persistentStore.write(JSON.stringify(metadata), `bilibili-metadata:${key}`);
}

function seconds(value) {
  const number = finiteNumber(value);
  if (number === undefined) return undefined;
  return number > 10000 ? Math.round(number / 1000) : Math.round(number);
}

async function pgcMetadata(epid) {
  const payload = await getJson(
    `https://api.bilibili.com/pgc/view/web/season?ep_id=${encodeURIComponent(epid)}`
  );
  const season = payload.result || payload.data || {};
  const episodes = Array.isArray(season.episodes) ? season.episodes : [];
  const episode = episodes.find((item) =>
    String(item.id || item.ep_id || item.epid || "") === String(epid)
  ) || {};
  const episodeTitle = [episode.title, episode.long_title].filter(Boolean).join("：");
  return {
    title: season.title || season.season_title || `B站番剧 ep${epid}`,
    episodeTitle: episodeTitle || null,
    authorName: null,
    business: "pgc",
    aid: finiteNumber(episode.aid),
    bvid: episode.bvid || null,
    cid: finiteNumber(episode.cid),
    episodeId: finiteNumber(epid),
    seasonId: finiteNumber(season.season_id),
    durationSeconds: seconds(episode.duration),
    url: `https://www.bilibili.com/bangumi/play/ep${epid}`,
  };
}

async function archiveMetadata(aid, cid) {
  const payload = await getJson(
    `https://api.bilibili.com/x/web-interface/view?aid=${encodeURIComponent(aid)}`
  );
  const video = payload.data || {};
  const pages = Array.isArray(video.pages) ? video.pages : [];
  const page = pages.find((item) => String(item.cid || "") === String(cid)) || pages[0] || {};
  return {
    title: video.title || `B站视频 av${aid}`,
    episodeTitle: page.part || null,
    authorName: video.owner && video.owner.name ? video.owner.name : null,
    business: "archive",
    aid: finiteNumber(video.aid || aid),
    bvid: video.bvid || null,
    cid: finiteNumber(page.cid || cid),
    episodeId: null,
    seasonId: null,
    page: finiteNumber(page.page),
    durationSeconds: seconds(page.duration || video.duration),
    url: video.bvid
      ? `https://www.bilibili.com/video/${video.bvid}${page.page > 1 ? `?p=${page.page}` : ""}`
      : `https://www.bilibili.com/video/av${aid}`,
  };
}

(async () => {
  if (!DEVICE_WRITE_TOKEN || DEVICE_WRITE_TOKEN.includes("粘贴")) {
    throw new Error("尚未填写 DEVICE_WRITE_TOKEN");
  }

  const form = parseForm($request.body);
  const aid = finiteNumber(form.aid);
  const cid = finiteNumber(form.cid);
  const epid = finiteNumber(form.epid || form.ep_id);
  const sid = finiteNumber(form.sid);
  const progress = finiteNumber(form.progress);

  if (aid === undefined && epid === undefined) return;

  const metadataKey = epid !== undefined ? `ep:${epid}` : `av:${aid}`;
  let metadata = cachedMetadata(metadataKey);
  if (!metadata) {
    metadata = epid !== undefined
      ? await pgcMetadata(epid)
      : await archiveMetadata(aid, cid);
    saveMetadata(metadataKey, metadata);
  }

  await postReport({
    ...metadata,
    aid: metadata.aid ?? aid ?? null,
    cid: metadata.cid ?? cid ?? null,
    episodeId: metadata.episodeId ?? epid ?? null,
    seasonId: metadata.seasonId ?? sid ?? null,
    progressSeconds: progress === undefined
      ? null
      : progress < 0 && metadata.durationSeconds
        ? metadata.durationSeconds
        : Math.max(0, Math.round(progress)),
    reportedAt: new Date().toISOString(),
  });
})()
  .catch((error) => console.log(`[小G B站查岗] ${error && error.message ? error.message : error}`))
  .finally(finish);
