import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const FORGE_DIR = path.join(os.homedir(), '.forge');
const MASTER_KEY_PATH = path.join(FORGE_DIR, 'master.key');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function getMasterKey(): Buffer {
  if (!fs.existsSync(FORGE_DIR)) {
    fs.mkdirSync(FORGE_DIR, { recursive: true });
  }

  if (!fs.existsSync(MASTER_KEY_PATH)) {
    const key = crypto.randomBytes(32);
    fs.writeFileSync(MASTER_KEY_PATH, key.toString('base64'));
    return key;
  }

  const keyBase64 = fs.readFileSync(MASTER_KEY_PATH, 'utf-8');
  return Buffer.from(keyBase64, 'base64');
}

export function encrypt(plaintext: string): string {
  const masterKey = getMasterKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, masterKey, iv);

  let ciphertext = cipher.update(plaintext, 'utf-8', 'base64');
  ciphertext += cipher.final('base64');

  const authTag = cipher.getAuthTag();

  // Combine IV + authTag + ciphertext
  const combined = Buffer.concat([
    iv,
    authTag,
    Buffer.from(ciphertext, 'base64')
  ]);

  return combined.toString('base64');
}

export function decrypt(combinedBase64: string): string {
  const masterKey = getMasterKey();
  const combined = Buffer.from(combinedBase64, 'base64');

  const iv = combined.subarray(0, IV_LENGTH);
  const authTag = combined.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = combined.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = crypto.createDecipheriv(ALGORITHM, masterKey, iv);
  decipher.setAuthTag(authTag);

  let plaintext = decipher.update(ciphertext, undefined, 'utf-8');
  plaintext += decipher.final('utf-8');

  return plaintext;
}

export function redactSecrets(text: string, secrets: Record<string, string>): string {
  let redacted = text;
  for (const value of Object.values(secrets)) {
    if (value && value.length > 3) {
      // Escape special regex characters in the secret value
      const escapedValue = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escapedValue, 'g');
      redacted = redacted.replace(regex, '[REDACTED]');
    }
  }
  return redacted;
}
