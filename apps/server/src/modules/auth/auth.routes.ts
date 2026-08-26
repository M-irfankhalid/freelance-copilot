import { Router } from "express";

export const authRouter = Router();

/**
 * Session probe for the frontend's auth state. Auth is not implemented until
 * Phase 4 — the server says so explicitly, and the frontend bypasses route
 * protection while `authEnabled` is false. Phase 4 flips this to real
 * cookie-session lookups without touching frontend code.
 */
authRouter.get("/me", (_req, res) => {
  res.json({ authenticated: false, authEnabled: false });
});
