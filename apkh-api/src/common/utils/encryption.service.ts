/**
 * AES-256-GCM symmetric encryption for sensitive user data (e.g. API keys).
 * The ENCRYPTION_SECRET env var must be a 64-char hex string (32 bytes).
 */
import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit IV recommended for GCM
const TAG_LENGTH = 16;

@Injectable()
export class EncryptionService {
  private readonly key: Buffer;

  constructor() {
    const secret = process.env.ENCRYPTION_SECRET ?? '';
    if (!secret || secret.length < 32) {
      throw new Error(
        'ENCRYPTION_SECRET env var must be at least 32 characters long.',
      );
    }
    // Derive a 32-byte key (SHA-256 of the secret string for convenience)
    this.key = crypto.createHash('sha256').update(secret).digest();
  }

  /** Encrypt plaintext → base64 string ( iv:tag:ciphertext ) */
  encrypt(plaintext: string): string {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, this.key, iv, {
      authTagLength: TAG_LENGTH,
    });
    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return [
      iv.toString('hex'),
      tag.toString('hex'),
      encrypted.toString('hex'),
    ].join(':');
  }

  /** Decrypt base64 string ( iv:tag:ciphertext ) → plaintext */
  decrypt(encoded: string): string {
    const [ivHex, tagHex, encHex] = encoded.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const encryptedText = Buffer.from(encHex, 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, this.key, iv, {
      authTagLength: TAG_LENGTH,
    });
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(encryptedText),
      decipher.final(),
    ]).toString('utf8');
  }
}
