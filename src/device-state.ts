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
  appName?: string;
  appAction?: AppAction;
}

export interface StoredDeviceReport extends DeviceReport {
  receivedAt: string;
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
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text ? text.slice(0, maxLength) : undefined;
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

  const raw = input as Record<string, unknown>;
  const battery = typeof raw.batteryLevel === "number" ? raw.batteryLevel : undefined;
  const appAction = raw.appAction === "open" || raw.appAction === "close"
    ? raw.appAction
    : undefined;

  return {
    receivedAt,
    reportedAt: cleanTimestamp(raw.reportedAt, receivedAt),
    batteryLevel: battery === undefined
      ? undefined
      : Math.min(100, Math.max(0, Math.round(battery))),
    charging: typeof raw.charging === "boolean" ? raw.charging : undefined,
    deviceName: cleanText(raw.deviceName),
    deviceModel: cleanText(raw.deviceModel),
    systemName: cleanText(raw.systemName),
    systemVersion: cleanText(raw.systemVersion),
    networkType: cleanText(raw.networkType),
    focusMode: cleanText(raw.focusMode),
    appName: cleanText(raw.appName),
    appAction,
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
    let report: StoredDeviceReport;

    try {
      report = normalizeReport(await request.json(), receivedAt);
    } catch (error) {
      return Response.json(
        { ok: false, error: error instanceof Error ? error.message : String(error) },
        { status: 400 }
      );
    }

    const current = await this.snapshot();
    const latest = { ...(current.latest ?? {}), ...report };

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

    return Response.json({ ok: true, receivedAt });
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
