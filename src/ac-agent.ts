import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getTuyaToken, sendAcCommand, getAcStatus } from "./tuya";
import type { Env, Props } from "./index";
import type { DeviceSnapshot } from "./device-state";

type AcMode   = "cool" | "heat" | "fan" | "auto" | "dry";
type FanSpeed  = "low"  | "medium" | "high" | "auto";

interface AcState {
  power:           boolean;
  temperature:     number;
  mode:            AcMode;
  fanSpeed:        FanSpeed;
  roomTemperature: number;
}

// ─── Tuya IR AC value mappings ────────────────────────────────────────────────
// Standard Tuya IR AC scene: 0=Auto, 1=Cool, 2=Heat, 3=Fan, 4=Dry
// Adjust if the physical device uses a different ordering.

const MODE_TO_TUYA: Record<AcMode, number>  = { auto: 0, cool: 1, heat: 2, fan: 3, dry: 4 };
const TUYA_TO_MODE: Record<number, AcMode>  = { 0: "auto", 1: "cool", 2: "heat", 3: "fan", 4: "dry" };
const WIND_TO_TUYA: Record<FanSpeed, number> = { auto: 0, low: 1, medium: 2, high: 3 };
const TUYA_TO_WIND: Record<number, FanSpeed> = { 0: "auto", 1: "low", 2: "medium", 3: "high" };

const MODE_NAMES:  Record<AcMode,   string> = { cool: "制冷", heat: "制热", fan: "送风", auto: "自动", dry: "除湿" };
const SPEED_NAMES: Record<FanSpeed, string> = { low: "低速", medium: "中速", high: "高速", auto: "自动" };

