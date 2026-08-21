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

// Shared by every one-off action helper below (attachment download, Sent
// APPEND, flag updates, delete/move) - each opens its own fresh
// connection per call rather than pooling one per account, since these
// are low-frequency user-triggered actions, not the sync worker's own
// tight loop.
function openAccountClient(account: MailAccount): ImapFlow {
  return new ImapFlow({
    host: account.imapHost,
    port: account.imapPort,
    secure: account.imapSecurity === 'tls',
    auth: { user: account.imapUsername, pass: decryptCredential(account.imapPasswordEncrypted) },
    logger: false,
    connectionTimeout: 20_000,
    greetingTimeout: 20_000,
  })
}

async function closeClient(client: ImapFlow): Promise<void> {
  try {
    await client.logout()
  } catch {
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
  const client = openAccountClient(account)

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
  const client = openAccountClient(account)
  try {
    await client.connect()
    await client.append(folderName, raw, ['\\Seen'])
  } finally {
    await closeClient(client)
  }
}

// Writes read/unread and flagged/starred through to the real server
// before the caller updates its own local mirror row - see
// features/messages/router.ts's PATCH /messages/:id.
export async function setMessageFlags(
  account: MailAccount, folderName: string, imapUid: number,
  changes: { seen?: boolean; flagged?: boolean },
): Promise<void> {
  const client = openAccountClient(account)
  try {
    await client.connect()
    const lock = await client.getMailboxLock(folderName)
    try {
      if (changes.seen === true) await client.messageFlagsAdd(imapUid, ['\\Seen'], { uid: true })
      if (changes.seen === false) await client.messageFlagsRemove(imapUid, ['\\Seen'], { uid: true })
      if (changes.flagged === true) await client.messageFlagsAdd(imapUid, ['\\Flagged'], { uid: true })
      if (changes.flagged === false) await client.messageFlagsRemove(imapUid, ['\\Flagged'], { uid: true })
    } finally {
      lock.release()
    }
  } finally {
    await closeClient(client)
  }
}

// Moves the message into `trashFolderName` when given - imapflow's own
// messageMove already falls back to COPY + flag-\Deleted + EXPUNGE when
// the server lacks the MOVE extension (RFC 6851), so no capability check
// is needed here. With no known Trash folder (nothing to move into yet -
// see features/messages/router.ts's DELETE /messages/:id), permanently
// deletes the message in place instead (flag \Deleted + EXPUNGE).
export async function removeMessage(
  account: MailAccount, folderName: string, imapUid: number, trashFolderName: string | null,
): Promise<void> {
  const client = openAccountClient(account)
  try {
    await client.connect()
    const lock = await client.getMailboxLock(folderName)
    try {
      if (trashFolderName) {
        await client.messageMove(imapUid, trashFolderName, { uid: true })
      } else {
        await client.messageDelete(imapUid, { uid: true })
      }
    } finally {
      lock.release()
    }
  } finally {
    await closeClient(client)
  }
}
