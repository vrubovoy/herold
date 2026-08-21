import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { readdirSync, readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import * as schema from '../../db/schema.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

export const sqlite = new Database(':memory:')
sqlite.pragma('foreign_keys = ON')

// Run every migration file in order (not just the first one) - the
// numeric filename prefix drizzle-kit generates already sorts correctly.
const migrationsDir = resolve(__dirname, '../../db/migrations')
const migrationFiles = readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .sort()
for (const file of migrationFiles) {
  const migrationSql = readFileSync(resolve(migrationsDir, file), 'utf-8')
  for (const stmt of migrationSql.split('--> statement-breakpoint')) {
    const s = stmt.trim()
    if (s) sqlite.exec(s)
  }
}

export const db = drizzle(sqlite, { schema })

export function cleanDb() {
  sqlite.exec('DELETE FROM users')
}
