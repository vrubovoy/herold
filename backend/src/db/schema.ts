import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core'

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

// Mail folder/message tables land in a later stage - see
// Hof/ROADMAP.md's Herold entry for the staged rollout.
