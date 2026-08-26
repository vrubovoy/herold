import { describe, expect, it } from 'vitest'
import { resolveSecret } from '../config.js'

const NAME = 'HEROLD_CREDENTIAL_ENCRYPTION_KEY'
const FILE_NAME = `${NAME}_FILE`

function files(contents: Buffer | string, options: { regular?: boolean; size?: number; failRead?: boolean } = {}) {
  const bytes = Buffer.isBuffer(contents) ? contents : Buffer.from(contents)
  return {
    stat: () => ({ isFile: () => options.regular ?? true, size: options.size ?? bytes.length }),
    read: () => {
      if (options.failRead) throw new Error('injected read failure')
      return bytes
    },
  }
}

describe('resolveSecret', () => {
  it('returns undefined when neither the direct nor _FILE variable is set', () => {
    expect(resolveSecret(NAME, {})).toBeUndefined()
  })

  it('returns the direct value unchanged', () => {
    expect(resolveSecret(NAME, { [NAME]: 'a-direct-secret' })).toBe('a-direct-secret')
  })

  it('rejects setting both the direct and _FILE variables', () => {
    expect(() => resolveSecret(NAME, { [NAME]: 'x', [FILE_NAME]: '/run/secrets/key' }))
      .toThrow('HEROLD_CREDENTIAL_ENCRYPTION_KEY and HEROLD_CREDENTIAL_ENCRYPTION_KEY_FILE are mutually exclusive')
  })

  it('reads a secret file and strips exactly one trailing newline', () => {
    const value = resolveSecret(NAME, { [FILE_NAME]: '/run/secrets/key' }, files('the-secret-value\n'))
    expect(value).toBe('the-secret-value')
  })

  it('strips exactly one trailing CRLF, not more', () => {
    const value = resolveSecret(NAME, { [FILE_NAME]: '/run/secrets/key' }, files('the-secret-value\r\n\r\n'))
    expect(value).toBe('the-secret-value\r\n')
  })

  it('preserves a value with no trailing newline', () => {
    const value = resolveSecret(NAME, { [FILE_NAME]: '/run/secrets/key' }, files('no-newline-here'))
    expect(value).toBe('no-newline-here')
  })

  it('rejects a file path with surrounding whitespace', () => {
    expect(() => resolveSecret(NAME, { [FILE_NAME]: ' /run/secrets/key' }, files('x')))
      .toThrow('HEROLD_CREDENTIAL_ENCRYPTION_KEY_FILE must not have surrounding whitespace')
  })

  it('rejects a non-regular file', () => {
    expect(() => resolveSecret(NAME, { [FILE_NAME]: '/run/secrets/key' }, files('x', { regular: false })))
      .toThrow('64 KiB')
  })

  it('rejects a file over 64 KiB', () => {
    expect(() => resolveSecret(NAME, { [FILE_NAME]: '/run/secrets/key' }, files('x', { size: 65_537 })))
      .toThrow('64 KiB')
  })

  it('rejects a read failure', () => {
    expect(() => resolveSecret(NAME, { [FILE_NAME]: '/run/secrets/key' }, files('x', { failRead: true })))
      .toThrow('64 KiB')
  })

  it('rejects invalid UTF-8', () => {
    expect(() => resolveSecret(NAME, { [FILE_NAME]: '/run/secrets/key' }, files(Buffer.from([0xc3, 0x28]))))
      .toThrow('valid UTF-8')
  })

  it('rejects a file that is empty after newline removal', () => {
    expect(() => resolveSecret(NAME, { [FILE_NAME]: '/run/secrets/key' }, files('\n')))
      .toThrow('non-empty secret')
  })

  it('rejects a NUL byte from a file-sourced value', () => {
    expect(() => resolveSecret(NAME, { [FILE_NAME]: '/run/secrets/key' }, files(`x${'\0'}`)))
      .toThrow('NUL bytes')
  })

  it('rejects a NUL byte in a direct value', () => {
    expect(() => resolveSecret(NAME, { [NAME]: `x${'\0'}` }))
      .toThrow('HEROLD_CREDENTIAL_ENCRYPTION_KEY must not contain NUL bytes')
  })
})
