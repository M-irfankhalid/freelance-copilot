import type { Request, Response } from "express";

/** JSON 404 for anything that fell through the router. */
export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: {
      code: "NOT_FOUND",
      message: `No route for ${req.method} ${req.originalUrl}`,
    },
  });
}
