import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Readable } from 'node:stream'

vi.mock('../db/index.js', async () => await import('./helpers/db.js'))
vi.mock('../middleware/auth.js', async () => await import('./helpers/auth-mock.js'))

// Same vi.hoisted + vi.mock('imapflow', ...) pattern accounts.test.ts uses,
// extended with getMailboxLock/download/logout for the attachment-streaming
// route (GET /messages/:id/attachments/:attachmentId).
const {
  connectMock, logoutMock, closeMock, getMailboxLockMock, downloadMock, releaseMock, ImapFlowMock,
} = vi.hoisted(() => {
  const connectMock = vi.fn(async () => undefined)
  const logoutMock = vi.fn(async () => undefined)
  const closeMock = vi.fn(async () => undefined)
  const releaseMock = vi.fn()
  const getMailboxLockMock = vi.fn(async () => ({ release: releaseMock }))
  const downloadMock = vi.fn(async () => ({
    meta: { expectedSize: 14, contentType: 'application/pdf' },
    content: Readable.from(Buffer.from('fake pdf bytes')),
  }))
  const ImapFlowMock = vi.fn().mockImplementation(function (this: unknown) {
    Object.assign(this as object, {
      connect: connectMock,
      logout: logoutMock,
      close: closeMock,
      getMailboxLock: getMailboxLockMock,
      download: downloadMock,
    })
  })
  return { connectMock, logoutMock, closeMock, getMailboxLockMock, downloadMock, releaseMock, ImapFlowMock }
})
vi.mock('imapflow', () => ({ ImapFlow: ImapFlowMock }))

import { sqlite, cleanDb } from './helpers/db.js'
import { createTestApp } from './helpers/setup.js'
import { encryptCredential } from '../lib/credentialCrypto.js'

const app = createTestApp()

const H1 = { Authorization: 'Bearer test-token' }

const get = (path: string, headers?: Record<string, string>) =>
  headers ? app.request(path, { headers }) : app.request(path)

function ensureUser(id: string, email: string) {
  const existing = sqlite.prepare('SELECT id FROM users WHERE id = ?').get(id)
  if (!existing) {
    sqlite.prepare('INSERT INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?)').run(id, email, email, Date.now())
  }
}

function insertAccount(overrides: Partial<{ id: string; userId: string; imapUsername: string; imapHost: string }> = {}) {
  const account = {
    id: 'acc-1', userId: 'user-1', imapHost: 'imap.example.com', imapUsername: 'me@example.com',
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
      account.id, account.userId, 'Test account', account.imapHost, 993, 'tls', account.imapUsername, encryptCredential('fake-imap-password'),
      'smtp.example.com', 465, 'tls', account.imapUsername, encryptCredential('fake-smtp-password'),
      'Me', 'me@example.com', 'ok', null, null, Date.now(),
    )
  return account
}

