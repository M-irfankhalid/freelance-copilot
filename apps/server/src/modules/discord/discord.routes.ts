import { Router } from "express";
import { z } from "zod";

import { parseBody } from "../../lib/validate.js";
import { requireUser } from "../../middleware/require-user.js";
import {
  DISCORD_EVENTS,
  deleteDiscordWebhook,
  getDiscordSettings,
  saveDiscordSettings,
  sendTestMessage,
} from "./discord.service.js";

export const discordRouter = Router();
discordRouter.use(requireUser);

/** GET /api/discord — current configuration (never the plaintext webhook). */
discordRouter.get("/", (req, res, next) => {
  try {
    res.json({ settings: getDiscordSettings(req.user!.id) });
  } catch (error) {
    next(error);
  }
});

/** PUT /api/discord — save the webhook and/or event toggles. */
discordRouter.put("/", (req, res, next) => {
  try {
    const input = parseBody(
      z.object({
        webhook: z.string().min(1).max(500).optional(),
        events: z
          .array(z.enum(DISCORD_EVENTS))
          .max(DISCORD_EVENTS.length)
          .optional(),
      }),
      req.body
    );
    res.json({ settings: saveDiscordSettings(req.user!.id, input) });
  } catch (error) {
    next(error);
  }
});

/** POST /api/discord/test — send a test message to the saved webhook. */
discordRouter.post("/test", async (req, res, next) => {
  try {
    await sendTestMessage(req.user!.id);
    res.json({ ok: true, message: "Test message sent to your Discord channel." });
  } catch (error) {
    next(error);
  }
});

/** DELETE /api/discord — remove the saved webhook (keeps event toggles). */
discordRouter.delete("/", (req, res, next) => {
  try {
    deleteDiscordWebhook(req.user!.id);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});
