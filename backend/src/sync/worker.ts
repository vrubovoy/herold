import { ImapFlow, type FetchMessageObject } from 'imapflow'
import { simpleParser } from 'mailparser'
import { eq, and, asc, gt } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { db } from '../db/index.js'
import { mailAccounts, mailFolders, mailMessages, mailAttachmentRefs, type MailAccount, type MailFolder } from '../db/schema.js'
import { decryptCredential } from '../lib/credentialCrypto.js'
import { createImapOptions, localizeImapError } from '../lib/imapConnection.js'
import { collectAttachmentParts } from './attachmentParts.js'
import { positiveIntegerEnv } from '../lib/limits.js'

// Periodic pull, not push - matches the platform's other background
// worker (Tafel's due-scanner is the closest precedent), and is far
// simpler/more robust to run inside a stateless container than holding
// one persistent IMAP IDLE connection open per account indefinitely.
const SYNC_INTERVAL_MS = Number(process.env['HEROLD_SYNC_INTERVAL_MS'] ?? 180_000)
const MAX_MESSAGE_TEXT_BYTES = positiveIntegerEnv('HEROLD_MAX_MESSAGE_TEXT_BYTES', 256 * 1024)
const MAX_ACCOUNT_SYNC_BYTES = positiveIntegerEnv('HEROLD_MAX_ACCOUNT_SYNC_BYTES', 25 * 1024 * 1024)
const MAX_ACCOUNT_SYNC_MESSAGES = positiveIntegerEnv('HEROLD_MAX_ACCOUNT_SYNC_MESSAGES', 1000)

function specialUseOf(flag: string | undefined): MailFolder['specialUse'] {
  switch (flag) {
    case '\\Sent': return 'sent'
    case '\\Drafts': return 'drafts'
    case '\\Trash': return 'trash'
    case '\\Junk': return 'junk'
    default: return null
  }
}

async function openClient(account: MailAccount): Promise<ImapFlow> {
  return new ImapFlow(await createImapOptions({
    host: account.imapHost,
    port: account.imapPort,
    security: account.imapSecurity,
    username: account.imapUsername,
    password: decryptCredential(account.imapPasswordEncrypted),
  }))
}

interface SyncQuota {
  messagesRemaining: number
  bytesRemaining: number
}

function textPartOf(node: NonNullable<FetchMessageObject['bodyStructure']>): typeof node | undefined {
  if (node.type.toLowerCase() === 'text/plain' && node.part && !node.dispositionParameters?.['filename']) return node
  for (const child of node.childNodes ?? []) {
    const found = textPartOf(child)
    if (found) return found
  }
  return undefined
}

async function fetchBoundedText(client: ImapFlow, msg: FetchMessageObject, quota: SyncQuota): Promise<string> {
  if (!msg.bodyStructure || quota.bytesRemaining <= 0) return ''
  const part = textPartOf(msg.bodyStructure)
  if (!part?.part) return ''
  const maxLength = Math.min(MAX_MESSAGE_TEXT_BYTES, quota.bytesRemaining)
  const body = await client.fetchOne(msg.uid, {
    bodyParts: [{ key: part.part, maxLength }],
  }, { uid: true })
  const bytes = body && body.bodyParts?.get(part.part)
  if (!bytes) return ''
  quota.bytesRemaining -= bytes.byteLength
  const charset = part.parameters?.['charset'] ?? 'utf-8'
  const transferEncoding = part.encoding ?? '8bit'
  const parsed = await simpleParser(Buffer.concat([
    Buffer.from(`Content-Type: text/plain; charset="${charset}"\r\nContent-Transfer-Encoding: ${transferEncoding}\r\n\r\n`),
    bytes,
  ]))
  return (parsed.text ?? '').trim()
}

