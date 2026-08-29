import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";

import { getDb } from "../../db/index.js";
import { backupCodes, sessions, users } from "../../db/schema.js";
import { AppError } from "../../lib/errors.js";
import { hashPassword, verifyPassword } from "../../lib/password.js";

/**
 * Single-user auth business logic. The first registered account owns the
 * installation; every later registration attempt is refused.
 */

const BACKUP_CODE_COUNT = 8;

/** Unambiguous alphabet — no 0/O/1/I/L. */
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

function generateBackupCode(): string {
  const bytes = randomBytes(12);
  const chars = Array.from(bytes, (b) =>
    CODE_ALPHABET[b % CODE_ALPHABET.length],
  );
  const groups: string[] = [];
  for (let i = 0; i < 12; i += 4) {
    groups.push(chars.slice(i, i + 4).join(""));
  }
  return groups.join("-");
}

function hashBackupCode(code: string): string {
  return createHash("sha256")
    .update(code.trim().toUpperCase())
    .digest("hex");
}

export interface RegistrationResult {
  userId: string;
  /** Shown exactly once, in the signup response body. */
  backupCodes: string[];
}

export function countUsers(): number {
  return getDb().select({ n: users.id }).from(users).all().length;
}

export async function register(input: {
  name: string;
  email: string;
  password: string;
}): Promise<RegistrationResult> {
  if (countUsers() > 0) {
    throw new AppError(
      409,
      "CONFLICT",
      "This installation already has an owner. New registrations are disabled.",
    );
  }

  const userId = crypto.randomUUID();
  const now = new Date().toISOString();
  const passwordHash = await hashPassword(input.password);

  getDb()
    .insert(users)
    .values({
      id: userId,
      email: input.email.toLowerCase(),
      name: input.name,
      passwordHash,
      createdAt: now,
    })
    .run();

  const codes = Array.from({ length: BACKUP_CODE_COUNT }, generateBackupCode);
  for (const code of codes) {
    getDb()
      .insert(backupCodes)
      .values({
        id: crypto.randomUUID(),
        userId,
        codeHash: hashBackupCode(code),
        createdAt: now,
      })
      .run();
  }

  return { userId, backupCodes: codes };
}

export async function authenticate(
  email: string,
  password: string
): Promise<{ id: string; email: string; name: string }> {
  const rows = getDb()
    .select()
    .from(users)
    .where(eq(users.email, email.toLowerCase()))
    .limit(1)
    .all();
  const user = rows[0];
  if (user === undefined) {
    // Same message and status as a wrong password — never reveal which failed.
    throw new AppError(401, "UNAUTHORIZED", "Invalid email or password");
  }
  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) {
    throw new AppError(401, "UNAUTHORIZED", "Invalid email or password");
  }

  return { id: user.id, email: user.email, name: user.name };
}

/** Consume one unused backup code and set a new password. */
export async function recoverWithCode(
  code: string,
  newPassword: string
): Promise<void> {
  const normalized = code.trim().toUpperCase();
  const rows = getDb()
    .select({ id: backupCodes.id, userId: backupCodes.userId })
    .from(backupCodes)
    .where(and(eq(backupCodes.codeHash, hashBackupCode(normalized)), isNull(backupCodes.usedAt)))
    .limit(1)
    .all();
  const match = rows[0];
  if (match === undefined) {
    throw new AppError(400, "BAD_REQUEST", "Invalid or already used backup code");
  }

  const passwordHash = await hashPassword(newPassword);
  getDb()
    .update(users)
    .set({ passwordHash })
    .where(eq(users.id, match.userId))
    .run();

  getDb()
    .update(backupCodes)
    .set({ usedAt: new Date().toISOString() })
    .where(eq(backupCodes.id, match.id))
    .run();

  // A recovery event invalidates all existing sessions for safety.
  getDb().delete(sessions).where(eq(sessions.userId, match.userId)).run();
}
