import type { Env } from "./index";

export type AppAction = "open" | "close";

export interface DeviceReport {
  reportedAt?: string;
  batteryLevel?: number;
  charging?: boolean;
  deviceName?: string;
  deviceModel?: string;
  systemName?: string;
  systemVersion?: string;
  networkType?: string;
  focusMode?: string;
  locationName?: string;
  latitude?: number;
  longitude?: number;
  locationAccuracyMeters?: number;
  weatherCondition?: string;
  temperatureC?: number;
  feelsLikeC?: number;
  precipitationChance?: number;
  appName?: string;
  appAction?: AppAction;
}

export interface ResolvedLocation {
  source: "amap";
  formattedAddress?: string;
  township?: string;
  neighborhood?: string;
  nearestRoad?: {
    name: string;
    distanceMeters?: number;
    direction?: string;
  };
  nearbyLandmarks: Array<{
    name: string;
    distanceMeters?: number;
    direction?: string;
    address?: string;
  }>;
  resolvedAt: string;
}

export interface StoredDeviceReport extends DeviceReport {
  receivedAt: string;
  /** Updated only when the payload contains device/context fields, not for app-only events. */
  statusReportedAt?: string;
  /** Server-side reverse geocoding result for the coordinates in this report. */
  resolvedLocation?: ResolvedLocation | null;
}

export interface AppEvent {
  appName: string;
  action: AppAction;
  occurredAt: string;
  receivedAt: string;
}

export interface AppSession {
  appName: string;
  openedAt: string;
  closedAt: string;
  durationSeconds: number;
}

export interface DeviceSnapshot {
  latest: StoredDeviceReport | null;
  activeApps: Record<string, string>;
  recentEvents: AppEvent[];
  recentSessions: AppSession[];
}

const MAX_EVENTS = 100;
const MAX_SESSIONS = 100;

function cleanText(value: unknown, maxLength = 120): string | undefined {
  if (typeof value === "number" || typeof value === "boolean") value = String(value);
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text ? text.slice(0, maxLength) : undefined;
}

/** Accepts 85, "85", "85%", "85.0 %" — Shortcuts often sends numbers as text */
function cleanNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value.replace(/%/g, "").trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function apiText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text ? text : undefined;
}

function apiDistance(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value
    : typeof value === "string" ? Number.parseFloat(value)
    : Number.NaN;
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : undefined;
}

