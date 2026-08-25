import { ImapFlow } from 'imapflow'
import { isIP } from 'node:net'
import type { MailAccount } from '../db/schema.js'
import { decryptCredential } from './credentialCrypto.js'
import { resolveOutboundHost } from './outboundResolver.js'

export interface ImapCredentials {
  host: string
  port: number
  security: 'tls' | 'starttls' | 'none'
  username: string
  password: string
}

export type TestConnectionResult = { ok: true } | { ok: false; error: string }

// imapflow (and the underlying Node network/TLS stack) throws raw,
// English, often cryptic protocol/library text ("Command failed",
// "connect ECONNREFUSED ...") - never fit to show a user directly. Every
// caller that surfaces a connection failure routes through this instead
// of `error.message`, so the UI always shows a real Russian sentence.
export function localizeImapError(error: unknown): string {
  if (error && typeof error === 'object') {
    if ('authenticationFailed' in error && (error as { authenticationFailed?: boolean }).authenticationFailed) {
      return 'Неверный логин или пароль'
    }
    const code = 'code' in error ? (error as { code?: string }).code : undefined
    if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'Сервер не найден - проверьте адрес'
    if (code === 'ECONNREFUSED') return 'Сервер отклонил подключение - проверьте адрес и порт'
    if (code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT') return 'Сервер не отвечает - проверьте адрес, порт и шифрование'
    if (code === 'ECONNRESET' || code === 'EPROTO') return 'Соединение разорвано - проверьте порт и тип шифрования'
    if (code === 'EOUTBOUND') return 'Адрес почтового сервера запрещён политикой безопасности'
  }
  return 'Не удалось подключиться. Проверьте адрес сервера, логин и пароль'
}

// Keep all IMAP clients on one security mapping. Implicit TLS connects
// securely from byte one, STARTTLS must upgrade before authentication,
// and none explicitly disables the opportunistic upgrade.
export async function createImapOptions(credentials: ImapCredentials, verifyOnly = false) {
  const resolved = await resolveOutboundHost(credentials.host)
  return {
    host: credentials.host, port: credentials.port,
    secure: credentials.security === 'tls',
    doSTARTTLS: credentials.security === 'starttls' ? true : credentials.security === 'none' ? false : undefined,
    auth: { user: credentials.username, pass: credentials.password }, logger: false as const,
    // imapflow's own defaults (90s/16s) are far too long for a
    // synchronous "test connection" request - a typo'd or unreachable
    // host should fail back to the user in seconds, not minutes.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    // Logs out automatically right after a successful LOGIN - exactly
    // the "can we authenticate", nothing more, this endpoint needs.
    verifyOnly,
    tls: { lookup: resolved.lookup, servername: isIpLiteral(credentials.host) ? undefined : credentials.host },
  } satisfies ConstructorParameters<typeof ImapFlow>[0]
}

function isIpLiteral(host: string): boolean {
  return isIP(host.replace(/^\[|\]$/g, '')) !== 0
}

export async function testImapConnection(credentials: ImapCredentials): Promise<TestConnectionResult> {
  let client: ImapFlow | undefined
  try {
    client = new ImapFlow(await createImapOptions(credentials, true))
    await client.connect()
    return { ok: true }
  } catch (error) {
    return { ok: false, error: localizeImapError(error) }
  } finally {
    // verifyOnly already logs out on success; a failed connect() never
    // reached an authenticated state to log out of - close() is a
    // no-op-safe way to tear down the socket either way.
    client?.close()
  }
}

// Shared by every one-off action helper below (attachment download, Sent
// APPEND, flag updates, delete/move) - each opens its own fresh
// connection per call rather than pooling one per account, since these
// are low-frequency user-triggered actions, not the sync worker's own
// tight loop.
async function openAccountClient(account: MailAccount): Promise<ImapFlow> {
  return new ImapFlow(await createImapOptions({
    host: account.imapHost,
    port: account.imapPort,
    security: account.imapSecurity,
    username: account.imapUsername,
    password: decryptCredential(account.imapPasswordEncrypted),
  }))
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
export async function openAttachmentStream(account: MailAccount, folderName: string, imapUid: number, partId: string, maxBytes: number) {
  const client = await openAccountClient(account)

  const close = () => { client.logout().catch(() => client.close()) }

  await client.connect()
  const lock = await client.getMailboxLock(folderName)
  try {
    const download = await client.download(imapUid, partId, { uid: true, maxBytes })
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

// Optional Sent filing for providers that do not auto-file SMTP submissions.
// The caller invokes this only for append-mode accounts; sync reconciles the
// pending local row by Message-ID and suppresses duplicate local copies.
export async function appendToSent(account: MailAccount, folderName: string, raw: Buffer): Promise<void> {
  const client = await openAccountClient(account)
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
  const client = await openAccountClient(account)
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
  const client = await openAccountClient(account)
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
