import { AcMcpAgent } from "./ac-agent";
import { registerAppleHealthTools } from "./apple-health-extension";

// Keep the existing MCP agent and all of its tools unchanged. We only extend
// init() once so Apple Health appears in the same mcp.xiaoman.xyz connection.
const originalInit = AcMcpAgent.prototype.init;
AcMcpAgent.prototype.init = async function patchedInit(this: AcMcpAgent) {
  await originalInit.call(this);
  const agent = this as unknown as {
    server: Parameters<typeof registerAppleHealthTools>[0];
    env: Parameters<typeof registerAppleHealthTools>[1];
  };
  registerAppleHealthTools(agent.server, agent.env);
};

export * from "./index";
export { default } from "./index";