async function reverseGeocodeWithAmap(
  env: Env,
  latitude: number,
  longitude: number
): Promise<ResolvedLocation | undefined> {
  const key = env.AMAP_WEB_SERVICE_KEY?.trim();
  if (!key) return undefined;

  // iPhone Core Location reports WGS84 coordinates. AMap uses GCJ-02, so
  // convert the coordinate before reverse geocoding to avoid a several-hundred
  // metre offset in mainland China.
  const source = `${longitude.toFixed(6)},${latitude.toFixed(6)}`;
  const convertUrl = new URL("https://restapi.amap.com/v3/assistant/coordinate/convert");
  convertUrl.searchParams.set("key", key);
  convertUrl.searchParams.set("locations", source);
  convertUrl.searchParams.set("coordsys", "gps");
  convertUrl.searchParams.set("output", "JSON");

  const convertResponse = await fetch(convertUrl);
  if (!convertResponse.ok) {
    throw new Error(`高德坐标转换失败（HTTP ${convertResponse.status}）`);
  }
  const convertData = asRecord(await convertResponse.json());
  const amapLocation = apiText(convertData?.locations)?.split(";")[0];
  if (convertData?.status !== "1" || !amapLocation) {
    throw new Error(`高德坐标转换失败：${apiText(convertData?.info) ?? "未知错误"}`);
  }

  const regeoUrl = new URL("https://restapi.amap.com/v3/geocode/regeo");
  regeoUrl.searchParams.set("key", key);
  regeoUrl.searchParams.set("location", amapLocation);
  regeoUrl.searchParams.set("extensions", "all");
  regeoUrl.searchParams.set("radius", "1000");
  regeoUrl.searchParams.set("roadlevel", "0");
  regeoUrl.searchParams.set("homeorcorp", "1");
  regeoUrl.searchParams.set("output", "JSON");

  const regeoResponse = await fetch(regeoUrl);
  if (!regeoResponse.ok) {
    throw new Error(`高德逆地理编码失败（HTTP ${regeoResponse.status}）`);
  }
  const regeoData = asRecord(await regeoResponse.json());
  if (regeoData?.status !== "1") {
    throw new Error(`高德逆地理编码失败：${apiText(regeoData?.info) ?? "未知错误"}`);
  }

  const regeocode = asRecord(regeoData.regeocode);
  if (!regeocode) return undefined;
  const component = asRecord(regeocode.addressComponent);
  const neighborhood = asRecord(component?.neighborhood);

  const roads = (Array.isArray(regeocode.roads) ? regeocode.roads : [])
    .map(asRecord)
    .filter((item): item is Record<string, unknown> => Boolean(item))
    .map((item) => ({
      name: apiText(item.name),
      distanceMeters: apiDistance(item.distance),
      direction: apiText(item.direction),
    }))
    .filter((item) => Boolean(item.name))
    .sort((a, b) => (a.distanceMeters ?? Number.POSITIVE_INFINITY) - (b.distanceMeters ?? Number.POSITIVE_INFINITY)) as Array<{
      name: string;
      distanceMeters?: number;
      direction?: string;
    }>;

  const pois = (Array.isArray(regeocode.pois) ? regeocode.pois : [])
    .map(asRecord)
    .filter((item): item is Record<string, unknown> => Boolean(item))
    .map((item) => ({
      name: apiText(item.name),
      distanceMeters: apiDistance(item.distance),
      direction: apiText(item.direction),
      address: apiText(item.address),
    }))
    .filter((item) => Boolean(item.name))
    .sort((a, b) => (a.distanceMeters ?? Number.POSITIVE_INFINITY) - (b.distanceMeters ?? Number.POSITIVE_INFINITY))
    .slice(0, 3) as Array<{
      name: string;
      distanceMeters?: number;
      direction?: string;
      address?: string;
    }>;

  const aois = (Array.isArray(regeocode.aois) ? regeocode.aois : [])
    .map(asRecord)
    .filter((item): item is Record<string, unknown> => Boolean(item))
    .map((item) => ({
      name: apiText(item.name),
      distanceMeters: apiDistance(item.distance),
      direction: apiText(item.direction),
      address: undefined,
    }))
    .filter((item) => Boolean(item.name))
    .sort((a, b) => (a.distanceMeters ?? Number.POSITIVE_INFINITY) - (b.distanceMeters ?? Number.POSITIVE_INFINITY)) as Array<{
      name: string;
      distanceMeters?: number;
      direction?: string;
      address?: string;
    }>;

  const landmarks = [...pois];
  for (const aoi of aois) {
    if (landmarks.length >= 3) break;
    if (!landmarks.some((item) => item.name === aoi.name)) landmarks.push(aoi);
  }

  return {
    source: "amap",
    formattedAddress: apiText(regeocode.formatted_address),
    township: apiText(component?.township),
    neighborhood: apiText(neighborhood?.name),
    nearestRoad: roads[0],
    nearbyLandmarks: landmarks,
    resolvedAt: new Date().toISOString(),
  };
}

/** Accepts true/false, 1/0 and the strings Shortcuts tends to produce */
function cleanBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 0 ? false : value === 1 ? true : undefined;
  if (typeof value === "string") {
    const text = value.trim().toLowerCase();
    if (["true", "yes", "1", "是", "充电中", "正在充电", "charging"].includes(text)) return true;
    if (["false", "no", "0", "否", "未充电", "没有充电", "not charging"].includes(text)) return false;
  }
  return undefined;
}

