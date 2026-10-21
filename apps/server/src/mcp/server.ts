import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";

import {
  executeAgentTool,
  getAgentTools,
  type AgentTool,
} from "../modules/agent/agent.tools.js";

export interface McpServerOptions {
  userId: string;
  allowWrites: boolean;
}

/**
 * Cross-tool guidance shown to MCP clients during initialization.
 * The first 512 characters must stand on their own.
 */
export const MCP_INSTRUCTIONS = `
Freelance Copilot exposes the owner's saved profile, jobs, proposals, bids, automation settings, and diagnostics. Always call get_profile before discussing user facts. Use only saved facts; never invent skills, portfolio projects, history, prices, or deadlines. Only draft proposals may change terms or text. Never set confirm=true for approve_proposal or place_bid unless the user explicitly asked for that action; a request to place a bid also authorizes approving that draft. Report the exact amount and delivery days before acting, and report exactly what changed afterwards.

Use run_scan to fetch and analyze new Freelancer.com work without bidding, list_matches for the strongest analyzed jobs, and analyze_job or refresh_job for one project. get_ai_settings reads the active models, engine, temperatures, token caps, timeouts, and score bands; update_ai_settings changes them; test_ai_settings verifies the saved OpenRouter connection. Keep the relevance ignore floor at or below the good-score floor and the strong-score floor above it. create_proposal_draft and regenerate_proposal_draft keep proposals in draft. update_proposal_terms changes bid amount or delivery days on drafts only. To bid: update terms if needed, approve with approve_proposal, then place_bid; place_bid checks saved bounds, the daily cap, and duplicate bids. get_dashboard, list_bids, get_bid, get_proposal_for_job, and get_recent_logs are read-only diagnostics. Writes hit the same local SQLite database used by the app.
`.trim();

function toMcpTool(tool: AgentTool): Tool {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.parameters as unknown as Tool["inputSchema"],
    annotations: {
      title: tool.name,
      readOnlyHint: !tool.write,
      destructiveHint: tool.write,
      idempotentHint: !tool.write,
      openWorldHint: false,
    },
  };
}

/**
 * Build the MCP server over the existing agent tool registry. Keeping a single
 * tool implementation means ChatGPT, the in-app agent, and tests enforce the
 * same validation and write-safety rules.
 */
export function createMcpServer(options: McpServerOptions): Server {
  const tools = getAgentTools(options.allowWrites);
  const toolNames = new Set(tools.map((tool) => tool.name));

  const server = new Server(
    { name: "freelance-copilot", version: "1.0.0" },
    {
      capabilities: { tools: {} },
      instructions: MCP_INSTRUCTIONS,
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map(toMcpTool),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    if (!toolNames.has(name)) {
      return {
        content: [{ type: "text", text: `Unknown or disabled tool: ${name}` }],
        isError: true,
      } satisfies CallToolResult;
    }

    const result = await executeAgentTool(
      name,
      request.params.arguments ?? {},
      { userId: options.userId, allowWrites: options.allowWrites }
    );

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result.data, null, 2),
        },
      ],
      isError: result.data.ok === false,
    } satisfies CallToolResult;
  });

  return server;
}
