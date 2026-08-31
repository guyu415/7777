import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

interface HealthProxyEnv {
  DEVICE_WRITE_TOKEN?: string;
  HEALTH_API_TOKEN?: string;
  HEALTH_API_BASE_URL?: string;
}

interface HealthProxyResponse {
  ok?: boolean;
  result?: unknown;
  error?: string;
}

const DEFAULT_HEALTH_API_BASE_URL = "https://health.xiaoman.xyz";

function healthBaseUrl(env: HealthProxyEnv): string {
  return (env.HEALTH_API_BASE_URL || DEFAULT_HEALTH_API_BASE_URL).replace(/\/+$/, "");
}

function healthToken(env: HealthProxyEnv): string {
  // Reuse the existing device write secret by default so there is no second
  // Cloudflare secret to configure. The VPS MCP_TOKEN should use the same value.
  return env.HEALTH_API_TOKEN || env.DEVICE_WRITE_TOKEN || "";
}

async function callHealthTool(
  env: HealthProxyEnv,
  name: string,
  args: Record<string, unknown> = {}
): Promise<unknown> {
  const token = healthToken(env);
  if (!token) {
    throw new Error("Apple Health 代理未配置鉴权 token");
  }

  const response = await fetch(`${healthBaseUrl(env)}/api/tools/call`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ name, arguments: args }),
  });

  let payload: HealthProxyResponse = {};
  try {
    payload = await response.json<HealthProxyResponse>();
  } catch {
    // Keep an empty typed payload so HTTP status still drives a useful error.
  }
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || `Apple Health 服务请求失败（HTTP ${response.status}）`);
  }
  return payload.result;
}

function toolResult(value: unknown) {
  return {
    content: [{
      type: "text" as const,
      text: JSON.stringify(value, null, 2),
    }],
  };
}

function toolError(error: unknown) {
  return {
    content: [{
      type: "text" as const,
      text: `暂时无法读取 Apple Health：${error instanceof Error ? error.message : String(error)}`,
    }],
    isError: true,
  };
}

export function registerAppleHealthTools(server: McpServer, env: HealthProxyEnv): void {
  server.tool(
    "health_current_context",
    "一次读取最适合 AI 使用的 Apple Health / Apple Watch 当前上下文：最近生命体征、24 小时活动、48 小时睡眠、最近运动和同步新鲜度。健康数据仅用于了解状态，不替代医疗诊断。",
    {
      detail: z.enum(["compact", "full"]).default("compact")
        .describe("compact 适合日常对话；full 会额外带最近原始样本"),
    },
    async ({ detail }) => {
      try {
        return toolResult(await callHealthTool(env, "health_current_context", { detail }));
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.tool(
    "health_latest",
    "读取 Apple Health / Apple Watch 最新样本。types 省略时返回当前已经同步到服务端的各类最新数据；适合询问当前/最近心率、血氧、呼吸率、体温、步数等。",
    {
      types: z.array(z.string()).optional()
        .describe("可选 HealthKit type identifier 列表"),
      mode: z.enum(["per_type", "timeline"]).default("per_type")
        .describe("per_type 每类最新一条；timeline 按时间返回最近样本"),
      limit: z.number().int().min(1).max(500).default(100),
    },
    async ({ types, mode, limit }) => {
      try {
        return toolResult(await callHealthTool(env, "health_latest", { types, mode, limit }));
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.tool(
    "health_query",
    "按 HealthKit 类型、数据 kind 和时间范围查询原始健康历史。需要精确时间、来源设备、ECG/运动等底层记录时使用。",
    {
      type: z.string().optional().describe("HealthKit type identifier，例如 HKQuantityTypeIdentifierHeartRate"),
      kind: z.string().optional().describe("通用数据 kind，例如 quantity/category/workout/ecg/route/heartbeat/audiogram/activity_summary"),
      start: z.string().optional().describe("ISO 8601 起始时间"),
      end: z.string().optional().describe("ISO 8601 结束时间"),
      limit: z.number().int().min(1).max(5000).default(500),
      ascending: z.boolean().default(false),
    },
    async ({ type, kind, start, end, limit, ascending }) => {
      try {
        return toolResult(await callHealthTool(env, "health_query", {
          type, kind, start, end, limit, ascending,
        }));
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.tool(
    "health_summary",
    "汇总一段时间内的数值型 Apple Health 数据，返回每种类型的数量、最小值、最大值、平均值和最近时间。",
    {
      types: z.array(z.string()).optional(),
      hours: z.number().positive().max(24 * 366).default(24),
    },
    async ({ types, hours }) => {
      try {
        return toolResult(await callHealthTool(env, "health_summary", { types, hours }));
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.tool(
    "health_workouts",
    "读取最近 Apple Watch / HealthKit 运动记录；如果手机桥接已上传，会包含运动统计和路线数据。",
    {
      hours: z.number().positive().max(24 * 366).default(168),
      limit: z.number().int().min(1).max(500).default(100),
    },
    async ({ hours, limit }) => {
      try {
        return toolResult(await callHealthTool(env, "health_workouts", { hours, limit }));
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.tool(
    "health_ecg",
    "读取 Apple Watch ECG 记录。手机桥接成功导出时，payload 中会带 ECG 元数据和 Lead I 波形点。",
    {
      limit: z.number().int().min(1).max(50).default(10),
    },
    async ({ limit }) => {
      try {
        return toolResult(await callHealthTool(env, "health_ecg", { limit }));
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.tool(
    "health_capabilities",
    "查看目前实际同步进来的 HealthKit 数据类型、单位、数量、首末时间，并返回同步状态。用来回答“你现在能看到我哪些手表/健康数据”。",
    {},
    async () => {
      try {
        return toolResult(await callHealthTool(env, "health_capabilities"));
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.tool(
    "health_sync_status",
    "检查 iPhone / Apple Watch 健康桥最近一次向服务器同步的时间和累计接收样本数。",
    {},
    async () => {
      try {
        return toolResult(await callHealthTool(env, "health_sync_status"));
      } catch (error) {
        return toolError(error);
      }
    }
  );
}