function cleanAppAction(value: unknown): AppAction | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim().toLowerCase();
  if (["open", "opened", "打开", "开启", "已打开"].includes(text)) return "open";
  if (["close", "closed", "关闭", "已关闭"].includes(text)) return "close";
  return undefined;
}

/**
 * Common alternate key names (Shortcuts dictionaries are hand-typed, so
 * casing/underscores/Chinese labels all show up in practice). Keys are
 * folded: lowercased with spaces/underscores/hyphens removed.
 */
const KEY_ALIASES: Record<string, keyof DeviceReport> = {
  reportedat: "reportedAt", time: "reportedAt", timestamp: "reportedAt",
  date: "reportedAt", 时间: "reportedAt", 上报时间: "reportedAt", 当前日期: "reportedAt",
  batterylevel: "batteryLevel", battery: "batteryLevel", batterypercent: "batteryLevel",
  batterypercentage: "batteryLevel", 电量: "batteryLevel", 电池电量: "batteryLevel",
  charging: "charging", ischarging: "charging", chargingstate: "charging",
  chargingstatus: "charging", 充电: "charging", 充电状态: "charging", 是否充电: "charging",
  devicename: "deviceName", device: "deviceName", 设备: "deviceName",
  设备名: "deviceName", 设备名称: "deviceName",
  devicemodel: "deviceModel", model: "deviceModel", 型号: "deviceModel", 设备型号: "deviceModel",
  systemname: "systemName", system: "systemName", os: "systemName", 系统: "systemName", 系统名称: "systemName",
  systemversion: "systemVersion", osversion: "systemVersion", version: "systemVersion", 系统版本: "systemVersion",
  networktype: "networkType", network: "networkType", 网络: "networkType", 网络类型: "networkType",
  focusmode: "focusMode", focus: "focusMode", 专注: "focusMode", 专注模式: "focusMode",
  locationname: "locationName", location: "locationName", address: "locationName",
  位置: "locationName", 地址: "locationName", 当前位置: "locationName",
  latitude: "latitude", lat: "latitude", 纬度: "latitude",
  longitude: "longitude", lng: "longitude", lon: "longitude", 经度: "longitude",
  locationaccuracymeters: "locationAccuracyMeters", locationaccuracy: "locationAccuracyMeters",
  accuracy: "locationAccuracyMeters", 定位精度: "locationAccuracyMeters", 精度: "locationAccuracyMeters",
  weathercondition: "weatherCondition", condition: "weatherCondition",
  weather: "weatherCondition", 天气: "weatherCondition", 天气状况: "weatherCondition",
  temperaturec: "temperatureC", temperature: "temperatureC", temp: "temperatureC",
  气温: "temperatureC", 温度: "temperatureC", 当前温度: "temperatureC",
  feelslikec: "feelsLikeC", feelslike: "feelsLikeC", apparenttemperature: "feelsLikeC",
  体感温度: "feelsLikeC", 体感: "feelsLikeC",
  precipitationchance: "precipitationChance", precipitationprobability: "precipitationChance",
  rainchance: "precipitationChance", 降水概率: "precipitationChance", 下雨概率: "precipitationChance",
  appname: "appName", app: "appName", 应用: "appName", 应用名称: "appName", app名称: "appName",
  appaction: "appAction", action: "appAction", appevent: "appAction", 动作: "appAction", 事件: "appAction",
};

/**
 * Salvage a common Shortcuts mistake: the whole JSON payload pasted into a
 * dictionary KEY (arriving as {"{\"batteryLevel\":62,...}": {}}). If a key
 * parses as a JSON object and its value is empty, merge the parsed object in.
 */
function unwrapMisnestedJson(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    const trimmed = key.trim();
    const valueIsEmpty = value === "" || value === null || value === undefined ||
      (typeof value === "object" && value !== null && Object.keys(value).length === 0);
    if (trimmed.startsWith("{") && valueIsEmpty) {
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          Object.assign(out, parsed);
          continue;
        }
      } catch {
        // not valid JSON — keep as a normal key below
      }
    }
    out[key] = value;
  }
  return out;
}

