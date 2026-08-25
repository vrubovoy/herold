import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, desc } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { db } from '../../db/index.js'
import { mailAccounts, mailFolders, type MailAccount } from '../../db/schema.js'
import { requireAuth } from '../../middleware/auth.js'
import { decryptCredential, encryptCredential } from '../../lib/credentialCrypto.js'
import { testImapConnection } from '../../lib/imapConnection.js'
import { getOwnedAccount } from '../../lib/mailOwnership.js'

const router = new Hono()
router.use('*', requireAuth)

const securitySchema = z.enum(['tls', 'starttls', 'none'])

const accountFieldsSchema = z.object({
  label: z.string().trim().min(1).max(200),
  imapHost: z.string().trim().min(1).max(255),
  imapPort: z.number().int().min(1).max(65535),
  imapSecurity: securitySchema,
  imapUsername: z.string().trim().min(1).max(255),
  imapPassword: z.string().min(1).max(1000),
  smtpHost: z.string().trim().min(1).max(255),
  smtpPort: z.number().int().min(1).max(65535),
  smtpSecurity: securitySchema,
  smtpUsername: z.string().trim().min(1).max(255),
  smtpPassword: z.string().min(1).max(1000),
  fromName: z.string().trim().min(1).max(200),
  fromEmail: z.string().trim().email().max(320),
  sentFilingMode: z.enum(['provider', 'append']).default('provider'),
})

// Every field optional - a PATCH only touches what it sends. A password
// field is only re-encrypted (and the old one replaced) when actually
// present; omitting it keeps the stored credential unchanged, so editing
// an account's label doesn't force the user to re-type its password.
const updateSchema = accountFieldsSchema.partial()

const testConnectionSchema = z.object({
  imapHost: z.string().trim().min(1).max(255),
  imapPort: z.number().int().min(1).max(65535),
  imapSecurity: securitySchema,
  imapUsername: z.string().trim().min(1).max(255),
  imapPassword: z.string().min(1).max(1000),
})
const savedTestConnectionSchema = testConnectionSchema.omit({ imapPassword: true }).partial().extend({
  imapPassword: z.string().min(1).max(1000).optional(),
})

// Never includes imap/smtpPasswordEncrypted - those are internal at
// rest, never returned by any response (see lib/credentialCrypto.ts).
function mailAccountJson(account: MailAccount) {
  return {
    id: account.id,
    label: account.label,
    imapHost: account.imapHost,
    imapPort: account.imapPort,
    imapSecurity: account.imapSecurity,
    imapUsername: account.imapUsername,
    smtpHost: account.smtpHost,
    smtpPort: account.smtpPort,
    smtpSecurity: account.smtpSecurity,
    smtpUsername: account.smtpUsername,
    fromName: account.fromName,
    fromEmail: account.fromEmail,
    sentFilingMode: account.sentFilingMode,
    syncState: account.syncState,
    lastSyncedAt: account.lastSyncedAt,
    lastError: account.lastError,
    createdAt: account.createdAt,
  }
}

router.get('/', (c) => {
  const user = c.get('user')
  const rows = db.select().from(mailAccounts)
    .where(eq(mailAccounts.userId, user.id))
    .orderBy(desc(mailAccounts.createdAt))
    .all()
  return c.json(rows.map(mailAccountJson))
})

// Registered ahead of GET/PATCH/DELETE /:id so "test-connection" is
// never treated as an :id value.
router.post('/test-connection', zValidator('json', testConnectionSchema), async (c) => {
  const { imapHost, imapPort, imapSecurity, imapUsername, imapPassword } = c.req.valid('json')
  const result = await testImapConnection({
    host: imapHost, port: imapPort, security: imapSecurity,
    username: imapUsername, password: imapPassword,
  })
  return c.json(result)
})

// Re-tests an already-saved account's stored IMAP credential, for the
// edit form's "Test connection" button when the user hasn't retyped a
// new password - the frontend never has that plaintext to send back for
// a POST /accounts/test-connection call, and shouldn't; this decrypts
// it server-side instead. Registered ahead of the plain GET/PATCH/DELETE
// /:id routes for the same "test-connection isn't an :id" reason as above.
router.post('/:id/test-connection', zValidator('json', savedTestConnectionSchema), async (c) => {
  const user = c.get('user')
  const { id } = c.req.param()
  const account = getOwnedAccount(user.id, id)
  if (!account) return c.json({ error: 'Not found' }, 404)

  const overrides = c.req.valid('json')
  const result = await testImapConnection({
    host: overrides.imapHost ?? account.imapHost,
    port: overrides.imapPort ?? account.imapPort,
    security: overrides.imapSecurity ?? account.imapSecurity,
    username: overrides.imapUsername ?? account.imapUsername,
    password: overrides.imapPassword ?? decryptCredential(account.imapPasswordEncrypted),
  })
  return c.json(result)
})