async function insertMessage(client: ImapFlow, folder: MailFolder, msg: FetchMessageObject, quota: SyncQuota) {
  const bodyText = await fetchBoundedText(client, msg, quota)
  const envelope = msg.envelope
  const flags = msg.flags ?? new Set<string>()
  const attachments = msg.bodyStructure ? collectAttachmentParts(msg.bodyStructure) : []

  const id = createId()
  try {
    db.transaction((tx) => {
      const values = {
        folderId: folder.id, imapUid: msg.uid, messageId: envelope?.messageId ?? null,
        subject: envelope?.subject ?? null, fromAddress: envelope?.from?.[0]?.address ?? null,
        fromName: envelope?.from?.[0]?.name ?? null, toAddresses: JSON.stringify(envelope?.to ?? []),
        date: envelope?.date ?? (msg.internalDate instanceof Date ? msg.internalDate : new Date()),
        snippet: bodyText.slice(0, 200), bodyText, flagsSeen: flags.has('\\Seen'),
        flagsFlagged: flags.has('\\Flagged'), flagsDeleted: flags.has('\\Deleted'),
        hasAttachments: attachments.length > 0, sizeBytes: msg.size ?? 0,
        reconciliationState: 'synced' as const,
      }
      const sameMessage = envelope?.messageId && folder.specialUse === 'sent'
        ? tx.select().from(mailMessages).where(and(
          eq(mailMessages.folderId, folder.id), eq(mailMessages.messageId, envelope.messageId),
        )).get()
        : undefined
      if (sameMessage) {
        if (sameMessage.reconciliationState === 'synced') return
        tx.update(mailMessages).set(values).where(eq(mailMessages.id, sameMessage.id)).run()
        for (const att of attachments) tx.insert(mailAttachmentRefs).values({
          id: createId(), messageId: sameMessage.id, filename: att.filename,
          mimeType: att.mimeType, sizeBytes: att.sizeBytes, partId: att.partId,
        }).run()
        return
      }
      tx.insert(mailMessages).values({ id, ...values, createdAt: new Date() }).run()
      for (const att of attachments) tx.insert(mailAttachmentRefs).values({
        id: createId(), messageId: id, filename: att.filename,
        mimeType: att.mimeType, sizeBytes: att.sizeBytes, partId: att.partId,
      }).run()
    })
  } catch (error) {
    const sqliteError = error as { code?: string; message?: string }
    const uidDuplicate = sqliteError.code === 'SQLITE_CONSTRAINT_UNIQUE'
      && sqliteError.message?.includes('mail_messages.folder_id, mail_messages.imap_uid')
    if (!uidDuplicate) throw error
  }
}

function refreshFlags(folderId: string, msg: FetchMessageObject) {
  const flags = msg.flags
  if (!flags) return
  db.update(mailMessages).set({
    flagsSeen: flags.has('\\Seen'),
    flagsFlagged: flags.has('\\Flagged'),
    flagsDeleted: flags.has('\\Deleted'),
  }).where(and(eq(mailMessages.folderId, folderId), eq(mailMessages.imapUid, msg.uid))).run()
}

async function syncFolderMessages(client: ImapFlow, folder: MailFolder, quota: SyncQuota) {
  const mailbox = client.mailbox
  if (!mailbox) return
  const uidNext = mailbox.uidNext

  // New messages: everything from the last UID this folder saw up to
  // (not including) the server's predicted next UID.
  if (uidNext > folder.lastSeenUid + 1 && quota.messagesRemaining > 0) {
    const lastUid = Math.min(uidNext - 1, folder.lastSeenUid + quota.messagesRemaining)
    const range = `${folder.lastSeenUid + 1}:${lastUid}`
    for await (const msg of client.fetch(range, {
      uid: true, envelope: true, flags: true, internalDate: true, size: true, bodyStructure: true,
    }, { uid: true })) {
      await insertMessage(client, folder, msg, quota)
    }
    quota.messagesRemaining -= lastUid - folder.lastSeenUid
    db.update(mailFolders).set({ lastSeenUid: lastUid }).where(eq(mailFolders.id, folder.id)).run()
  }

  // Refresh and reconcile a bounded cursor window of mirrored UIDs. Missing
  // rows are deleted only after the entire FETCH completes successfully.
  if (folder.lastSeenUid > 0 && quota.messagesRemaining > 0) {
    let mirrored = db.select({ id: mailMessages.id, imapUid: mailMessages.imapUid })
      .from(mailMessages).where(and(
        eq(mailMessages.folderId, folder.id), gt(mailMessages.imapUid, folder.reconcileCursor),
      )).orderBy(asc(mailMessages.imapUid)).limit(quota.messagesRemaining).all()
    if (mirrored.length === 0 && folder.reconcileCursor > 0) {
      db.update(mailFolders).set({ reconcileCursor: 0 }).where(eq(mailFolders.id, folder.id)).run()
      mirrored = db.select({ id: mailMessages.id, imapUid: mailMessages.imapUid })
        .from(mailMessages).where(and(
          eq(mailMessages.folderId, folder.id), gt(mailMessages.imapUid, 0),
        )).orderBy(asc(mailMessages.imapUid)).limit(quota.messagesRemaining).all()
    }
    const requestedUids = mirrored.map((message) => message.imapUid)
    if (requestedUids.length === 0) return
    const serverUids = new Set<number>()
    for await (const msg of client.fetch(requestedUids, { uid: true, flags: true }, { uid: true })) {
      serverUids.add(msg.uid)
      refreshFlags(folder.id, msg)
    }
    db.transaction((tx) => {
      for (const message of mirrored) {
        if (!serverUids.has(message.imapUid)) {
          tx.delete(mailMessages).where(eq(mailMessages.id, message.id)).run()
        }
      }
      tx.update(mailFolders).set({ reconcileCursor: requestedUids.at(-1) })
        .where(eq(mailFolders.id, folder.id)).run()
    })
    quota.messagesRemaining -= requestedUids.length
  }
}