function canonicalizeKeys(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    const folded = key.trim().toLowerCase().replace(/[\s_-]/g, "");
    const canonical = KEY_ALIASES[folded] ?? key;
    if (!(canonical in out)) out[canonical] = value;
  }
  return out;
}

const SENSITIVE_KEY = /auth|token|secret|password|credential|密钥|令牌/i;

/** Temporary debug payload so we can see what the Shortcut actually sends */
function buildDebugInfo(raw: Record<string, unknown>, report: StoredDeviceReport) {
  const receivedValues: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (SENSITIVE_KEY.test(key)) {
      receivedValues[key] = "[redacted]";
      continue;
    }
    const text = value === null ? "null"
      : typeof value === "object" ? JSON.stringify(value)
      : String(value);
    receivedValues[key] = `${typeof value}: ${text.slice(0, 80)}`;
  }
  return {
    receivedKeys: Object.keys(raw),
    receivedValues,
    normalizedKeys: Object.entries(report)
      .filter(([key, value]) => value !== undefined && key !== "receivedAt")
      .map(([key]) => key),
  };
}

function cleanTimestamp(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
}

function normalizeReport(input: unknown, receivedAt: string): StoredDeviceReport {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("请求体必须是 JSON 对象");
  }

  const raw = canonicalizeKeys(unwrapMisnestedJson(input as Record<string, unknown>));
  const battery = cleanNumber(raw.batteryLevel);

  return {
    receivedAt,
    reportedAt: cleanTimestamp(raw.reportedAt, receivedAt),
    batteryLevel: battery === undefined
      ? undefined
      : Math.min(100, Math.max(0, Math.round(battery))),
    charging: cleanBoolean(raw.charging),
    deviceName: cleanText(raw.deviceName),
    deviceModel: cleanText(raw.deviceModel),
    systemName: cleanText(raw.systemName),
    systemVersion: cleanText(raw.systemVersion),
    networkType: cleanText(raw.networkType),
    focusMode: cleanText(raw.focusMode),
    locationName: cleanText(raw.locationName, 240),
    latitude: (() => {
      const value = cleanNumber(raw.latitude);
      return value === undefined ? undefined : Math.min(90, Math.max(-90, value));
    })(),
    longitude: (() => {
      const value = cleanNumber(raw.longitude);
      return value === undefined ? undefined : Math.min(180, Math.max(-180, value));
    })(),
    locationAccuracyMeters: (() => {
      const value = cleanNumber(raw.locationAccuracyMeters);
      return value === undefined ? undefined : Math.max(0, Math.round(value));
    })(),
    weatherCondition: cleanText(raw.weatherCondition, 120),
    temperatureC: (() => {
      const value = cleanNumber(raw.temperatureC);
      return value === undefined ? undefined : Math.min(100, Math.max(-100, value));
    })(),
    feelsLikeC: (() => {
      const value = cleanNumber(raw.feelsLikeC);
      return value === undefined ? undefined : Math.min(100, Math.max(-100, value));
    })(),
    precipitationChance: (() => {
      const value = cleanNumber(raw.precipitationChance);
      return value === undefined ? undefined : Math.min(100, Math.max(0, value));
    })(),
    appName: cleanText(raw.appName, 60),
    appAction: cleanAppAction(raw.appAction),
  };
}

export class DeviceStateStore {
  constructor(private state: DurableObjectState, private env: Env) {
    void this.env;
  }

  async fetch(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);

    if (request.method === "POST" && pathname === "/report") {
      return this.saveReport(request);
    }

    if (request.method === "GET" && pathname === "/snapshot") {
      const snapshot = await this.snapshot();
      return Response.json(snapshot);
    }

