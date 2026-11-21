import type { NextFunction, Request, Response } from "express";

import { createLogger } from "../lib/logger.js";

const log = createLogger("system");

/**
 * One structured line per request. Health checks log at debug so they do not
 * drown out meaningful activity at the default level.
 */
export function requestLogger(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const start = Date.now();
  res.on("finish", () => {
    const isRoutineHealth = req.path === "/api/health" && res.statusCode < 400;
    const level = isRoutineHealth ? "debug" : "info";
    log[level](
      `${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - start}ms`
    );
  });
  next();
}
