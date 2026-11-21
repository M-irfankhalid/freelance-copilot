import type { NextFunction, Request, Response } from "express";

import { unauthorized } from "../lib/errors.js";
import { getSessionUser, type SessionUser } from "../modules/auth/session.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: SessionUser;
    }
  }
}

/** Guards endpoints that only the installation owner may call. */
export function requireUser(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  const user = getSessionUser(req);
  if (user === null) {
    next(unauthorized());
    return;
  }
  req.user = user;
  next();
}
