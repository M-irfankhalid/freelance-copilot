/**
 * Stdio MCP entry point. stdout is reserved for JSON-RPC, so this is set
 * before any app module loads; env.ts and the logger read it at import time.
 */
process.env.LOG_STDOUT = "false";

async function main(): Promise<void> {
  const [
    { StdioServerTransport },
    { createMcpServer },
    { env },
    { getOwnerUserId },
    { closeDb },
  ] = await Promise.all([
    import("@modelcontextprotocol/sdk/server/stdio.js"),
    import("./server.js"),
    import("../env.js"),
    import("../modules/auth/auth.service.js"),
    import("../db/index.js"),
  ]);

  const userId = getOwnerUserId();
  if (userId === null) {
    throw new Error(
      "No owner account exists. Start the app and register before using the MCP server."
    );
  }

  const server = createMcpServer({
    userId,
    allowWrites: env.MCP_ALLOW_WRITES,
  });
  const transport = new StdioServerTransport();
  await server.connect(transport);

  process.stderr.write(
    `[mcp] Freelance Copilot connected (writes ${env.MCP_ALLOW_WRITES ? "enabled" : "read-only"})\n`
  );

  let closing = false;
  const shutdown = async (): Promise<void> => {
    if (closing) return;
    closing = true;
    try {
      await server.close();
    } finally {
      closeDb();
      process.exit(0);
    }
  };

  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  process.stderr.write(`[mcp] Failed to start: ${message}\n`);
  process.exit(1);
});
