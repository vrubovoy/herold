import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from '../../db/schema.js'
import { migrateDatabase } from '../../db/migrate.js'

export const sqlite = new Database(':memory:')
sqlite.pragma('foreign_keys = ON')

// The real migrateDatabase() (not hand-rolled raw-SQL execution) so it
// also populates __drizzle_migrations - assertSchemaCurrent() checks that
// table, and /ready now calls it for real via helpers/setup.ts's
// reconstructed route.
migrateDatabase(drizzle(sqlite))

export const db = drizzle(sqlite, { schema })

export function cleanDb() {
  // Explicit, children-first, even though every FK here cascades from
  // `users` - relying on cascade alone would leave this silently
  // dependent on foreign_keys actually being ON for whichever
  // connection runs it, which is easy to lose track of in test setup.
  sqlite.exec('DELETE FROM mail_attachment_refs')
  sqlite.exec('DELETE FROM mail_messages')
  sqlite.exec('DELETE FROM mail_folders')
  sqlite.exec('DELETE FROM mail_accounts')
  sqlite.exec('DELETE FROM users')
}
