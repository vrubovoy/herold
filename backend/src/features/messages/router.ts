import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { Readable } from 'node:stream'
import { eq, desc, sql } from 'drizzle-orm'
import { db } from '../../db/index.js'
import { mailMessages, mailAttachmentRefs, type MailMessage, type MailAttachmentRef } from '../../db/schema.js'
import { requireAuth } from '../../middleware/auth.js'
import { getOwnedFolder, getOwnedMessage } from '../../lib/mailOwnership.js'
import { openAttachmentStream } from '../../lib/imapConnection.js'

const router = new Hono()
router.use('*', requireAuth)

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
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

  const { limit, offset } = c.req.valid('query')
  const rows = db.select().from(mailMessages)
    .where(eq(mailMessages.folderId, folderId))
    .orderBy(desc(mailMessages.date))
    .limit(limit).offset(offset)
    .all()
  const totalRow = db.select({ count: sql<number>`count(*)` }).from(mailMessages)
    .where(eq(mailMessages.folderId, folderId))
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

export { router as messagesRouter }
