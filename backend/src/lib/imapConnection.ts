import { ImapFlow } from 'imapflow'

export interface ImapCredentials {
  host: string
  port: number
  security: 'tls' | 'starttls' | 'none'
  username: string
  password: string
}

export type TestConnectionResult = { ok: true } | { ok: false; error: string }

// imapflow's own `secure` option only distinguishes implicit TLS (true)
// from "plain, upgrading to STARTTLS if the server offers it" (false) -
// there's no separate flag to force truly-plaintext-only. 'starttls' and
// 'none' therefore map to the same underlying behavior; a 'none' account
// still opportunistically upgrades when the server supports it, which is
// strictly safer than what the user asked for, never less secure.
function toImapFlowOptions(credentials: ImapCredentials) {
  return {
    host: credentials.host,
    port: credentials.port,
    secure: credentials.security === 'tls',
    auth: { user: credentials.username, pass: credentials.password },
    logger: false as const,
    // imapflow's own defaults (90s/16s) are far too long for a
    // synchronous "test connection" request - a typo'd or unreachable
    // host should fail back to the user in seconds, not minutes.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    // Logs out automatically right after a successful LOGIN - exactly
    // the "can we authenticate", nothing more, this endpoint needs.
    verifyOnly: true,
  }
}

export async function testImapConnection(credentials: ImapCredentials): Promise<TestConnectionResult> {
  const client = new ImapFlow(toImapFlowOptions(credentials))
  try {
    await client.connect()
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Не удалось подключиться' }
  } finally {
    // verifyOnly already logs out on success; a failed connect() never
    // reached an authenticated state to log out of - close() is a
    // no-op-safe way to tear down the socket either way.
    client.close()
  }
}
