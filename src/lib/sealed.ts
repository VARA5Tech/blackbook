import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Sealing for the few values that must never sit in the database readable:
 * passport numbers and the secure travel numbers beside them.
 *
 * AES-256-GCM with the key in `PII_ENCRYPTION_KEY` (32 bytes, base64 or hex),
 * a fresh random nonce per value, and the GCM tag checked on the way out, so a
 * value that was altered in the database refuses to open rather than opening
 * as something else. The key lives in the environment and nowhere else: a dump
 * of the database, a backup in R2, a copy on a laptop — none of them can read
 * a passport number.
 *
 * Losing the key loses the numbers. Keep a copy of it somewhere that is not
 * the server, and never rotate it without re-sealing what it sealed.
 *
 * Format: `v1.<nonce>.<tag>.<ciphertext>`, each base64url. The version is
 * there so a future key or algorithm can be told apart from this one.
 */

const VERSION = "v1";

function key(): Buffer {
  const raw = process.env.PII_ENCRYPTION_KEY?.trim();
  if (!raw) {
    // Fails closed. Storing a passport number unsealed because a variable was
    // forgotten is the one outcome this file exists to prevent.
    throw new Error("PII_ENCRYPTION_KEY is not set; refusing to seal or open a travel document.");
  }
  const bytes = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (bytes.length !== 32) {
    throw new Error("PII_ENCRYPTION_KEY must be 32 bytes, as 64 hex characters or base64.");
  }
  return bytes;
}

/** True when a key is configured, for screens that should say so rather than fail. */
export function canSeal(): boolean {
  try {
    key();
    return true;
  } catch {
    return false;
  }
}

export function seal(plain: string): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), nonce);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, nonce.toString("base64url"), tag.toString("base64url"), body.toString("base64url")].join(".");
}

export function open(sealed: string): string {
  const [version, nonce, tag, body] = sealed.split(".");
  if (version !== VERSION || !nonce || !tag || !body) {
    throw new Error("Not a sealed value this version of Blackbook can open.");
  }
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(nonce, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
}

/** The last four characters, which is all a screen shows until somebody reveals it. */
export function lastFour(plain: string): string {
  const compact = plain.replace(/\s+/g, "");
  return compact.slice(-4);
}