function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours} 小时 ${minutes} 分钟`;
  if (minutes > 0) return `${minutes} 分钟`;
  return `${seconds} 秒`;
}

function formatTime(value: string | undefined): string {
  if (!value) return "未知";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour12: false,
  });
}

export class AcMcpAgent extends McpAgent<Env, AcState, Props> {
  server = new McpServer({ name: "ac-controller", version: "1.0.0" });

  initialState: AcState = {
    power:           false,
    temperature:     24,
    mode:            "cool",
    fanSpeed:        "auto",
    roomTemperature: 28,
  };

  // In-memory Tuya token cache (resets when the Durable Object hibernates)
  private _tuyaToken        = "";
  private _tuyaTokenExpiry  = 0;

  private async token(): Promise<string> {
    if (this._tuyaToken && Date.now() < this._tuyaTokenExpiry) return this._tuyaToken;
    const { access_token, expire_time } = await getTuyaToken(this.env);
    this._tuyaToken       = access_token;
    this._tuyaTokenExpiry = Date.now() + (expire_time - 60) * 1000; // refresh 60 s early
    return this._tuyaToken;
  }

  /** Send a command to the physical AC and update local state on success. */
  private async command(overrides: Partial<AcState>): Promise<void> {
    const s    = { ...this.state, ...overrides };
    const tok  = await this.token();
    await sendAcCommand(this.env, tok, {
      power: s.power ? 1 : 0,
      mode:  MODE_TO_TUYA[s.mode],
      temp:  s.temperature,
      wind:  WIND_TO_TUYA[s.fanSpeed],
    });
    this.setState(s);
  }

  private async deviceSnapshot(): Promise<DeviceSnapshot> {
    const id = this.env.DeviceStateStore.idFromName("primary-phone");
    const stub = this.env.DeviceStateStore.get(id);
    const response = await stub.fetch("https://device-state.internal/snapshot");
    if (!response.ok) {
      throw new Error(`读取手机状态失败（HTTP ${response.status}）`);
    }
    return response.json<DeviceSnapshot>();
  }

  async init() {
    // ── get_device_status ──────────────────────────────────────────────────
    this.server.tool(
      "get_device_status",
      "查看手机最近主动上报的电量、设备信息、当前 App 动态和近 24 小时使用概况（只读）",
      {},
      async () => {
        const snapshot = await this.deviceSnapshot();
        const latest = snapshot.latest;
        if (!latest) {
          return {
            content: [{
              type: "text" as const,
              text: "还没有收到手机上报。请先运行 iPhone 上的「查岗上报」快捷指令。",
            }],
          };
        }

        const lines = [
          "手机最近状态：",
          `  上报时间：${formatTime(latest.reportedAt ?? latest.receivedAt)}（北京时间）`,
        ];

        const device = [latest.deviceName, latest.deviceModel].filter(Boolean).join(" · ");
        const system = [latest.systemName, latest.systemVersion].filter(Boolean).join(" ");
        if (device) lines.push(`  设备：${device}`);
        if (system) lines.push(`  系统：${system}`);
        if (latest.batteryLevel !== undefined) {
          lines.push(`  电量：${latest.batteryLevel}%${latest.charging === true ? "（充电中）" : latest.charging === false ? "（未充电）" : ""}`);
        }
        if (latest.networkType) lines.push(`  网络：${latest.networkType}`);
        if (latest.focusMode) lines.push(`  专注模式：${latest.focusMode}`);

        const activeApps = Object.entries(snapshot.activeApps);
        if (activeApps.length) {
          lines.push("", "当前记录为打开状态的 App：");
          for (const [appName, openedAt] of activeApps) {
            lines.push(`  • ${appName}（${formatTime(openedAt)} 打开）`);
          }
        }

        const since = Date.now() - 24 * 60 * 60 * 1000;
        const totals = new Map<string, number>();
        for (const session of snapshot.recentSessions) {
          if (new Date(session.closedAt).getTime() < since) continue;
          totals.set(session.appName, (totals.get(session.appName) ?? 0) + session.durationSeconds);
        }
        const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]);
        if (ranked.length) {
          lines.push("", "近 24 小时已记录的 App 使用时长：");
          for (const [appName, seconds] of ranked.slice(0, 10)) {
            lines.push(`  • ${appName}：${formatDuration(seconds)}`);
          }
        } else {
          lines.push("", "近 24 小时尚无完整的 App 打开/关闭记录。");
        }

        return { content: [{ type: "text" as const, text: lines.join("\n") }] };
      }
    );

    // ── get_ac_status ──────────────────────────────────────────────────────
    this.server.tool(
      "get_ac_status",
      "从涂鸦 API 查询空调当前状态（电源、温度、模式、风速）",
      {},
      async () => {
        const tok = await this.token();
        let status: Awaited<ReturnType<typeof getAcStatus>>;
        try {
          status = await getAcStatus(this.env, tok);
        } catch (err) {
          // IR is one-directional; fall back to last known local state
          const s = this.state;
          return {
            content: [{
              type: "text" as const,
              text: [
                "⚠️ 无法查询涂鸦 API，显示本地缓存状态：",
                `  电源：${s.power ? "🟢 开启" : "🔴 关闭"}`,
                `  设定温度：${s.temperature}°C`,
                `  运行模式：${MODE_NAMES[s.mode]}`,
                `  风速：${SPEED_NAMES[s.fanSpeed]}`,
                `  错误：${String(err)}`,
              ].join("\n"),
            }],
          };
        }
        const mode  = TUYA_TO_MODE[status.mode]  ?? "auto";
        const speed = TUYA_TO_WIND[status.wind]  ?? "auto";
        this.setState({ ...this.state, power: status.power === 1, temperature: status.temp, mode, fanSpeed: speed });
        return {
          content: [{
            type: "text" as const,
            text: [
              "空调状态（来自涂鸦 API）：",
              `  电源：${status.power === 1 ? "🟢 开启" : "🔴 关闭"}`,
              `  设定温度：${status.temp}°C`,
              `  运行模式：${MODE_NAMES[mode]}`,
              `  风速：${SPEED_NAMES[speed]}`,
            ].join("\n"),
          }],
        };
      }
    );

    // ── turn_on_ac ─────────────────────────────────────────────────────────
    this.server.tool("turn_on_ac", "开启空调", {}, async () => {
      if (this.state.power) return { content: [{ type: "text" as const, text: "空调已处于开启状态" }] };
      await this.command({ power: true });
      return {
        content: [{
          type: "text" as const,
          text: `✅ 空调已开启，当前设定 ${this.state.temperature}°C，${MODE_NAMES[this.state.mode]}`,
        }],
      };
    });

    // ── turn_off_ac ────────────────────────────────────────────────────────
    this.server.tool("turn_off_ac", "关闭空调", {}, async () => {
      if (!this.state.power) return { content: [{ type: "text" as const, text: "空调已处于关闭状态" }] };
      await this.command({ power: false });
      return { content: [{ type: "text" as const, text: "✅ 空调已关闭" }] };
    });

    // ── set_temperature ────────────────────────────────────────────────────
    this.server.tool(
      "set_temperature",
      "设置空调目标温度（16–30°C）",
      { temperature: z.number().min(16).max(30).describe("目标温度（摄氏度）") },
      async ({ temperature }) => {
        const prev = this.state.temperature;
        await this.command({ temperature });
        return { content: [{ type: "text" as const, text: `✅ 温度从 ${prev}°C 调节为 ${temperature}°C` }] };
      }
    );

    // ── set_mode ───────────────────────────────────────────────────────────
    this.server.tool(
      "set_mode",
      "设置空调运行模式（制冷/制热/送风/自动/除湿）",
      { mode: z.enum(["cool", "heat", "fan", "auto", "dry"]).describe("运行模式") },
      async ({ mode }) => {
        const prev = this.state.mode;
        await this.command({ mode });
        return {
          content: [{
            type: "text" as const,
            text: `✅ 模式从「${MODE_NAMES[prev]}」切换为「${MODE_NAMES[mode]}」`,
          }],
        };
      }
    );

    // ── set_fan_speed ──────────────────────────────────────────────────────
    this.server.tool(
      "set_fan_speed",
      "设置空调风速（低速/中速/高速/自动）",
      { speed: z.enum(["low", "medium", "high", "auto"]).describe("风速档位") },
      async ({ speed }) => {
        const prev = this.state.fanSpeed;
        await this.command({ fanSpeed: speed });
        return {
          content: [{
            type: "text" as const,
            text: `✅ 风速从「${SPEED_NAMES[prev]}」调节为「${SPEED_NAMES[speed]}」`,
          }],
        };
      }
    );
  }
}
