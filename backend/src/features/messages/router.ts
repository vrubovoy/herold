import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { Readable } from 'node:stream'
import { eq, and, or, like, desc, sql } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { db } from '../../db/index.js'
import { mailFolders, mailMessages, mailAttachmentRefs, type MailMessage, type MailAttachmentRef } from '../../db/schema.js'
import { requireAuth } from '../../middleware/auth.js'
import { getOwnedAccount, getOwnedFolder, getOwnedMessage } from '../../lib/mailOwnership.js'
import { openAttachmentStream, appendToSent, setMessageFlags, removeMessage } from '../../lib/imapConnection.js'
import { sendMail } from '../../lib/mailSend.js'

const router = new Hono()
router.use('*', requireAuth)

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  // Matched against subject/sender/body via SQL LIKE - a folder-scoped
  // search over the local mirror, same shape as this endpoint's own
  // ordinary listing (no separate /search route or result envelope).
  q: z.string().trim().min(1).max(200).optional(),
})

const updateFlagsSchema = z.object({
  flagsSeen: z.boolean().optional(),
  flagsFlagged: z.boolean().optional(),
}).refine((v) => v.flagsSeen !== undefined || v.flagsFlagged !== undefined, {
  message: 'At least one of flagsSeen/flagsFlagged must be provided',
})

const emailSchema = z.string().trim().toLowerCase().email().max(320)
const sendMessageSchema = z.object({
  to: z.array(emailSchema).min(1).max(50),
  cc: z.array(emailSchema).max(50).optional(),
  bcc: z.array(emailSchema).max(50).optional(),
  subject: z.string().trim().max(500).optional(),
  bodyText: z.string().min(1).max(200_000),
  // The message being replied to/forwarded from's own mirrored
  // messageId (see mailMessages.messageId) - absent for a fresh compose.
  inReplyTo: z.string().trim().max(1000).optional(),
})

// The list view - snippet, not the full body, matching an ordinary
// inbox list's own information density.
function messageSummaryJson(message: MailMessage) {
  return {
    id: message.id,
    subject: message.subject,
    fromAddress: message.fromAddress,
    fromName: message.fromName,
    date: message.date,
    snippet: message.snippet,
    flagsSeen: message.flagsSeen,
    flagsFlagged: message.flagsFlagged,
    hasAttachments: message.hasAttachments,
  }
}

function messageDetailJson(message: MailMessage, attachments: MailAttachmentRef[]) {
  return {
    id: message.id,
    // The RFC822 Message-ID header - exposed only here (never on the
    // list view) so the frontend's reply/reply-all compose flow can send
    // it back as In-Reply-To/References (see POST .../messages/send).
    messageId: message.messageId,
    subject: message.subject,
    fromAddress: message.fromAddress,
    fromName: message.fromName,
    // Stored as a JSON-encoded MessageAddressObject[] (see db/schema.ts) -
    // parsed back into a real array here, the one place that matters.
    toAddresses: JSON.parse(message.toAddresses) as { name?: string; address?: string }[],
    date: message.date,
    bodyText: message.bodyText,
    flagsSeen: message.flagsSeen,
    flagsFlagged: message.flagsFlagged,
    // Never the IMAP partId - see mailAttachmentRefs' own doc comment.
    attachments: attachments.map((a) => ({ id: a.id, filename: a.filename, mimeType: a.mimeType, sizeBytes: a.sizeBytes })),
    createdAt: message.createdAt,
  }
}

