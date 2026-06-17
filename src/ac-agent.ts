import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env, Props } from "./index";

type AcMode = "cool" | "heat" | "fan" | "auto" | "dry";
type FanSpeed = "low" | "medium" | "high" | "auto";

interface AcState {
  power: boolean;
  temperature: number;
  mode: AcMode;
  fanSpeed: FanSpeed;
  roomTemperature: number;
}

const MODE_NAMES: Record<AcMode, string> = {
  cool: "制冷",
  heat: "制热",
  fan:  "送风",
  auto: "自动",
  dry:  "除湿",
};

const SPEED_NAMES: Record<FanSpeed, string> = {
  low:    "低速",
  medium: "中速",
  high:   "高速",
  auto:   "自动",
};

export class AcMcpAgent extends McpAgent<Env, AcState, Props> {
  server = new McpServer({ name: "ac-controller", version: "1.0.0" });

  initialState: AcState = {
    power:           false,
    temperature:     24,
    mode:            "cool",
    fanSpeed:        "auto",
    roomTemperature: 28,
  };

  async init() {
    // ── get_ac_status ───────────────────────────────────────────────
    this.server.tool(
      "get_ac_status",
      "获取空调当前状态，包括开关状态、设定温度、室内温度、运行模式和风速",
      {},
      async () => {
        const s = this.state;
        return {
          content: [{
            type: "text" as const,
            text: [
              "空调状态报告",
              `  电源：${s.power ? "🟢 开启" : "🔴 关闭"}`,
              `  设定温度：${s.temperature}°C`,
              `  当前室温：${s.roomTemperature}°C`,
              `  运行模式：${MODE_NAMES[s.mode]}`,
              `  风速档位：${SPEED_NAMES[s.fanSpeed]}`,
            ].join("\n"),
          }],
        };
      }
    );

    // ── turn_on_ac ──────────────────────────────────────────────────
    this.server.tool(
      "turn_on_ac",
      "开启空调",
      {},
      async () => {
        if (this.state.power) {
          return { content: [{ type: "text" as const, text: "空调已处于开启状态" }] };
        }
        this.setState({ ...this.state, power: true });
        return {
          content: [{
            type: "text" as const,
            text: `✅ 空调已开启，当前设定温度 ${this.state.temperature}°C`,
          }],
        };
      }
    );

    // ── turn_off_ac ─────────────────────────────────────────────────
    this.server.tool(
      "turn_off_ac",
      "关闭空调",
      {},
      async () => {
        if (!this.state.power) {
          return { content: [{ type: "text" as const, text: "空调已处于关闭状态" }] };
        }
        this.setState({ ...this.state, power: false });
        return { content: [{ type: "text" as const, text: "✅ 空调已关闭" }] };
      }
    );

    // ── set_temperature ─────────────────────────────────────────────
    this.server.tool(
      "set_temperature",
      "设置空调目标温度，可设范围 16–30°C",
      {
        temperature: z
          .number()
          .min(16)
          .max(30)
          .describe("目标温度（摄氏度，16–30 之间的整数或小数）"),
      },
      async ({ temperature }) => {
        if (!this.state.power) {
          return {
            content: [{
              type: "text" as const,
              text: "⚠️ 空调未开启，请先开启空调再调节温度",
            }],
          };
        }
        const prev = this.state.temperature;
        this.setState({ ...this.state, temperature });
        return {
          content: [{
            type: "text" as const,
            text: `✅ 温度从 ${prev}°C 调节为 ${temperature}°C`,
          }],
        };
      }
    );

    // ── set_mode ────────────────────────────────────────────────────
    this.server.tool(
      "set_mode",
      "设置空调运行模式（制冷 / 制热 / 送风 / 自动 / 除湿）",
      {
        mode: z
          .enum(["cool", "heat", "fan", "auto", "dry"])
          .describe("运行模式：cool=制冷，heat=制热，fan=送风，auto=自动，dry=除湿"),
      },
      async ({ mode }) => {
        const prev = this.state.mode;
        this.setState({ ...this.state, mode });
        return {
          content: [{
            type: "text" as const,
            text: `✅ 运行模式从「${MODE_NAMES[prev]}」切换为「${MODE_NAMES[mode]}」`,
          }],
        };
      }
    );

    // ── set_fan_speed ───────────────────────────────────────────────
    this.server.tool(
      "set_fan_speed",
      "设置空调风速（低速 / 中速 / 高速 / 自动）",
      {
        speed: z
          .enum(["low", "medium", "high", "auto"])
          .describe("风速档位：low=低速，medium=中速，high=高速，auto=自动"),
      },
      async ({ speed }) => {
        const prev = this.state.fanSpeed;
        this.setState({ ...this.state, fanSpeed: speed });
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