function insertFolder(overrides: Partial<{ id: string; accountId: string; name: string }> = {}) {
  const folder = { id: 'folder-1', accountId: 'acc-1', name: 'INBOX', ...overrides }
  sqlite
    .prepare(
      `INSERT INTO mail_folders (id, account_id, name, special_use, uid_validity, last_seen_uid, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(folder.id, folder.accountId, folder.name, 'inbox', 1001, 42, Date.now())
  return folder
}

interface MessageOverrides {
  id?: string
  folderId?: string
  imapUid?: number
  messageId?: string | null
  subject?: string | null
  fromAddress?: string | null
  fromName?: string | null
  toAddresses?: string
  date?: number | null
  snippet?: string
  bodyText?: string
  flagsSeen?: number
  flagsFlagged?: number
  flagsDeleted?: number
  hasAttachments?: number
  sizeBytes?: number
  createdAt?: number
}

function insertMessage(overrides: MessageOverrides = {}) {
  const msg = {
    id: 'msg-1',
    folderId: 'folder-1',
    imapUid: 100,
    messageId: '<abc@example.com>',
    subject: 'Hello there',
    fromAddress: 'alice@example.com',
    fromName: 'Alice',
    toAddresses: JSON.stringify([{ name: 'Bob', address: 'bob@example.com' }]),
    date: Date.now(),
    snippet: 'Hello there, this is a snippet',
    bodyText: 'Hello there, this is the full body text.',
    flagsSeen: 0,
    flagsFlagged: 0,
    flagsDeleted: 0,
    hasAttachments: 0,
    sizeBytes: 1234,
    createdAt: Date.now(),
    ...overrides,
  }
  sqlite
    .prepare(
      `INSERT INTO mail_messages (
        id, folder_id, imap_uid, message_id, subject, from_address, from_name, to_addresses,
        date, snippet, body_text, flags_seen, flags_flagged, flags_deleted, has_attachments,
        size_bytes, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      msg.id, msg.folderId, msg.imapUid, msg.messageId, msg.subject, msg.fromAddress, msg.fromName, msg.toAddresses,
      msg.date, msg.snippet, msg.bodyText, msg.flagsSeen, msg.flagsFlagged, msg.flagsDeleted, msg.hasAttachments,
      msg.sizeBytes, msg.createdAt,
    )
  return msg
}

function insertAttachmentRef(overrides: Partial<{
  id: string; messageId: string; filename: string; mimeType: string; sizeBytes: number; partId: string
}> = {}) {
  const ref = {
    id: 'att-1', messageId: 'msg-1', filename: 'invoice.pdf', mimeType: 'application/pdf', sizeBytes: 4321, partId: '2.1',
    ...overrides,
  }
  sqlite
    .prepare(
      `INSERT INTO mail_attachment_refs (id, message_id, filename, mime_type, size_bytes, part_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(ref.id, ref.messageId, ref.filename, ref.mimeType, ref.sizeBytes, ref.partId)
  return ref
}

beforeEach(() => {
  cleanDb()
  ensureUser('user-1', 'test@example.com')
  ensureUser('user-2', 'test2@example.com')
  connectMock.mockReset().mockResolvedValue(undefined)
  logoutMock.mockReset().mockResolvedValue(undefined)
  closeMock.mockReset().mockResolvedValue(undefined)
  releaseMock.mockReset()
  getMailboxLockMock.mockReset().mockResolvedValue({ release: releaseMock })
  downloadMock.mockReset().mockResolvedValue({
    meta: { expectedSize: 14, contentType: 'application/pdf' },
    content: Readable.from(Buffer.from('fake pdf bytes')),
  })
  ImapFlowMock.mockClear()
})

describe('GET /folders/:folderId/messages', () => {
  it('returns 401 without auth', async () => {
    const res = await get('/folders/folder-1/messages')
    expect(res.status).toBe(401)
  })

  it('returns 404 for a nonexistent folder id', async () => {
    const res = await get('/folders/does-not-exist/messages', H1)
    expect(res.status).toBe(404)
  })

  it('returns 404 for a folder id not owned by the caller (owned by a different user through account ownership)', async () => {
    insertAccount({ id: 'acc-2', userId: 'user-2' })
    insertFolder({ id: 'folder-2', accountId: 'acc-2' })
    const res = await get('/folders/folder-2/messages', H1)
    expect(res.status).toBe(404)
  })

  it('returns 200 with { messages, total } and the summary shape, excluding bodyText/toAddresses/flagsDeleted', async () => {
    insertAccount()
    insertFolder()
    insertMessage({ id: 'msg-1', imapUid: 100 })

    const res = await get('/folders/folder-1/messages', H1)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { messages: Array<Record<string, unknown>>; total: number }
    expect(body.total).toBe(1)
    expect(body.messages).toHaveLength(1)
    const m = body.messages[0]
    expect(m).toMatchObject({
      id: 'msg-1',
      subject: 'Hello there',
      fromAddress: 'alice@example.com',
      fromName: 'Alice',
      snippet: 'Hello there, this is a snippet',
      flagsSeen: false,
      flagsFlagged: false,
      hasAttachments: false,
    })
    expect(m).toHaveProperty('date')
    const keys = Object.keys(m)
    expect(keys).not.toContain('bodyText')
    expect(keys).not.toContain('body_text')
    expect(keys).not.toContain('toAddresses')
    expect(keys).not.toContain('to_addresses')
    expect(keys).not.toContain('flagsDeleted')
    expect(keys).not.toContain('flags_deleted')
  })

  it('returns messages newest-first (descending by date)', async () => {
    insertAccount()
    insertFolder()
    const base = Date.now()
    insertMessage({ id: 'msg-old', imapUid: 1, date: base - 3000, subject: 'Oldest' })
    insertMessage({ id: 'msg-new', imapUid: 2, date: base, subject: 'Newest' })
    insertMessage({ id: 'msg-mid', imapUid: 3, date: base - 1000, subject: 'Middle' })

    const res = await get('/folders/folder-1/messages', H1)
    const body = (await res.json()) as { messages: Array<Record<string, unknown>>; total: number }
    expect(body.messages.map((m) => m.id)).toEqual(['msg-new', 'msg-mid', 'msg-old'])
  })

  it('total reflects the full row count independent of pagination', async () => {
    insertAccount()
    insertFolder()
    const base = Date.now()
    for (let i = 0; i < 5; i++) {
      insertMessage({ id: `msg-${i}`, imapUid: i + 1, date: base - i * 1000 })
    }

    const res = await get('/folders/folder-1/messages?limit=2', H1)
    const body = (await res.json()) as { messages: Array<Record<string, unknown>>; total: number }
    expect(body.total).toBe(5)
    expect(body.messages).toHaveLength(2)
  })

  it('limit/offset work together, returning the correct page in newest-first order', async () => {
    insertAccount()
    insertFolder()
    const base = Date.now()
    // msg-0 is newest (largest date), msg-4 is oldest.
    for (let i = 0; i < 5; i++) {
      insertMessage({ id: `msg-${i}`, imapUid: i + 1, date: base - i * 1000 })
    }

    const res = await get('/folders/folder-1/messages?limit=2&offset=2', H1)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { messages: Array<Record<string, unknown>>; total: number }
    expect(body.total).toBe(5)
    expect(body.messages).toHaveLength(2)
    expect(body.messages.map((m) => m.id)).toEqual(['msg-2', 'msg-3'])
  })

  it('a default request (no query params) returns all messages in this small test case', async () => {
    insertAccount()
    insertFolder()
    const base = Date.now()
    for (let i = 0; i < 5; i++) {
      insertMessage({ id: `msg-${i}`, imapUid: i + 1, date: base - i * 1000 })
    }

    const res = await get('/folders/folder-1/messages', H1)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { messages: Array<Record<string, unknown>>; total: number }
    expect(body.total).toBe(5)
    expect(body.messages).toHaveLength(5)
  })
})

describe('GET /messages/:id', () => {
  it('returns 401 without auth', async () => {
    const res = await get('/messages/msg-1')
    expect(res.status).toBe(401)
  })

  it('returns 404 for a nonexistent message id', async () => {
    const res = await get('/messages/does-not-exist', H1)
    expect(res.status).toBe(404)
  })

  it('returns 404 for a message id not owned by the caller', async () => {
    insertAccount({ id: 'acc-2', userId: 'user-2' })
    insertFolder({ id: 'folder-2', accountId: 'acc-2' })
    insertMessage({ id: 'msg-2', folderId: 'folder-2' })

    const res = await get('/messages/msg-2', H1)
    expect(res.status).toBe(404)
  })

  it('returns 200 with the full detail shape, parsed toAddresses, and attachments without leaking partId', async () => {
    insertAccount()
    insertFolder()
    insertMessage({
      id: 'msg-1',
      toAddresses: JSON.stringify([{ name: 'Bob', address: 'bob@example.com' }]),
      hasAttachments: 1,
    })
    insertAttachmentRef({ id: 'att-1', messageId: 'msg-1', filename: 'invoice.pdf', mimeType: 'application/pdf', sizeBytes: 4321, partId: '2.1' })

    const res = await get('/messages/msg-1', H1)
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>

    expect(body).toMatchObject({
      id: 'msg-1',
      subject: 'Hello there',
      fromAddress: 'alice@example.com',
      fromName: 'Alice',
      bodyText: 'Hello there, this is the full body text.',
      flagsSeen: false,
      flagsFlagged: false,
    })
    expect(body).toHaveProperty('date')
    expect(body).toHaveProperty('createdAt')
    expect(body.toAddresses).toEqual([{ name: 'Bob', address: 'bob@example.com' }])

    expect(body.attachments).toEqual([
      { id: 'att-1', filename: 'invoice.pdf', mimeType: 'application/pdf', sizeBytes: 4321 },
    ])

    const json = JSON.stringify(body)
    expect(json).not.toContain('part_id')
    expect(json).not.toContain('partId')
    expect(json).not.toContain('2.1')
  })

  it('returns an empty attachments array when the message has no attachment refs', async () => {
    insertAccount()
    insertFolder()
    insertMessage({ id: 'msg-1', hasAttachments: 0 })

    const res = await get('/messages/msg-1', H1)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.attachments).toEqual([])
  })
})

describe('GET /messages/:id/attachments/:attachmentId', () => {
  beforeEach(() => {
    insertAccount()
    insertFolder()
    insertMessage({ id: 'msg-1', imapUid: 555 })
    insertAttachmentRef({ id: 'att-1', messageId: 'msg-1', filename: 'invoice.pdf', mimeType: 'application/pdf', sizeBytes: 14, partId: '2.1' })
  })

  it('returns 401 without auth', async () => {
    const res = await get('/messages/msg-1/attachments/att-1')
    expect(res.status).toBe(401)
  })

  it('returns 404 for a nonexistent/not-owned message id', async () => {
    const res = await get('/messages/does-not-exist/attachments/att-1', H1)
    expect(res.status).toBe(404)
  })

  it('returns 404 for a nonexistent attachment id', async () => {
    const res = await get('/messages/msg-1/attachments/does-not-exist', H1)
    expect(res.status).toBe(404)
  })

  it('returns 404 for an attachment id that exists but belongs to a different message', async () => {
    insertMessage({ id: 'msg-2', imapUid: 556 })
    insertAttachmentRef({ id: 'att-other', messageId: 'msg-2', filename: 'other.pdf', partId: '3' })

    const res = await get('/messages/msg-1/attachments/att-other', H1)
    expect(res.status).toBe(404)
  })

  it('streams the attachment bytes with the correct Content-Type and Content-Disposition, using the stored imapUid/partId', async () => {
    const res = await get('/messages/msg-1/attachments/att-1', H1)
    expect(res.status).toBe(200)

    const text = await res.text()
    expect(text).toBe('fake pdf bytes')

    expect(res.headers.get('content-type')).toContain('application/pdf')
    expect(res.headers.get('content-disposition')).toContain('invoice.pdf')

    expect(ImapFlowMock).toHaveBeenCalled()
    expect(downloadMock).toHaveBeenCalledWith(555, '2.1', expect.anything())
  })

  it('returns a >= 400 JSON error response (not a hang/crash) when connect() rejects', async () => {
    connectMock.mockRejectedValueOnce(new Error('IMAP server unreachable'))

    const res = await get('/messages/msg-1/attachments/att-1', H1)
    expect(res.status).toBeGreaterThanOrEqual(400)
    const body = (await res.json()) as { error?: unknown }
    expect(body).toHaveProperty('error')
  })

  it('returns a >= 400 JSON error response (not a hang/crash) when download() rejects', async () => {
    downloadMock.mockRejectedValueOnce(new Error('part not found'))

    const res = await get('/messages/msg-1/attachments/att-1', H1)
    expect(res.status).toBeGreaterThanOrEqual(400)
    const body = (await res.json()) as { error?: unknown }
    expect(body).toHaveProperty('error')
  })
})
