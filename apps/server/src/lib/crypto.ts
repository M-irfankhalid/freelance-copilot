import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

import { env } from "../env.js";

/**
 * AES-256-GCM encryption for credentials at rest. The AES key is derived
 * from ENCRYPTION_KEY via scrypt with a fixed application salt — the env
 * value is a master passphrase, never used directly as key material.
 */

const SALT = "freelancer-agent.credentials.v1";

function deriveKey(): Buffer {
  return scryptSync(env.ENCRYPTION_KEY, SALT, 32);
}

export interface EncryptedValue {
  cipherText: string;
  iv: string;
  authTag: string;
}

export function encrypt(plaintext: string): EncryptedValue {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(), iv);
  const cipherText = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    cipherText: cipherText.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  };
}

/** Throws if the value was tampered with or the key changed. */
export function decrypt(value: EncryptedValue): string {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    deriveKey(),
    Buffer.from(value.iv, "base64")
  );
  decipher.setAuthTag(Buffer.from(value.authTag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(value.cipherText, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

/** Masked preview like "frl_••••3f9a" — safe to send to the frontend. */
export function mask(plaintext: string): string {
  const trimmed = plaintext.trim();
  if (trimmed.length <= 8) {
    return "•".repeat(trimmed.length);
  }
  return `${trimmed.slice(0, 4)}${"•".repeat(8)}${trimmed.slice(-4)}`;
}
