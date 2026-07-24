/**
 * Integrations Phase 3 — encryption for stored business-channel secrets.
 * SERVER-ONLY (imports node:crypto).
 *
 * Access tokens (Zalo OA / WhatsApp Business / Telegram) are AES-256-GCM
 * encrypted before they touch the database — the table only ever holds
 * ciphertext + iv + auth tag, and they are decrypted only server-side, only on
 * the send path. The key comes from INTEGRATION_ENC_KEY (32 bytes, hex or
 * base64); when it's absent, encrypt/decrypt throw so we fail closed rather
 * than persist a plaintext secret by accident.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export type EncryptedSecret = { ciphertext: string; iv: string; tag: string };

/** Resolve the 32-byte key from INTEGRATION_ENC_KEY, or null if unusable. */
function loadKey(): Buffer | null {
  const raw = (process.env.INTEGRATION_ENC_KEY ?? "").trim();
  if (!raw) return null;
  const buf = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  return buf.length === 32 ? buf : null;
}

export function hasEncryptionKey(): boolean {
  return loadKey() !== null;
}

export function encryptSecret(plaintext: string): EncryptedSecret {
  const key = loadKey();
  if (!key) throw new Error("INTEGRATION_ENC_KEY is missing or not a 32-byte key (hex or base64).");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    ciphertext: ct.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptSecret(enc: EncryptedSecret): string {
  const key = loadKey();
  if (!key) throw new Error("INTEGRATION_ENC_KEY is missing or not a 32-byte key (hex or base64).");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(enc.iv, "base64"));
  decipher.setAuthTag(Buffer.from(enc.tag, "base64"));
  const pt = Buffer.concat([decipher.update(Buffer.from(enc.ciphertext, "base64")), decipher.final()]);
  return pt.toString("utf8");
}
