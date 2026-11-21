import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number }
) => Promise<Buffer>;

/**
 * Password hashing on node:crypto scrypt — a memory-hard KDF, so no native
 * dependency is needed. Stored format:
 *   scrypt$N$r$p$<salt base64>$<hash base64>
 * Verification compares in constant time.
 */

const PARAMS = { N: 16384, r: 8, p: 1 } as const;
const KEY_LENGTH = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, KEY_LENGTH, PARAMS);
  return [
    "scrypt",
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    salt.toString("base64"),
    hash.toString("base64"),
  ].join("$");
}

export async function verifyPassword(
  password: string,
  stored: string
): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") {
    return false;
  }
  const [, nRaw, rRaw, pRaw, saltB64, hashB64] = parts;
  if (
    nRaw === undefined ||
    rRaw === undefined ||
    pRaw === undefined ||
    saltB64 === undefined ||
    hashB64 === undefined
  ) {
    return false;
  }
  const params = {
    N: Number(nRaw),
    r: Number(rRaw),
    p: Number(pRaw),
  };
  if (!Number.isInteger(params.N) || !Number.isInteger(params.r) || !Number.isInteger(params.p)) {
    return false;
  }
  try {
    const expected = Buffer.from(hashB64, "base64");
    const actual = await scrypt(password, Buffer.from(saltB64, "base64"), expected.length, params);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