async function syncAccount(account: MailAccount) {
  const client = await openClient(account)
  const quota: SyncQuota = { messagesRemaining: MAX_ACCOUNT_SYNC_MESSAGES, bytesRemaining: MAX_ACCOUNT_SYNC_BYTES }
  try {
    await client.connect()
    const list = await client.list()
    const seenFolderIds = new Set<string>()

    for (const entry of list) {
      // \Noselect mailboxes are pure hierarchy nodes (e.g. a parent
      // folder that only groups children) - can't be opened at all.
      if (entry.flags.has('\\Noselect')) continue

      const specialUse = entry.path.toUpperCase() === 'INBOX' ? 'inbox' : specialUseOf(entry.specialUse)
      let folder = db.select().from(mailFolders)
        .where(and(eq(mailFolders.accountId, account.id), eq(mailFolders.name, entry.path)))
        .get()

      const lock = await client.getMailboxLock(entry.path)
      try {
        const mailbox = client.mailbox
        if (!mailbox) continue
        // SQLite integers are safe up to 2^53 - real-world UIDVALIDITY
        // values (commonly a Unix timestamp) are nowhere near that.
        const uidValidity = Number(mailbox.uidValidity)

        if (!folder) {
          const id = createId()
          db.insert(mailFolders).values({
            id, accountId: account.id, name: entry.path, specialUse,
            uidValidity, lastSeenUid: 0, createdAt: new Date(),
          }).run()
          folder = db.select().from(mailFolders).where(eq(mailFolders.id, id)).get()
        } else if (folder.uidValidity !== uidValidity) {
          // The server reset UID numbering for this folder - every
          // mirrored message in it is now meaningless (UIDs no longer
          // mean what they meant when they were mirrored). Wipe and
          // re-sync from scratch rather than risk silently mismatched
          // messages.
          db.transaction((tx) => {
            tx.delete(mailMessages).where(eq(mailMessages.folderId, folder!.id)).run()
            tx.update(mailFolders).set({ uidValidity, lastSeenUid: 0, reconcileCursor: 0, specialUse }).where(eq(mailFolders.id, folder!.id)).run()
          })
          folder = { ...folder, uidValidity, lastSeenUid: 0, reconcileCursor: 0, specialUse }
        } else if (folder.specialUse !== specialUse) {
          db.update(mailFolders).set({ specialUse }).where(eq(mailFolders.id, folder.id)).run()
          folder = { ...folder, specialUse }
        }

        if (folder) {
          seenFolderIds.add(folder.id)
          await syncFolderMessages(client, folder, quota)
        }
      } finally {
        lock.release()
      }
    }

    db.transaction((tx) => {
      const mirrored = tx.select().from(mailFolders).where(eq(mailFolders.accountId, account.id)).all()
      for (const folder of mirrored) {
        if (!seenFolderIds.has(folder.id)) tx.delete(mailFolders).where(eq(mailFolders.id, folder.id)).run()
      }
    })

    db.update(mailAccounts).set({
      syncState: 'ok', lastSyncedAt: new Date(), lastError: null,
    }).where(eq(mailAccounts.id, account.id)).run()
  } catch (error) {
    db.update(mailAccounts).set({
      syncState: 'error',
      lastSyncedAt: new Date(),
      lastError: localizeImapError(error),
    }).where(eq(mailAccounts.id, account.id)).run()
  } finally {
    try {
      await client.logout()
    } catch {
      client.close()
    }
  }
}

let running = false

async function runSyncPass() {
  // A pass that's still running (e.g. a slow account) skips this tick
  // rather than overlapping with itself - the next tick picks up
  // wherever the previous one left off, since progress (lastSeenUid) is
  // committed per folder as it happens, not batched at the very end.
  if (running) return
  running = true
  try {
    const accounts = db.select().from(mailAccounts).all()
    for (const account of accounts) {
      await syncAccount(account)
    }
  } finally {
    running = false
  }
}

export function startMailSyncWorker() {
  let timer: ReturnType<typeof setInterval> | undefined
  void runSyncPass()
  timer = setInterval(() => { void runSyncPass() }, SYNC_INTERVAL_MS)

  return {
    stop: async () => {
      if (timer) clearInterval(timer)
      while (running) await new Promise((resolve) => setTimeout(resolve, 50))
    },
  }
}
