import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core'

// Every timestamp column here uses `mode: 'timestamp_ms'`, not the more
// common `mode: 'timestamp'` - the latter stores epoch *seconds*
// (Math.floor(ms / 1000)) and truncates sub-second precision on every
// round-trip through the DB. Both modes map to the same SQL `integer`
// column type - this is a pure application-level interpretation choice.

// ── Users (mirrored from Schlüssel via JWT) ───────────────────────
// We store only the user id from the JWT - no passwords here.
export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull(),
  name: text('name').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
})

export const userTombstones = sqliteTable('user_tombstones', {
  userId: text('user_id').primaryKey(),
  deletionJobId: text('deletion_job_id').notNull().unique(),
  deletedAt: integer('deleted_at', { mode: 'timestamp_ms' }).notNull(),
})

export const deletionJobs = sqliteTable('deletion_jobs', {
  jobId: text('job_id').primaryKey(),
  userId: text('user_id').notNull(),
  tokenId: text('token_id').notNull(),
  completedAt: integer('completed_at', { mode: 'timestamp_ms' }).notNull(),
})

export type User = typeof users.$inferSelect

// ── Mail accounts ───────────────────────────────────────────────────
// One row per external IMAP/SMTP account a user has connected - a user
// may have several. imap/smtpPasswordEncrypted are never returned by
// any API response (see features/accounts/router.ts's own accountJson);
// decrypted only where actually needed (test-connection now, the sync
// worker and send route in later stages) via lib/credentialCrypto.ts.
//
// SMTP fields are always fully populated, even when the user ticked a
// "same as IMAP" checkbox in the form - that's resolved client-side at
// submit time, not modeled as null-meaning-"reuse the IMAP fields"
// here. Keeping both sides independently complete means every later
// consumer (the sync worker, the send route) reads one obvious set of
// columns instead of having to resolve a fallback every time.
export const mailAccounts = sqliteTable('mail_accounts', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  label: text('label').notNull(),
  imapHost: text('imap_host').notNull(),
  imapPort: integer('imap_port').notNull(),
  imapSecurity: text('imap_security', { enum: ['tls', 'starttls', 'none'] }).notNull(),
  imapUsername: text('imap_username').notNull(),
  imapPasswordEncrypted: text('imap_password_encrypted').notNull(),
  smtpHost: text('smtp_host').notNull(),
  smtpPort: integer('smtp_port').notNull(),
  smtpSecurity: text('smtp_security', { enum: ['tls', 'starttls', 'none'] }).notNull(),
  smtpUsername: text('smtp_username').notNull(),
  smtpPasswordEncrypted: text('smtp_password_encrypted').notNull(),
  fromName: text('from_name').notNull(),
  fromEmail: text('from_email').notNull(),
  sentFilingMode: text('sent_filing_mode', { enum: ['provider', 'append'] }).notNull().default('provider'),
  // Updated by the sync worker (a later stage) - 'pending' until the
  // first sync pass ever runs, then reflects the outcome of the most
  // recent one, independently per account (one account's failure never
  // blocks another's sync).
  syncState: text('sync_state', { enum: ['pending', 'ok', 'error'] }).notNull().default('pending'),
  lastSyncedAt: integer('last_synced_at', { mode: 'timestamp_ms' }),
  lastError: text('last_error'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
}, (table) => [
  index('mail_accounts_user_idx').on(table.userId),
])

export type MailAccount = typeof mailAccounts.$inferSelect

