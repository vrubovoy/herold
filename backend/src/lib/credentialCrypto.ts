import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { resolveSecret } from '../config.js'

// IMAP/SMTP passwords are the one genuinely sensitive thing Herold stores
// of its own (everything else - JWTs, sessions - lives in Schlüssel).
// Encrypted at rest with AES-256-GCM, keyed by a server-side secret never
// derived from user input, same "openssl rand -base64 32" convention as
// every HMAC secret elsewhere on the platform.
const ALGORITHM = 'aes-256-gcm'
// 96 bits - the size GCM is specified and optimized for; a longer IV
// gains nothing and a shorter one weakens the authentication tag.
const IV_LENGTH = 12

function encryptionKey(): Buffer {
  const raw = resolveSecret('HEROLD_CREDENTIAL_ENCRYPTION_KEY')
  if (!raw) throw new Error('HEROLD_CREDENTIAL_ENCRYPTION_KEY is not set')
  const key = Buffer.from(raw, 'base64')
  if (key.length !== 32) {
    throw new Error('HEROLD_CREDENTIAL_ENCRYPTION_KEY must decode to exactly 32 bytes - generate one with `openssl rand -base64 32`')
  }
  return key
}

// Stored as "iv:authTag:ciphertext", each base64 - a single text column
// rather than three, since nothing ever needs to query by IV or tag.
export function encryptCredential(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, encryptionKey(), iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return `${iv.toString('base64')}:${authTag.toString('base64')}:${ciphertext.toString('base64')}`
}

export function decryptCredential(stored: string): string {
  const parts = stored.split(':')
  if (parts.length !== 3) throw new Error('Malformed encrypted credential')
  const [ivB64, authTagB64, ciphertextB64] = parts as [string, string, string]
  const decipher = createDecipheriv(ALGORITHM, encryptionKey(), Buffer.from(ivB64, 'base64'))
  decipher.setAuthTag(Buffer.from(authTagB64, 'base64'))
  const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertextB64, 'base64')), decipher.final()])
  return plaintext.toString('utf8')
}
