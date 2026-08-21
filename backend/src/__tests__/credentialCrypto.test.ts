import { describe, it, expect, afterEach } from 'vitest'
import { encryptCredential, decryptCredential } from '../lib/credentialCrypto.js'

const ENV_KEY = 'HEROLD_CREDENTIAL_ENCRYPTION_KEY'
const ORIGINAL_KEY = process.env[ENV_KEY]

afterEach(() => {
  if (ORIGINAL_KEY === undefined) {
    delete process.env[ENV_KEY]
  } else {
    process.env[ENV_KEY] = ORIGINAL_KEY
  }
})

describe('encryptCredential / decryptCredential round-trip', () => {
  it.each([
    ['short', 'a'],
    ['a plausible password', 'Sup3r$ecret!Password'],
    ['a long string', 'x'.repeat(500)],
    ['unicode / special characters', 'пароль-🔒-£€$-<script>&"\''],
  ])('round-trips %s exactly', (_label, plaintext) => {
    const stored = encryptCredential(plaintext)
    expect(decryptCredential(stored)).toBe(plaintext)
  })

  it('produces a different stored value each time it encrypts the same plaintext (random IV/nonce), but both still decrypt back to the same plaintext', () => {
    const plaintext = 'the-same-password'
    const stored1 = encryptCredential(plaintext)
    const stored2 = encryptCredential(plaintext)

    expect(stored1).not.toBe(stored2)
    expect(decryptCredential(stored1)).toBe(plaintext)
    expect(decryptCredential(stored2)).toBe(plaintext)
  })

  it('never stores the plaintext as a literal substring of the stored value', () => {
    const plaintext = 'super-secret-value-12345'
    const stored = encryptCredential(plaintext)
    expect(stored).not.toContain(plaintext)
  })
})

describe('decryptCredential — tamper / malformed input detection', () => {
  it('throws when given a tampered (bit-flipped) stored value instead of silently returning wrong plaintext', () => {
    const stored = encryptCredential('a-real-password')

    // Flip one character somewhere in the middle of the stored string -
    // GCM's auth tag must catch this.
    const mid = Math.floor(stored.length / 2)
    const flippedChar = stored[mid] === 'A' ? 'B' : 'A'
    const tampered = stored.slice(0, mid) + flippedChar + stored.slice(mid + 1)

    expect(tampered).not.toBe(stored)
    expect(() => decryptCredential(tampered)).toThrow()
  })

  it('throws when given a string that is not the expected stored format', () => {
    expect(() => decryptCredential('not-encrypted-at-all')).toThrow()
  })

  it('throws when given an empty string', () => {
    expect(() => decryptCredential('')).toThrow()
  })
})

describe('encryptCredential / decryptCredential — encryption key validation', () => {
  it('throws a clear error when HEROLD_CREDENTIAL_ENCRYPTION_KEY is unset', () => {
    delete process.env[ENV_KEY]
    expect(() => encryptCredential('anything')).toThrow()
  })

  it('throws when HEROLD_CREDENTIAL_ENCRYPTION_KEY does not base64-decode to exactly 32 bytes (too short)', () => {
    process.env[ENV_KEY] = Buffer.from('too-short').toString('base64')
    expect(() => encryptCredential('anything')).toThrow()
  })

  it('throws when HEROLD_CREDENTIAL_ENCRYPTION_KEY does not base64-decode to exactly 32 bytes (too long)', () => {
    process.env[ENV_KEY] = Buffer.alloc(48, 7).toString('base64')
    expect(() => encryptCredential('anything')).toThrow()
  })

  it('throws when decrypting with a key unset, even though the stored value itself is valid', () => {
    const stored = encryptCredential('a-value-encrypted-with-the-real-key')
    delete process.env[ENV_KEY]
    expect(() => decryptCredential(stored)).toThrow()
  })
})
