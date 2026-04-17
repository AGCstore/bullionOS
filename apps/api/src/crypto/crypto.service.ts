import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * AES-256-GCM symmetric encryption for at-rest secrets (integration credentials).
 *
 * Format on disk:  nonce(12) || ciphertext || authTag(16)
 * All three are fixed-length concatenations; no framing needed.
 *
 * Key rotation: change APP_ENCRYPTION_KEY + run a one-shot re-encrypt across
 * the integrations table. We don't support dual-key reads yet — that's a
 * Phase 6 job if it's ever needed.
 *
 * Why GCM over CBC: GCM is authenticated (detects tampering) and doesn't need
 * a separate MAC pass. Standard choice for new code.
 */
@Injectable()
export class CryptoService {
  private readonly key: Buffer;

  constructor(config: ConfigService) {
    this.key = Buffer.from(config.getOrThrow<string>('APP_ENCRYPTION_KEY'), 'base64');
    if (this.key.length !== 32) {
      // Env schema already enforces this, but belt-and-suspenders: failing here
      // at boot is a much better UX than failing on the first write.
      throw new Error('APP_ENCRYPTION_KEY must be 32 bytes (base64)');
    }
  }

  /** Encrypt a UTF-8 string. Returns a Buffer safe to store in bytea. */
  encrypt(plaintext: string): Buffer {
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, nonce);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([nonce, ciphertext, tag]);
  }

  /** Decrypt. Throws on tamper or wrong key — never returns bogus data silently. */
  decrypt(blob: Buffer): string {
    if (blob.length < 12 + 16) {
      throw new Error('Ciphertext blob too short');
    }
    const nonce = blob.subarray(0, 12);
    const tag = blob.subarray(blob.length - 16);
    const ciphertext = blob.subarray(12, blob.length - 16);

    const decipher = createDecipheriv('aes-256-gcm', this.key, nonce);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  }

  /** Convenience: encrypt+decrypt a JSON-serializable object. */
  encryptJson(value: unknown): Buffer {
    return this.encrypt(JSON.stringify(value));
  }
  decryptJson<T = unknown>(blob: Buffer): T {
    return JSON.parse(this.decrypt(blob)) as T;
  }
}
