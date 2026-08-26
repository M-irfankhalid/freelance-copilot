import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Request, Response } from "express";

import { env } from "../../env.js";
import { getDb } from "../../db/index.js";
import { sessions, users } from "../../db/schema.js";

/**
 * DB-backed sessions. The cookie holds a random token; only its SHA-256 is
 * stored, so a leaked database cannot be replayed as valid sessions.
 */

export const SESSION_COOKIE = "fa_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function createSession(res: Response, userId: string): void {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  getDb()
    .insert(sessions)
    .values({
      id: hashToken(token),
      userId,
      expiresAt: expiresAt.toISOString(),
      createdAt: new Date().toISOString(),
    })
    .run();

  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
}

/** Resolve the signed-in user from the session cookie, or null. */
export function getSessionUser(req: Request): SessionUser | null {
  const raw = req.cookies?.[SESSION_COOKIE];
  if (typeof raw !== "string" || raw.length === 0) {
    return null;
  }

  const rows = getDb()
    .select({
      userId: users.id,
      email: users.email,
      name: users.name,
      expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.id, hashToken(raw)))
    .limit(1)
    .all();

  const row = rows[0];
  if (row === undefined) {
    return null;
  }
  if (new Date(row.expiresAt).getTime() < Date.now()) {
    getDb().delete(sessions).where(eq(sessions.id, hashToken(raw))).run();
    return null;
  }
  return { id: row.userId, email: row.email, name: row.name };
}

export function destroySession(req: Request, res: Response): void {
  const raw = req.cookies?.[SESSION_COOKIE];
  if (typeof raw === "string" && raw.length > 0) {
    getDb().delete(sessions).where(eq(sessions.id, hashToken(raw))).run();
  }
  res.clearCookie(SESSION_COOKIE, { path: "/" });
}
