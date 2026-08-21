import { Hono } from 'hono'
import { eq, sql } from 'drizzle-orm'
import { exportEnvelopeSchema, type ExportAuthEnv } from '@zudar107/schloss-server-kit'
import { db } from '../../db/index.js'
import { mailAccounts, mailFolders, mailMessages, type MailAccount, type MailFolder } from '../../db/schema.js'
import { requireExportAuth } from '../../middleware/auth.js'

// Metadata only - account labels/hosts, folder names, message counts.
// Never credentials (see credentialCrypto.ts) and never message content
// (subjects, bodies, addresses) - this is an inventory of what Herold is
// managing on the user's behalf, not a mail export.
function exportAccount(account: MailAccount) {
  return {
    id: account.id,
    label: account.label,
    imapHost: account.imapHost,
    smtpHost: account.smtpHost,
    fromEmail: account.fromEmail,
    syncState: account.syncState,
    createdAt: account.createdAt.toISOString(),
  }
}

function exportFolder(folder: MailFolder, messageCount: number) {
  return {
    id: folder.id,
    accountId: folder.accountId,
    name: folder.name,
    specialUse: folder.specialUse,
    messageCount,
    createdAt: folder.createdAt.toISOString(),
  }
}

const router = new Hono<ExportAuthEnv>()

router.get('/me', requireExportAuth, (c) => {
  c.header('Cache-Control', 'private, no-store')
  c.header('Pragma', 'no-cache')
  c.header('X-Content-Type-Options', 'nosniff')

  const principal = c.get('exportPrincipal')
  const ownerUserId = principal.sub

  const accountRows = db.select().from(mailAccounts).where(eq(mailAccounts.userId, ownerUserId)).all()
  const folderRows = db.select({
    folder: mailFolders,
    messageCount: sql<number>`count(${mailMessages.id})`,
  })
    .from(mailFolders)
    .innerJoin(mailAccounts, eq(mailFolders.accountId, mailAccounts.id))
    .leftJoin(mailMessages, eq(mailMessages.folderId, mailFolders.id))
    .where(eq(mailAccounts.userId, ownerUserId))
    .groupBy(mailFolders.id)
    .all()

  return c.json(exportEnvelopeSchema.parse({
    version: '1',
    service: 'herold',
    exportedAt: new Date().toISOString(),
    data: {
      accounts: accountRows.map(exportAccount),
      folders: folderRows.map((row) => exportFolder(row.folder, row.messageCount)),
    },
  }))
})

export { router as exportsRouter }
