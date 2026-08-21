import { ImapFlow, type FetchMessageObject } from 'imapflow'
import { simpleParser } from 'mailparser'
import { eq, and } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { db } from '../db/index.js'
import { mailAccounts, mailFolders, mailMessages, mailAttachmentRefs, type MailAccount, type MailFolder } from '../db/schema.js'
import { decryptCredential } from '../lib/credentialCrypto.js'
import { localizeImapError } from '../lib/imapConnection.js'
import { collectAttachmentParts } from './attachmentParts.js'

// Periodic pull, not push - matches the platform's other background
// worker (Tafel's due-scanner is the closest precedent), and is far
// simpler/more robust to run inside a stateless container than holding
// one persistent IMAP IDLE connection open per account indefinitely.
const SYNC_INTERVAL_MS = Number(process.env['HEROLD_SYNC_INTERVAL_MS'] ?? 180_000)
const CONNECT_TIMEOUT_MS = 20_000

function specialUseOf(flag: string | undefined): MailFolder['specialUse'] {
  switch (flag) {
    case '\\Sent': return 'sent'
    case '\\Drafts': return 'drafts'
    case '\\Trash': return 'trash'
    case '\\Junk': return 'junk'
    default: return null
  }
}

function openClient(account: MailAccount): ImapFlow {
  return new ImapFlow({
    host: account.imapHost,
    port: account.imapPort,
    secure: account.imapSecurity === 'tls',
    auth: { user: account.imapUsername, pass: decryptCredential(account.imapPasswordEncrypted) },
    logger: false,
    connectionTimeout: CONNECT_TIMEOUT_MS,
    greetingTimeout: CONNECT_TIMEOUT_MS,
  })
}

async function insertMessage(folder: MailFolder, msg: FetchMessageObject) {
  if (!msg.source) return
  const parsed = await simpleParser(msg.source)
  const envelope = msg.envelope
  const flags = msg.flags ?? new Set<string>()
  const attachments = msg.bodyStructure ? collectAttachmentParts(msg.bodyStructure) : []
  const bodyText = (parsed.text ?? '').trim()

  const id = createId()
  try {
    db.insert(mailMessages).values({
      id,
      folderId: folder.id,
      imapUid: msg.uid,
      messageId: envelope?.messageId ?? null,
      subject: envelope?.subject ?? null,
      fromAddress: envelope?.from?.[0]?.address ?? null,
      fromName: envelope?.from?.[0]?.name ?? null,
      toAddresses: JSON.stringify(envelope?.to ?? []),
      date: envelope?.date ?? (msg.internalDate instanceof Date ? msg.internalDate : new Date()),
      snippet: bodyText.slice(0, 200),
      bodyText,
      flagsSeen: flags.has('\\Seen'),
      flagsFlagged: flags.has('\\Flagged'),
      flagsDeleted: flags.has('\\Deleted'),
      hasAttachments: attachments.length > 0,
      sizeBytes: msg.size ?? 0,
      createdAt: new Date(),
    }).run()
  } catch {
    // The (folderId, imapUid) unique index rejects a UID this folder
    // already mirrored - a harmless no-op if a sync pass is ever
    // retried over a range it already inserted, not a real failure.
    return
  }

  for (const att of attachments) {
    db.insert(mailAttachmentRefs).values({
      id: createId(), messageId: id, filename: att.filename,
      mimeType: att.mimeType, sizeBytes: att.sizeBytes, partId: att.partId,
    }).run()
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

async function syncFolderMessages(client: ImapFlow, folder: MailFolder) {
  const mailbox = client.mailbox
  if (!mailbox) return
  const uidNext = mailbox.uidNext

  // New messages: everything from the last UID this folder saw up to
  // (not including) the server's predicted next UID.
  if (uidNext > folder.lastSeenUid + 1) {
    const range = `${folder.lastSeenUid + 1}:${uidNext - 1}`
    for await (const msg of client.fetch(range, {
      uid: true, envelope: true, flags: true, internalDate: true, size: true, bodyStructure: true, source: true,
    }, { uid: true })) {
      await insertMessage(folder, msg)
    }
    db.update(mailFolders).set({ lastSeenUid: uidNext - 1 }).where(eq(mailFolders.id, folder.id)).run()
  }

  // Flags-only refresh for everything already mirrored - cheap (no
  // envelope/source/bodyStructure requested), and keeps read/unread and
  // flagged state honest even though nothing in Herold can change them
  // yet (that's a later stage) - another client reading the same
  // mailbox elsewhere still can.
  if (folder.lastSeenUid > 0) {
    const range = `1:${folder.lastSeenUid}`
    for await (const msg of client.fetch(range, { uid: true, flags: true }, { uid: true })) {
      refreshFlags(folder.id, msg)
    }
  }
}

async function syncAccount(account: MailAccount) {
  const client = openClient(account)
  try {
    await client.connect()
    const list = await client.list()

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
          db.delete(mailMessages).where(eq(mailMessages.folderId, folder.id)).run()
          db.update(mailFolders).set({ uidValidity, lastSeenUid: 0, specialUse }).where(eq(mailFolders.id, folder.id)).run()
          folder = { ...folder, uidValidity, lastSeenUid: 0, specialUse }
        } else if (folder.specialUse !== specialUse) {
          db.update(mailFolders).set({ specialUse }).where(eq(mailFolders.id, folder.id)).run()
          folder = { ...folder, specialUse }
        }

        if (folder) await syncFolderMessages(client, folder)
      } finally {
        lock.release()
      }
    }

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