    return new Response("Not Found", { status: 404 });
  }

  private async saveReport(request: Request): Promise<Response> {
    const receivedAt = new Date().toISOString();
    let raw: Record<string, unknown> = {};
    let report: StoredDeviceReport;

    try {
      const parsed = await request.json();
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        raw = parsed as Record<string, unknown>;
      }
      report = normalizeReport(parsed, receivedAt);
    } catch (error) {
      return Response.json(
        { ok: false, error: error instanceof Error ? error.message : String(error) },
        { status: 400 }
      );
    }

    const current = await this.snapshot();

    if (report.latitude !== undefined && report.longitude !== undefined) {
      // Never let a newly reported coordinate inherit a reverse-geocoded label
      // from an older coordinate. Failure falls back to Apple's address text.
      report.resolvedLocation = null;
      try {
        report.resolvedLocation = await reverseGeocodeWithAmap(
          this.env,
          report.latitude,
          report.longitude
        ) ?? null;
      } catch (error) {
        console.warn("[AMAP] reverse geocoding failed:", error);
      }
    }

    // App-only automations arrive frequently. They must not make older battery,
    // location or weather values look fresh, so keep a separate status timestamp.
    const statusFields: Array<keyof DeviceReport> = [
      "batteryLevel", "charging", "deviceName", "deviceModel", "systemName",
      "systemVersion", "networkType", "focusMode", "locationName", "latitude",
      "longitude", "locationAccuracyMeters", "weatherCondition", "temperatureC",
      "feelsLikeC", "precipitationChance",
    ];
    if (statusFields.some((key) => report[key] !== undefined)) {
      report.statusReportedAt = report.reportedAt ?? receivedAt;
    }

    // Spreading `report` directly would clobber previously stored fields with
    // undefined (app open/close events only carry appName/appAction), so only
    // fields actually present in this report may overwrite the saved state.
    const definedReport = Object.fromEntries(
      Object.entries(report).filter(([, value]) => value !== undefined)
    ) as StoredDeviceReport;
    const latest: StoredDeviceReport = { ...(current.latest ?? {}), ...definedReport };

    if (report.appName && report.appAction) {
      const occurredAt = report.reportedAt ?? receivedAt;
      const event: AppEvent = {
        appName: report.appName,
        action: report.appAction,
        occurredAt,
        receivedAt,
      };
      current.recentEvents.unshift(event);
      current.recentEvents = current.recentEvents.slice(0, MAX_EVENTS);

      if (report.appAction === "open") {
        current.activeApps[report.appName] = occurredAt;
      } else {
        const openedAt = current.activeApps[report.appName];
        if (openedAt) {
          const durationSeconds = Math.max(
            0,
            Math.round((new Date(occurredAt).getTime() - new Date(openedAt).getTime()) / 1000)
          );
          current.recentSessions.unshift({
            appName: report.appName,
            openedAt,
            closedAt: occurredAt,
            durationSeconds,
          });
          current.recentSessions = current.recentSessions.slice(0, MAX_SESSIONS);
          delete current.activeApps[report.appName];
        }
      }
    }

    await this.state.storage.put({
      latest,
      activeApps: current.activeApps,
      recentEvents: current.recentEvents,
      recentSessions: current.recentSessions,
    });

    // debug is temporary — remove once the Shortcut's field names are settled
    return Response.json({ ok: true, receivedAt, debug: buildDebugInfo(raw, report) });
  }

  private async snapshot(): Promise<DeviceSnapshot> {
    const [latest, activeApps, recentEvents, recentSessions] = await Promise.all([
      this.state.storage.get<StoredDeviceReport>("latest"),
      this.state.storage.get<Record<string, string>>("activeApps"),
      this.state.storage.get<AppEvent[]>("recentEvents"),
      this.state.storage.get<AppSession[]>("recentSessions"),
    ]);

    return {
      latest: latest ?? null,
      activeApps: activeApps ?? {},
      recentEvents: recentEvents ?? [],
      recentSessions: recentSessions ?? [],
    };
  }
}
