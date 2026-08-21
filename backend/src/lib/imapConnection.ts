import { ImapFlow } from 'imapflow'
import type { MailAccount } from '../db/schema.js'
import { decryptCredential } from './credentialCrypto.js'

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

// Attachments are never mirrored locally (see Hof/ROADMAP.md's Herold
// entry) - every download opens a fresh one-off IMAP connection,
// fetches exactly the one BODYSTRUCTURE part the caller asked for, and
// streams it straight through. The connection deliberately stays open
// past this function's own return - the caller is handed a live
// Readable still being fed by it, and closing here would cut that
// stream off mid-flight. It's the returned `close()` that the caller
// must invoke once the stream is fully drained (or errors).
export async function openAttachmentStream(account: MailAccount, folderName: string, imapUid: number, partId: string) {
  const client = new ImapFlow({
    host: account.imapHost,
    port: account.imapPort,
    secure: account.imapSecurity === 'tls',
    auth: { user: account.imapUsername, pass: decryptCredential(account.imapPasswordEncrypted) },
    logger: false,
    connectionTimeout: 20_000,
    greetingTimeout: 20_000,
  })

  const close = () => { client.logout().catch(() => client.close()) }

  await client.connect()
  const lock = await client.getMailboxLock(folderName)
  try {
    const download = await client.download(imapUid, partId, { uid: true })
    // Releasing the mailbox lock only frees this connection for a
    // *different* command - it doesn't touch the already-in-flight
    // FETCH response the returned stream is still reading from.
    lock.release()
    return { ...download, close }
  } catch (error) {
    lock.release()
    close()
    throw error
  }
}

// Best-effort mirroring of a just-sent message into the account's own
// Sent folder - many providers (Gmail, etc.) already auto-file a message
// sent through their SMTP server, in which case this APPEND produces a
// harmless duplicate that the next sync pass's UIDVALIDITY/UID bookkeeping
// never even notices (it's simply another message with a higher UID).
// Failure here is deliberately swallowed by the caller (see
// features/messages/router.ts) - the send itself already succeeded, and a
// missing Sent copy is a cosmetic gap the next sync pass cannot fix on its
// own only if the provider *also* doesn't auto-file, which is rare.
export async function appendToSent(account: MailAccount, folderName: string, raw: Buffer): Promise<void> {
  const client = new ImapFlow({
    host: account.imapHost,
    port: account.imapPort,
    secure: account.imapSecurity === 'tls',
    auth: { user: account.imapUsername, pass: decryptCredential(account.imapPasswordEncrypted) },
    logger: false,
    connectionTimeout: 20_000,
    greetingTimeout: 20_000,
  })
  try {
    await client.connect()
    await client.append(folderName, raw, ['\\Seen'])
  } finally {
    try {
      await client.logout()
    } catch {
      client.close()
    }
  }
}