router.get('/folders/:folderId/messages', zValidator('query', listQuerySchema), (c) => {
  const user = c.get('user')
  const { folderId } = c.req.param()
  if (!getOwnedFolder(user.id, folderId)) return c.json({ error: 'Not found' }, 404)

  const { limit, offset, q } = c.req.valid('query')
  const condition = q
    ? and(eq(mailMessages.folderId, folderId), or(
      like(mailMessages.subject, `%${q}%`),
      like(mailMessages.fromAddress, `%${q}%`),
      like(mailMessages.fromName, `%${q}%`),
      like(mailMessages.bodyText, `%${q}%`),
    ))!
    : eq(mailMessages.folderId, folderId)

  const rows = db.select().from(mailMessages)
    .where(condition)
    .orderBy(desc(mailMessages.date))
    .limit(limit).offset(offset)
    .all()
  const totalRow = db.select({ count: sql<number>`count(*)` }).from(mailMessages)
    .where(condition)
    .get()

  return c.json({ messages: rows.map(messageSummaryJson), total: totalRow?.count ?? 0 })
})

router.get('/messages/:id', (c) => {
  const user = c.get('user')
  const { id } = c.req.param()
  const owned = getOwnedMessage(user.id, id)
  if (!owned) return c.json({ error: 'Not found' }, 404)

  const attachments = db.select().from(mailAttachmentRefs).where(eq(mailAttachmentRefs.messageId, id)).all()
  return c.json(messageDetailJson(owned.message, attachments))
})

// Never mirrored locally (see Hof/ROADMAP.md's Herold entry) - opens a
// fresh IMAP connection per request and streams the one BODYSTRUCTURE
// part the stored mailAttachmentRefs row points at.
router.get('/messages/:id/attachments/:attachmentId', async (c) => {
  const user = c.get('user')
  const { id, attachmentId } = c.req.param()
  const owned = getOwnedMessage(user.id, id)
  if (!owned) return c.json({ error: 'Not found' }, 404)

  const attachment = db.select().from(mailAttachmentRefs)
    .where(eq(mailAttachmentRefs.id, attachmentId))
    .get()
  if (!attachment || attachment.messageId !== id) return c.json({ error: 'Not found' }, 404)

  try {
    const download = await openAttachmentStream(owned.account, owned.folder.name, owned.message.imapUid, attachment.partId)
    download.content.once('end', download.close)
    download.content.once('error', download.close)

    c.header('Content-Type', attachment.mimeType || 'application/octet-stream')
    c.header('Content-Disposition', `attachment; filename="${encodeURIComponent(attachment.filename)}"`)
    if (attachment.sizeBytes > 0) c.header('Content-Length', String(attachment.sizeBytes))
    return c.body(Readable.toWeb(download.content) as unknown as ReadableStream)
  } catch {
    return c.json({ error: 'Не удалось получить вложение' }, 502)
  }
})

// Writes read/unread and flagged/starred through to the real IMAP server
// before touching the local mirror row, so a failure to reach the server
// never leaves the two out of sync. A synthetic optimistic-send row (see
// POST .../messages/send - imapUid is a negative placeholder there) has
// no real server-side counterpart yet, so the write-through is skipped
// for it; the next sync pass mirrors the server's own authoritative
// flags once that row exists for real.
router.patch('/messages/:id', zValidator('json', updateFlagsSchema), async (c) => {
  const user = c.get('user')
  const { id } = c.req.param()
  const owned = getOwnedMessage(user.id, id)
  if (!owned) return c.json({ error: 'Not found' }, 404)

  const { message, folder, account } = owned
  const body = c.req.valid('json')

  if (message.imapUid > 0) {
    try {
      await setMessageFlags(account, folder.name, message.imapUid, { seen: body.flagsSeen, flagged: body.flagsFlagged })
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : 'Не удалось обновить письмо на сервере' }, 502)
    }
  }

  const updates: Partial<typeof mailMessages.$inferInsert> = {}
  if (body.flagsSeen !== undefined) updates.flagsSeen = body.flagsSeen
  if (body.flagsFlagged !== undefined) updates.flagsFlagged = body.flagsFlagged
  db.update(mailMessages).set(updates).where(eq(mailMessages.id, id)).run()

  const row = db.select().from(mailMessages).where(eq(mailMessages.id, id)).get()
  return c.json(messageSummaryJson(row!))
})

