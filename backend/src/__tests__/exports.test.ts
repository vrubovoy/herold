import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../db/index.js', async () => await import('./helpers/db.js'))
vi.mock('../middleware/auth.js', async () => await import('./helpers/auth-mock.js'))

import { sqlite, cleanDb } from './helpers/db.js'
import { createTestApp } from './helpers/setup.js'
import { encryptCredential } from '../lib/credentialCrypto.js'

const app = createTestApp()

const H1 = { Authorization: 'Bearer test-token' }
const H2 = { Authorization: 'Bearer user2-token' }
const DELEGATION_1 = { Authorization: 'Bearer herold-export-delegation-token' }
const DELEGATION_2 = { Authorization: 'Bearer herold-export-user2-delegation-token' }

const get = (path: string, headers?: Record<string, string>) =>
  headers ? app.request(path, { headers }) : app.request(path)

function ensureUser(id: string, email: string) {
  const existing = sqlite.prepare('SELECT id FROM users WHERE id = ?').get(id)
  if (!existing) {
    sqlite.prepare('INSERT INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?)').run(id, email, email, Date.now())
  }
}

function insertAccount(overrides: Partial<{
  id: string; userId: string; label: string; imapHost: string; smtpHost: string; fromEmail: string; syncState: string
}> = {}) {
  const account = {
    id: 'acc-1', userId: 'user-1', label: 'Test account',
    imapHost: 'imap.example.com', smtpHost: 'smtp.example.com', fromEmail: 'me@example.com',
    syncState: 'ok',
    ...overrides,
  }
  sqlite
    .prepare(
      `INSERT INTO mail_accounts (
        id, user_id, label, imap_host, imap_port, imap_security, imap_username, imap_password_encrypted,
        smtp_host, smtp_port, smtp_security, smtp_username, smtp_password_encrypted,
        from_name, from_email, sync_state, last_synced_at, last_error, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      account.id, account.userId, account.label, account.imapHost, 993, 'tls', 'me@example.com', encryptCredential('fake-imap-password'),
      account.smtpHost, 465, 'tls', 'me@example.com', encryptCredential('fake-smtp-password'),
      'Me', account.fromEmail, account.syncState, null, null, Date.now(),
    )
  return account
}

function insertFolder(overrides: Partial<{
  id: string; accountId: string; name: string; specialUse: string | null
}> = {}) {
  const folder = {
    id: 'folder-1', accountId: 'acc-1', name: 'INBOX', specialUse: 'inbox' as string | null,
    ...overrides,
  }
  sqlite
    .prepare(
      `INSERT INTO mail_folders (id, account_id, name, special_use, uid_validity, last_seen_uid, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(folder.id, folder.accountId, folder.name, folder.specialUse, 1001, 42, Date.now())
  return folder
}

function insertMessage(overrides: Partial<{ id: string; folderId: string; imapUid: number }> = {}) {
  const msg = { id: 'msg-1', folderId: 'folder-1', imapUid: 1, ...overrides }
  sqlite
    .prepare(
      `INSERT INTO mail_messages (
        id, folder_id, imap_uid, message_id, subject, from_address, from_name, to_addresses,
        date, snippet, body_text, flags_seen, flags_flagged, flags_deleted, has_attachments,
        size_bytes, created_at
      ) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      msg.id, msg.folderId, msg.imapUid, 'Subject', 'someone@example.com', 'Someone', '[]',
      Date.now(), 'snippet', 'body text', 0, 0, 0, 0,
      1234, Date.now(),
    )
  return msg
}

interface ExportDTO {
  version: string
  service: string
  exportedAt: string
  data: {
    accounts: Record<string, unknown>[]
    folders: Record<string, unknown>[]
  }
}

beforeEach(() => {
  cleanDb()
  ensureUser('user-1', 'test@example.com')
  ensureUser('user-2', 'test2@example.com')
})

describe('GET /exports/me', () => {
  it('returns 401 without any Authorization header', async () => {
    const res = await app.request('/exports/me')
    expect(res.status).toBe(401)
  })

  it('returns 401 with an invalid/unrecognized bearer token', async () => {
    const res = await get('/exports/me', { Authorization: 'Bearer garbage-token' })
    expect(res.status).toBe(401)
  })

  it('returns 200 with the correct envelope shape for a normal access token', async () => {
    const res = await get('/exports/me', H1)
    expect(res.status).toBe(200)
    const body = (await res.json()) as ExportDTO
    expect(body.version).toBe('1')
    expect(body.service).toBe('herold')
    expect(typeof body.exportedAt).toBe('string')
    expect(Number.isNaN(Date.parse(body.exportedAt))).toBe(false)
    expect(Array.isArray(body.data.accounts)).toBe(true)
    expect(Array.isArray(body.data.folders)).toBe(true)
  })

  it('includes the expected account fields and never leaks credential fields', async () => {
    insertAccount({ id: 'acc-1', userId: 'user-1', label: 'My Mailbox', imapHost: 'imap.example.com', smtpHost: 'smtp.example.com', fromEmail: 'me@example.com', syncState: 'ok' })

    const res = await get('/exports/me', H1)
    expect(res.status).toBe(200)
    const body = (await res.json()) as ExportDTO
    expect(body.data.accounts).toHaveLength(1)
    const acc = body.data.accounts[0]!
    expect(acc).toMatchObject({
      id: 'acc-1',
      label: 'My Mailbox',
      imapHost: 'imap.example.com',
      smtpHost: 'smtp.example.com',
      fromEmail: 'me@example.com',
      syncState: 'ok',
    })
    expect(acc).toHaveProperty('createdAt')

    const json = JSON.stringify(body)
    expect(json).not.toContain('imapUsername')
    expect(json).not.toContain('imapPasswordEncrypted')
    expect(json).not.toContain('smtpUsername')
    expect(json).not.toContain('smtpPasswordEncrypted')
    expect(json).not.toContain('imap_username')
    expect(json).not.toContain('imap_password_encrypted')
    expect(json).not.toContain('smtp_username')
    expect(json).not.toContain('smtp_password_encrypted')
    expect(json).not.toContain('fake-imap-password')
    expect(json).not.toContain('fake-smtp-password')
    for (const key of Object.keys(acc)) {
      expect(key.toLowerCase()).not.toContain('password')
      expect(key.toLowerCase()).not.toContain('username')
    }
  })

  it('includes folder entries with accountId and an accurate messageCount', async () => {
    insertAccount({ id: 'acc-1', userId: 'user-1' })
    insertFolder({ id: 'folder-full', accountId: 'acc-1', name: 'INBOX', specialUse: 'inbox' })
    insertFolder({ id: 'folder-empty', accountId: 'acc-1', name: 'Archive', specialUse: null })
    insertMessage({ id: 'msg-1', folderId: 'folder-full', imapUid: 1 })
    insertMessage({ id: 'msg-2', folderId: 'folder-full', imapUid: 2 })
    insertMessage({ id: 'msg-3', folderId: 'folder-full', imapUid: 3 })

    const res = await get('/exports/me', H1)
    expect(res.status).toBe(200)
    const body = (await res.json()) as ExportDTO
    expect(body.data.folders).toHaveLength(2)

    const full = body.data.folders.find((f) => f['id'] === 'folder-full')
    const empty = body.data.folders.find((f) => f['id'] === 'folder-empty')
    expect(full).toMatchObject({ id: 'folder-full', accountId: 'acc-1', name: 'INBOX', specialUse: 'inbox', messageCount: 3 })
    expect(empty).toMatchObject({ id: 'folder-empty', accountId: 'acc-1', name: 'Archive', messageCount: 0 })
    expect(full).toHaveProperty('createdAt')
  })

  it('scopes accounts/folders to the authenticated user only (cross-user isolation)', async () => {
    insertAccount({ id: 'acc-1', userId: 'user-1', label: 'Mine' })
    insertFolder({ id: 'folder-1', accountId: 'acc-1', name: 'INBOX' })
    insertAccount({ id: 'acc-2', userId: 'user-2', label: 'Theirs' })
    insertFolder({ id: 'folder-2', accountId: 'acc-2', name: 'INBOX' })

    const res = await get('/exports/me', H1)
    expect(res.status).toBe(200)
    const body = (await res.json()) as ExportDTO
    expect(body.data.accounts.map((a) => a['id'])).toEqual(['acc-1'])
    expect(body.data.folders.map((f) => f['id'])).toEqual(['folder-1'])
  })

  it('the other user only sees their own data', async () => {
    insertAccount({ id: 'acc-1', userId: 'user-1', label: 'Mine' })
    insertFolder({ id: 'folder-1', accountId: 'acc-1', name: 'INBOX' })
    insertAccount({ id: 'acc-2', userId: 'user-2', label: 'Theirs' })
    insertFolder({ id: 'folder-2', accountId: 'acc-2', name: 'INBOX' })

    const res = await get('/exports/me', H2)
    expect(res.status).toBe(200)
    const body = (await res.json()) as ExportDTO
    expect(body.data.accounts.map((a) => a['id'])).toEqual(['acc-2'])
    expect(body.data.folders.map((f) => f['id'])).toEqual(['folder-2'])
  })

  it('a user-1 delegation token returns the same data a normal user-1 access token would', async () => {
    insertAccount({ id: 'acc-1', userId: 'user-1', label: 'Mine' })
    insertFolder({ id: 'folder-1', accountId: 'acc-1', name: 'INBOX' })
    insertMessage({ id: 'msg-1', folderId: 'folder-1', imapUid: 1 })

    const normalRes = await get('/exports/me', H1)
    const normalBody = (await normalRes.json()) as ExportDTO

    const delegatedRes = await get('/exports/me', DELEGATION_1)
    expect(delegatedRes.status).toBe(200)
    const delegatedBody = (await delegatedRes.json()) as ExportDTO

    expect(delegatedBody.data.accounts).toEqual(normalBody.data.accounts)
    expect(delegatedBody.data.folders).toEqual(normalBody.data.folders)
  })

  it('a user-2 delegation token only sees user-2 data', async () => {
    insertAccount({ id: 'acc-1', userId: 'user-1', label: 'Mine' })
    insertFolder({ id: 'folder-1', accountId: 'acc-1', name: 'INBOX' })
    insertAccount({ id: 'acc-2', userId: 'user-2', label: 'Theirs' })
    insertFolder({ id: 'folder-2', accountId: 'acc-2', name: 'INBOX' })

    const res = await get('/exports/me', DELEGATION_2)
    expect(res.status).toBe(200)
    const body = (await res.json()) as ExportDTO
    expect(body.data.accounts.map((a) => a['id'])).toEqual(['acc-2'])
    expect(body.data.folders.map((f) => f['id'])).toEqual(['folder-2'])
  })

  it('returns empty arrays for a user with no accounts/folders yet', async () => {
    const res = await get('/exports/me', H1)
    expect(res.status).toBe(200)
    const body = (await res.json()) as ExportDTO
    expect(body.data.accounts).toEqual([])
    expect(body.data.folders).toEqual([])
  })
})
