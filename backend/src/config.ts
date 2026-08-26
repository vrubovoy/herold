import { readFileSync, statSync } from 'node:fs'

const MAX_SECRET_FILE_BYTES = 64 * 1024

export interface SecretFileAccess {
  stat(path: string): { isFile(): boolean; size: number }
  read(path: string): Buffer
}

const defaultSecretFileAccess: SecretFileAccess = {
  stat: statSync,
  read: readFileSync,
}

// Resolves NAME, or reads a file path from NAME_FILE - the two are
// mutually exclusive. Callers decide whether an undefined result is an
// error; this only validates the value it does find.
export function resolveSecret(
  name: string,
  env: NodeJS.ProcessEnv = process.env,
  files: SecretFileAccess = defaultSecretFileAccess,
): string | undefined {
  const direct = env[name] || undefined
  const fileName = `${name}_FILE`
  const path = env[fileName] || undefined
  if (direct && path) throw new Error(`${name} and ${fileName} are mutually exclusive`)

  let value = direct
  if (path) {
    if (path.trim() !== path) throw new Error(`${fileName} must not have surrounding whitespace`)
    let bytes: Buffer
    try {
      const metadata = files.stat(path)
      if (!metadata.isFile()) throw new Error('not a regular file')
      if (metadata.size > MAX_SECRET_FILE_BYTES) throw new Error('file is too large')
      bytes = files.read(path)
    } catch {
      throw new Error(`${fileName} must reference a readable regular file no larger than 64 KiB`)
    }
    if (bytes.length > MAX_SECRET_FILE_BYTES) {
      throw new Error(`${fileName} must reference a readable regular file no larger than 64 KiB`)
    }
    try {
      value = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    } catch {
      throw new Error(`${fileName} must contain valid UTF-8`)
    }
    if (value.endsWith('\r\n')) value = value.slice(0, -2)
    else if (value.endsWith('\n')) value = value.slice(0, -1)
    if (!value || value.includes('\0')) throw new Error(`${fileName} must contain a non-empty secret without NUL bytes`)
  }
  if (value?.includes('\0')) throw new Error(`${name} must not contain NUL bytes`)
  return value
}
