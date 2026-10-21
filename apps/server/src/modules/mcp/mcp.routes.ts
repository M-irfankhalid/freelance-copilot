import { Router } from "express";
import { z } from "zod";

import { parseBody } from "../../lib/validate.js";
import { requireUser } from "../../middleware/require-user.js";
import {
  deleteMcpSettings,
  getMcpSettings,
  saveMcpSettings,
} from "./mcp-settings.service.js";
import {
  clearTunnelFailure,
  disconnectTunnel,
  getTunnelStatus,
  refreshTunnel,
  startTunnel,
} from "./tunnel-manager.js";

export const mcpRouter = Router();
mcpRouter.use(requireUser);

const settingsInput = z.object({
  tunnelId: z.string().min(1).max(200).optional(),
  apiKey: z.string().min(1).max(500).optional(),
  allowWrites: z.boolean().optional(),
});

async function stateFor(userId: string) {
  return {
    settings: getMcpSettings(userId),
    status: await getTunnelStatus(userId),
  };
}

/** GET /api/mcp — saved tunnel settings and live process status. */
mcpRouter.get("/", async (req, res, next) => {
  try {
    res.json(await stateFor(req.user!.id));
  } catch (error) {
    next(error);
  }
});

/** PUT /api/mcp — save settings and restart the tunnel if it was connected. */
mcpRouter.put("/", async (req, res, next) => {
  try {
    const input = parseBody(settingsInput, req.body);
    const wasEnabled = getMcpSettings(req.user!.id).enabled;
    saveMcpSettings(req.user!.id, input);
    clearTunnelFailure(req.user!.id);
    if (wasEnabled) {
      await refreshTunnel(req.user!.id);
    }
    res.json(await stateFor(req.user!.id));
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/mcp/connect — save optional settings, install the official tunnel
 * client when needed, and start it. The API key is encrypted before storage.
 */
mcpRouter.post("/connect", async (req, res, next) => {
  try {
    const input = parseBody(settingsInput, req.body);
    if (Object.keys(input).length > 0) {
      saveMcpSettings(req.user!.id, input);
    }
    clearTunnelFailure(req.user!.id);
    await startTunnel(req.user!.id);
    res.json(await stateFor(req.user!.id));
  } catch (error) {
    next(error);
  }
});

/** POST /api/mcp/disconnect — stop the process and disable auto-resume. */
mcpRouter.post("/disconnect", async (req, res, next) => {
  try {
    await disconnectTunnel(req.user!.id);
    res.json(await stateFor(req.user!.id));
  } catch (error) {
    next(error);
  }
});

/** DELETE /api/mcp — stop the process and forget the tunnel configuration. */
mcpRouter.delete("/", async (req, res, next) => {
  try {
    await disconnectTunnel(req.user!.id);
    deleteMcpSettings(req.user!.id);
    res.json(await stateFor(req.user!.id));
  } catch (error) {
    next(error);
  }
});