// ── Mail folders ─────────────────────────────────────────────────────
// Mirrors an account's IMAP folder list. uidValidity + lastSeenUid are
// the standard IMAP bookkeeping pair for incremental sync (see
// sync/worker.ts) - a changed uidValidity means the server reset UID
// numbering for this folder, and every mirrored message in it is
// meaningless and gets wiped before re-syncing from scratch.
export const mailFolders = sqliteTable('mail_folders', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull().references(() => mailAccounts.id, { onDelete: 'cascade' }),
  // The IMAP mailbox path as the server reports it (e.g. "INBOX",
  // "Sent Mail") - matched against on every sync pass to find this
  // folder's existing row again. A folder renamed on the server is
  // therefore currently seen as a new folder, not a rename of this one;
  // a known limitation, not handled in this stage.
  name: text('name').notNull(),
  specialUse: text('special_use', { enum: ['inbox', 'sent', 'drafts', 'trash', 'junk'] }),
  uidValidity: integer('uid_validity').notNull(),
  lastSeenUid: integer('last_seen_uid').notNull().default(0),
  reconcileCursor: integer('reconcile_cursor').notNull().default(0),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
}, (table) => [
  index('mail_folders_account_idx').on(table.accountId),
  uniqueIndex('mail_folders_account_name_idx').on(table.accountId, table.name),
])

export type MailFolder = typeof mailFolders.$inferSelect

// ── Mail messages ────────────────────────────────────────────────────
// Mirrors headers + plain-text body only (see Hof/ROADMAP.md's Herold
// entry for why) - never raw HTML, never attachment bytes (those stay
// on the IMAP server, streamed on demand - see mailAttachmentRefs).
// toAddresses is a JSON-encoded MessageAddressObject[] (no native array
// column type in SQLite); parsed back out in features/messages/router.ts.
export const mailMessages = sqliteTable('mail_messages', {
  id: text('id').primaryKey(),
  folderId: text('folder_id').notNull().references(() => mailFolders.id, { onDelete: 'cascade' }),
  imapUid: integer('imap_uid').notNull(),
  // RFC822 Message-ID header - reserved for threading/dedupe in a later
  // stage, not used yet.
  messageId: text('message_id'),
  subject: text('subject'),
  fromAddress: text('from_address'),
  fromName: text('from_name'),
  toAddresses: text('to_addresses').notNull().default('[]'),
  date: integer('date', { mode: 'timestamp_ms' }),
  snippet: text('snippet').notNull().default(''),
  bodyText: text('body_text').notNull().default(''),
  flagsSeen: integer('flags_seen', { mode: 'boolean' }).notNull().default(false),
  flagsFlagged: integer('flags_flagged', { mode: 'boolean' }).notNull().default(false),
  flagsDeleted: integer('flags_deleted', { mode: 'boolean' }).notNull().default(false),
  hasAttachments: integer('has_attachments', { mode: 'boolean' }).notNull().default(false),
  sizeBytes: integer('size_bytes').notNull().default(0),
  reconciliationState: text('reconciliation_state', { enum: ['pending', 'synced'] }).notNull().default('synced'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
}, (table) => [
  index('mail_messages_folder_idx').on(table.folderId),
  // Guards against double-mirroring the same message if a sync pass is
  // ever retried over a UID range it already inserted.
  uniqueIndex('mail_messages_folder_uid_idx').on(table.folderId, table.imapUid),
  index('mail_messages_message_id_idx').on(table.folderId, table.messageId),
])

export type MailMessage = typeof mailMessages.$inferSelect

// ── Mail attachment references ──────────────────────────────────────
// Metadata only, never bytes - partId is the IMAP BODYSTRUCTURE part
// number (see MessageStructureObject.part in imapflow's own types),
// used internally to re-fetch this exact part live from IMAP on demand
// (GET /messages/:id/attachments/:attachmentId) - never exposed to the
// client directly; the client only ever sees this row's own `id`.
export const mailAttachmentRefs = sqliteTable('mail_attachment_refs', {
  id: text('id').primaryKey(),
  messageId: text('message_id').notNull().references(() => mailMessages.id, { onDelete: 'cascade' }),
  filename: text('filename').notNull(),
  mimeType: text('mime_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  partId: text('part_id').notNull(),
}, (table) => [
  index('mail_attachment_refs_message_idx').on(table.messageId),
])

export type MailAttachmentRef = typeof mailAttachmentRefs.$inferSelect
