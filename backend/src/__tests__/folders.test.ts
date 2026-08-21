import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../db/index.js', async () => await import('./helpers/db.js'))
vi.mock('../middleware/auth.js', async () => await import('./helpers/auth-mock.js'))

import { sqlite, cleanDb } from './helpers/db.js'
import { createTestApp } from './helpers/setup.js'

const app = createTestApp()

const H1 = { Authorization: 'Bearer test-token' }

const get = (path: string, headers?: Record<string, string>) =>
  headers ? app.request(path, { headers }) : app.request(path)

function insertAccount(id: string, userId: string) {
  const now = Date.now()
  sqlite
    .prepare(
      `INSERT INTO mail_accounts (
        id, user_id, label, imap_host, imap_port, imap_security, imap_username, imap_password_encrypted,
        smtp_host, smtp_port, smtp_security, smtp_username, smtp_password_encrypted,
        from_name, from_email, sync_state, last_synced_at, last_error, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id, userId, 'Test account', 'imap.example.com', 993, 'tls', 'me@example.com', 'encrypted-imap-pw',
      'smtp.example.com', 465, 'tls', 'me@example.com', 'encrypted-smtp-pw',
      'Me', 'me@example.com', 'ok', null, null, now,
    )
}

// Ensures the referenced user row exists (mail_accounts.user_id has an FK
// to users.id) - the auth-mock middleware normally auto-provisions this on
// first request, but these direct-insert helpers run before any request.
function ensureUser(id: string, email: string) {
  const existing = sqlite.prepare('SELECT id FROM users WHERE id = ?').get(id)
  if (!existing) {
    sqlite.prepare('INSERT INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?)').run(id, email, email, Date.now())
  }
}

function insertFolder(overrides: Partial<{
  id: string; accountId: string; name: string; specialUse: string | null
  uidValidity: number; lastSeenUid: number; createdAt: number
}> = {}) {
  const folder = {
    id: 'folder-1',
    accountId: 'acc-1',
    name: 'INBOX',
    specialUse: 'inbox' as string | null,
    uidValidity: 1001,
    lastSeenUid: 42,
    createdAt: Date.now(),
    ...overrides,
  }
  sqlite
    .prepare(
      `INSERT INTO mail_folders (id, account_id, name, special_use, uid_validity, last_seen_uid, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(folder.id, folder.accountId, folder.name, folder.specialUse, folder.uidValidity, folder.lastSeenUid, folder.createdAt)
  return folder
}

beforeEach(() => {
  cleanDb()
  ensureUser('user-1', 'test@example.com')
  ensureUser('user-2', 'test2@example.com')
})

describe('GET /accounts/:accountId/folders', () => {
  it('returns 401 without auth', async () => {
    const res = await get('/accounts/acc-1/folders')
    expect(res.status).toBe(401)
  })

  it('returns 404 for a nonexistent accountId', async () => {
    const res = await get('/accounts/does-not-exist/folders', H1)
    expect(res.status).toBe(404)
  })

  it('returns 404 for an accountId that belongs to a different user', async () => {
    insertAccount('acc-other', 'user-2')
    const res = await get('/accounts/acc-other/folders', H1)
    expect(res.status).toBe(404)
  })

  it('returns 200 with the folders belonging to that account, shaped { id, name, specialUse, createdAt }, without internal sync bookkeeping fields', async () => {
    insertAccount('acc-1', 'user-1')
    const folder = insertFolder({ id: 'folder-1', accountId: 'acc-1', name: 'INBOX', specialUse: 'inbox' })

    const res = await get('/accounts/acc-1/folders', H1)
    expect(res.status).toBe(200)
    const body = (await res.json()) as Array<Record<string, unknown>>
    expect(body).toHaveLength(1)
    expect(body[0]).toMatchObject({ id: folder.id, name: 'INBOX', specialUse: 'inbox' })
    expect(body[0]).toHaveProperty('createdAt')

    const keys = Object.keys(body[0])
    expect(keys).not.toContain('uidValidity')
    expect(keys).not.toContain('lastSeenUid')
    expect(keys).not.toContain('uid_validity')
    expect(keys).not.toContain('last_seen_uid')
    expect(keys).not.toContain('accountId')
  })

  it('returns multiple folders belonging to the account', async () => {
    insertAccount('acc-1', 'user-1')
    insertFolder({ id: 'folder-inbox', accountId: 'acc-1', name: 'INBOX', specialUse: 'inbox' })
    insertFolder({ id: 'folder-sent', accountId: 'acc-1', name: 'Sent', specialUse: 'sent' })
    insertFolder({ id: 'folder-plain', accountId: 'acc-1', name: 'Archive', specialUse: null })

    const res = await get('/accounts/acc-1/folders', H1)
    expect(res.status).toBe(200)
    const body = (await res.json()) as Array<Record<string, unknown>>
    expect(body).toHaveLength(3)
    expect(body.map((f) => f.id).sort()).toEqual(['folder-inbox', 'folder-plain', 'folder-sent'])
  })

  it('does not include folders belonging to a different account, even one owned by the same user', async () => {
    insertAccount('acc-1', 'user-1')
    insertAccount('acc-2', 'user-1')
    insertFolder({ id: 'folder-1', accountId: 'acc-1', name: 'INBOX', specialUse: 'inbox' })
    insertFolder({ id: 'folder-2', accountId: 'acc-2', name: 'INBOX', specialUse: 'inbox' })

    const res = await get('/accounts/acc-1/folders', H1)
    expect(res.status).toBe(200)
    const body = (await res.json()) as Array<Record<string, unknown>>
    expect(body).toHaveLength(1)
    expect(body[0].id).toBe('folder-1')
  })
})
