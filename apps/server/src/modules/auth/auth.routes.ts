import { Router } from "express";
import { z } from "zod";

import { parseBody } from "../../lib/validate.js";
import { createLogger } from "../../lib/logger.js";
import {
  authenticate,
  countUsers,
  recoverWithCode,
  register,
} from "./auth.service.js";
import {
  createSession,
  destroySession,
  getSessionUser,
} from "./session.js";

export const authRouter = Router();
const log = createLogger("auth");

const passwordSchema = z
  .string()
  .min(10, "Password must be at least 10 characters");

/**
 * Session probe. `authEnabled` is now true — real sessions exist. The
 * frontend's ProtectedRoute reads this to decide whether to guard routes.
 */
authRouter.get("/me", (req, res) => {
  const user = getSessionUser(req);
  res.json({
    authenticated: user !== null,
    authEnabled: true,
    needsSetup: countUsers() === 0,
    user: user === null ? null : { name: user.name, email: user.email },
  });
});

authRouter.post("/register", async (req, res, next) => {
  try {
    const input = parseBody(
      z.object({
        name: z.string().min(1).max(100),
        email: z.string().email(),
        password: passwordSchema,
      }),
      req.body
    );

    const result = await register(input);
    log.info(`New owner registered for ${input.email}`);
    createSession(res, result.userId);
    res.status(201).json({
      backupCodes: result.backupCodes,
      user: { name: input.name, email: input.email.toLowerCase() },
    });
  } catch (error) {
    next(error);
  }
});

authRouter.post("/login", async (req, res, next) => {
  try {
    const input = parseBody(
      z.object({ email: z.string().email(), password: z.string().min(1) }),
      req.body
    );
    const user = await authenticate(input.email, input.password);
    createSession(res, user.id);
    log.info(`Login OK for ${input.email}`);
    res.json({ user: { name: user.name, email: user.email } });
  } catch (error) {
    next(error);
  }
});

authRouter.post("/logout", (req, res) => {
  const user = getSessionUser(req);
  if (user !== null) {
    log.info(`Logout for ${user.email}`);
  }
  destroySession(req, res);
  res.json({ ok: true });
});

/** Forgot-password path: consume one unused backup code, set new password. */
authRouter.post("/recover", async (req, res, next) => {
  try {
    const input = parseBody(
      z.object({ code: z.string().min(1), password: passwordSchema }),
      req.body
    );
    await recoverWithCode(input.code, input.password);
    log.info("Password reset via backup code");
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});
