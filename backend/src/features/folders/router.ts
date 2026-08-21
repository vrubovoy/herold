import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { db } from '../../db/index.js'
import { mailFolders, type MailFolder } from '../../db/schema.js'
import { requireAuth } from '../../middleware/auth.js'
import { getOwnedAccount } from '../../lib/mailOwnership.js'

const router = new Hono()
router.use('*', requireAuth)

// uidValidity/lastSeenUid are internal sync bookkeeping (see
// sync/worker.ts) - never meaningful to a client.
function folderJson(folder: MailFolder) {
  return {
    id: folder.id,
    name: folder.name,
    specialUse: folder.specialUse,
    createdAt: folder.createdAt,
  }
}

router.get('/accounts/:accountId/folders', (c) => {
  const user = c.get('user')
  const { accountId } = c.req.param()
  if (!getOwnedAccount(user.id, accountId)) return c.json({ error: 'Not found' }, 404)

  const folders = db.select().from(mailFolders)
    .where(eq(mailFolders.accountId, accountId))
    .orderBy(mailFolders.name)
    .all()
  return c.json(folders.map(folderJson))
})

export { router as foldersRouter }