router.get('/:id', (c) => {
  const user = c.get('user')
  const { id } = c.req.param()
  const account = getOwnedAccount(user.id, id)
  if (!account) return c.json({ error: 'Not found' }, 404)
  return c.json(mailAccountJson(account))
})

router.post('/', zValidator('json', accountFieldsSchema), (c) => {
  const user = c.get('user')
  const body = c.req.valid('json')

  const account: MailAccount = {
    id: createId(),
    userId: user.id,
    label: body.label,
    imapHost: body.imapHost,
    imapPort: body.imapPort,
    imapSecurity: body.imapSecurity,
    imapUsername: body.imapUsername,
    imapPasswordEncrypted: encryptCredential(body.imapPassword),
    smtpHost: body.smtpHost,
    smtpPort: body.smtpPort,
    smtpSecurity: body.smtpSecurity,
    smtpUsername: body.smtpUsername,
    smtpPasswordEncrypted: encryptCredential(body.smtpPassword),
    fromName: body.fromName,
    fromEmail: body.fromEmail,
    sentFilingMode: body.sentFilingMode,
    syncState: 'pending',
    lastSyncedAt: null,
    lastError: null,
    createdAt: new Date(),
  }
  db.insert(mailAccounts).values(account).run()
  return c.json(mailAccountJson(account), 201)
})

router.patch('/:id', zValidator('json', updateSchema), (c) => {
  const user = c.get('user')
  const { id } = c.req.param()
  const body = c.req.valid('json')

  const account = getOwnedAccount(user.id, id)
  if (!account) return c.json({ error: 'Not found' }, 404)

  const updates: Partial<typeof mailAccounts.$inferInsert> = {}
  if (body.label !== undefined) updates.label = body.label
  if (body.imapHost !== undefined) updates.imapHost = body.imapHost
  if (body.imapPort !== undefined) updates.imapPort = body.imapPort
  if (body.imapSecurity !== undefined) updates.imapSecurity = body.imapSecurity
  if (body.imapUsername !== undefined) updates.imapUsername = body.imapUsername
  if (body.imapPassword !== undefined) updates.imapPasswordEncrypted = encryptCredential(body.imapPassword)
  if (body.smtpHost !== undefined) updates.smtpHost = body.smtpHost
  if (body.smtpPort !== undefined) updates.smtpPort = body.smtpPort
  if (body.smtpSecurity !== undefined) updates.smtpSecurity = body.smtpSecurity
  if (body.smtpUsername !== undefined) updates.smtpUsername = body.smtpUsername
  if (body.smtpPassword !== undefined) updates.smtpPasswordEncrypted = encryptCredential(body.smtpPassword)
  if (body.fromName !== undefined) updates.fromName = body.fromName
  if (body.fromEmail !== undefined) updates.fromEmail = body.fromEmail
  if (body.sentFilingMode !== undefined) updates.sentFilingMode = body.sentFilingMode

  const imapChanged = body.imapHost !== undefined && body.imapHost !== account.imapHost
    || body.imapPort !== undefined && body.imapPort !== account.imapPort
    || body.imapSecurity !== undefined && body.imapSecurity !== account.imapSecurity
    || body.imapUsername !== undefined && body.imapUsername !== account.imapUsername
    || body.imapPassword !== undefined
  db.transaction((tx) => {
    if (imapChanged) {
      tx.delete(mailFolders).where(eq(mailFolders.accountId, id)).run()
      updates.syncState = 'pending'
      updates.lastSyncedAt = null
      updates.lastError = null
    }
    tx.update(mailAccounts).set(updates).where(eq(mailAccounts.id, id)).run()
  })
  return c.json(mailAccountJson(getOwnedAccount(user.id, id)!))
})

router.delete('/:id', (c) => {
  const user = c.get('user')
  const { id } = c.req.param()
  if (!getOwnedAccount(user.id, id)) return c.json({ error: 'Not found' }, 404)
  db.delete(mailAccounts).where(eq(mailAccounts.id, id)).run()
  return c.json({ ok: true })
})

export { router as accountsRouter }
