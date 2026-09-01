import { Router } from "express";
import { z } from "zod";

import { requireUser } from "../../middleware/require-user.js";
import { listLogs, MAX_LOGS } from "./logs.service.js";

export const logsRouter = Router();
logsRouter.use(requireUser);

const levelSchema = z.enum(["debug", "info", "warn", "error"]).optional();
const categorySchema = z
  .enum(["sync", "analysis", "proposal", "proposals", "ai", "bid", "auth", "system"])
  .optional();

/**
 * GET /api/logs — list system logs with search, level, and category filters.
 * Query params:
 *   ?limit=    number (default 50, max 5000)
 *   ?offset=   number (default 0)
 *   ?level=    "debug" | "info" | "warn" | "error"
 *   ?category= "sync" | "analysis" | "proposal" | "proposals" | "ai" | "bid" | "auth" | "system"
 *   ?q=        search term matched against the message
 */
logsRouter.get("/", (req, res, next) => {
  try {
    const parseResult = z
      .object({
        limit: z.coerce.number().int().min(1).max(MAX_LOGS).optional(),
        offset: z.coerce.number().int().min(0).optional(),
        level: levelSchema,
        category: categorySchema,
        q: z.string().max(500).optional(),
      })
      .safeParse({
        limit: req.query.limit,
        offset: req.query.offset,
        level: req.query.level,
        category: req.query.category,
        q: req.query.q,
      });

    if (!parseResult.success) {
      const firstError = parseResult.error.issues[0];
      if (firstError) {
        res
          .status(400)
          .json({
            error: {
              code: "VALIDATION_ERROR",
              message: firstError.message,
            },
          });
        return;
      }
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid query parameters" } });
      return;
    }

    const result = listLogs({
      limit: parseResult.data.limit,
      offset: parseResult.data.offset ?? 0,
      level: parseResult.data.level,
      category: parseResult.data.category,
      search: parseResult.data.q,
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
});