// Moves the message to the account's Trash folder (or permanently
// deletes it in place if no Trash folder has been discovered locally
// yet - see lib/imapConnection.ts's removeMessage) before removing the
// local mirror row. Deleting a message already sitting in Trash deletes
// it permanently rather than "moving" it into itself.
router.delete('/messages/:id', async (c) => {
  const user = c.get('user')
  const { id } = c.req.param()
  const owned = getOwnedMessage(user.id, id)
  if (!owned) return c.json({ error: 'Not found' }, 404)

  const { message, folder, account } = owned

  if (message.imapUid > 0) {
    const trashFolder = db.select().from(mailFolders)
      .where(and(eq(mailFolders.accountId, account.id), eq(mailFolders.specialUse, 'trash')))
      .get()
    const destination = trashFolder && trashFolder.id !== folder.id ? trashFolder.name : null
    try {
      await removeMessage(account, folder.name, message.imapUid, destination)
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : 'Не удалось удалить письмо на сервере' }, 502)
    }
  }

  db.delete(mailMessages).where(eq(mailMessages.id, id)).run()
  return c.json({ ok: true })
})

// Sends via the account's own SMTP settings, then best-effort mirrors the
// sent message into the local Sent folder (if one has been discovered by
// a prior sync pass) and best-effort IMAP-APPENDs it to the real Sent
// mailbox - see lib/mailSend.ts and lib/imapConnection.ts's appendToSent
// for why both are separately "best-effort": the send itself already
// succeeded by the time either of them runs, so neither failure is
// reported back to the caller as an error.
router.post('/accounts/:accountId/messages/send', zValidator('json', sendMessageSchema), async (c) => {
  const user = c.get('user')
  const { accountId } = c.req.param()
  const account = getOwnedAccount(user.id, accountId)
  if (!account) return c.json({ error: 'Not found' }, 404)

  const body = c.req.valid('json')
  let sent: Awaited<ReturnType<typeof sendMail>>
  try {
    sent = await sendMail(account, {
      to: body.to, cc: body.cc, bcc: body.bcc,
      subject: body.subject ?? '', bodyText: body.bodyText, inReplyTo: body.inReplyTo,
    })
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Не удалось отправить письмо' }, 502)
  }

  const sentFolder = db.select().from(mailFolders)
    .where(and(eq(mailFolders.accountId, account.id), eq(mailFolders.specialUse, 'sent')))
    .get()

  let summary: ReturnType<typeof messageSummaryJson> | null = null
  if (sentFolder) {
    const id = createId()
    const now = new Date()
    db.insert(mailMessages).values({
      id,
      folderId: sentFolder.id,
      // A synthetic, decreasing negative UID rather than a real IMAP one -
      // this row didn't come from a FETCH. The next sync pass mirrors the
      // server's own authoritative copy (with its own real, positive UID)
      // independently; the (folderId, imapUid) unique index just needs
      // *some* value guaranteed not to collide with a real one.
      imapUid: -now.getTime(),
      messageId: sent.messageId,
      subject: body.subject || null,
      fromAddress: account.fromEmail,
      fromName: account.fromName,
      toAddresses: JSON.stringify(body.to.map((address) => ({ address }))),
      date: now,
      snippet: body.bodyText.slice(0, 200),
      bodyText: body.bodyText,
      flagsSeen: true,
      flagsFlagged: false,
      flagsDeleted: false,
      hasAttachments: false,
      sizeBytes: sent.raw.byteLength,
      createdAt: now,
    }).run()
    const row = db.select().from(mailMessages).where(eq(mailMessages.id, id)).get()
    if (row) summary = messageSummaryJson(row)

    void appendToSent(account, sentFolder.name, sent.raw).catch(() => {})
  }

  return c.json({ ok: true, message: summary }, 201)
})

export { router as messagesRouter }
