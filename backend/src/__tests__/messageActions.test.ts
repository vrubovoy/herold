import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../db/index.js', async () => await import('./helpers/db.js'))
vi.mock('../middleware/auth.js', async () => await import('./helpers/auth-mock.js'))

// PATCH/DELETE write through to the real IMAP server via two internal
// helpers exported from lib/imapConnection.js - both are mocked wholesale,
// hoisted so the vi.mock factory below can reference them (same pattern as
// sendMessage.test.ts's sendMail/appendToSent mocks).
const { setMessageFlagsMock, removeMessageMock } = vi.hoisted(() => {
  const setMessageFlagsMock = vi.fn(async (
    _account: unknown,
    _folderName: unknown,
    _imapUid: unknown,
    _flags: unknown,
  ) => undefined)
  const removeMessageMock = vi.fn(async (
    _account: unknown,
    _folderName: unknown,
    _imapUid: unknown,
    _trashFolderName: unknown,
  ) => undefined)
  return { setMessageFlagsMock, removeMessageMock }
})
vi.mock('../lib/imapConnection.js', () => ({
  setMessageFlags: setMessageFlagsMock,
  removeMessage: removeMessageMock,
}))

import { sqlite, cleanDb } from './helpers/db.js'
import { createTestApp } from './helpers/setup.js'
import { encryptCredential } from '../lib/credentialCrypto.js'

const app = createTestApp()

const H1 = { Authorization: 'Bearer test-token' }

const get = (path: string, headers?: Record<string, string>) =>
  headers ? app.request(path, { headers }) : app.request(path)

function jsonRequest(method: string, path: string, body: unknown, headers?: Record<string, string>) {
  return app.request(path, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

const patch = (path: string, body: unknown, headers?: Record<string, string>) =>
  jsonRequest('PATCH', path, body, headers)

const del = (path: string, headers?: Record<string, string>) =>
  app.request(path, { method: 'DELETE', headers })

function ensureUser(id: string, email: string) {
  const existing = sqlite.prepare('SELECT id FROM users WHERE id = ?').get(id)
  if (!existing) {
    sqlite.prepare('INSERT INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?)').run(id, email, email, Date.now())
  }
}

function insertAccount(overrides: Partial<{ id: string; userId: string }> = {}) {
  const account = { id: 'acc-1', userId: 'user-1', ...overrides }
  sqlite
    .prepare(
      `INSERT INTO mail_accounts (
        id, user_id, label, imap_host, imap_port, imap_security, imap_username, imap_password_encrypted,
        smtp_host, smtp_port, smtp_security, smtp_username, smtp_password_encrypted,
        from_name, from_email, sync_state, last_synced_at, last_error, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      account.id, account.userId, 'Test account', 'imap.example.com', 993, 'tls', 'me@example.com', encryptCredential('fake-imap-password'),
      'smtp.example.com', 465, 'tls', 'me@example.com', encryptCredential('fake-smtp-password'),
      'Me', 'me@example.com', 'ok', null, null, Date.now(),
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

interface MessageOverrides {
  id?: string
  folderId?: string
  imapUid?: number
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
}

function insertMessage(overrides: MessageOverrides = {}) {
  const msg = {
    id: 'msg-1',
    folderId: 'folder-1',
    imapUid: 100,
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
    ...overrides,
  }
  sqlite
    .prepare(
      `INSERT INTO mail_messages (
        id, folder_id, imap_uid, message_id, subject, from_address, from_name, to_addresses,
        date, snippet, body_text, flags_seen, flags_flagged, flags_deleted, has_attachments,
        size_bytes, created_at
      ) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      msg.id, msg.folderId, msg.imapUid, msg.subject, msg.fromAddress, msg.fromName, msg.toAddresses,
      msg.date, msg.snippet, msg.bodyText, msg.flagsSeen, msg.flagsFlagged, msg.flagsDeleted, msg.hasAttachments,
      1234, Date.now(),
    )
  return msg
}

interface RawMessageRow {
  id: string
  folder_id: string
  imap_uid: number
  flags_seen: number
  flags_flagged: number
}

function getMessageRaw(id: string): RawMessageRow | undefined {
  return sqlite.prepare('SELECT * FROM mail_messages WHERE id = ?').get(id) as RawMessageRow | undefined
}

function countMailMessages(): number {
  const row = sqlite.prepare('SELECT COUNT(*) as c FROM mail_messages').get() as { c: number }
  return row.c
}

beforeEach(() => {
  cleanDb()
  ensureUser('user-1', 'test@example.com')
  ensureUser('user-2', 'test2@example.com')
  setMessageFlagsMock.mockReset().mockResolvedValue(undefined)
  removeMessageMock.mockReset().mockResolvedValue(undefined)
})

describe('PATCH /messages/:id', () => {
  beforeEach(() => {
    insertAccount()
    insertFolder()
  })

  it('returns 401 without auth', async () => {
    insertMessage()
    const res = await patch('/messages/msg-1', { flagsSeen: true })
    expect(res.status).toBe(401)
  })

  it('returns 404 for a nonexistent message id', async () => {
    const res = await patch('/messages/does-not-exist', { flagsSeen: true }, H1)
    expect(res.status).toBe(404)
  })

  it('returns 404 for a message id owned by a different user (through folder/account ownership)', async () => {
    insertAccount({ id: 'acc-2', userId: 'user-2' })
    insertFolder({ id: 'folder-2', accountId: 'acc-2' })
    insertMessage({ id: 'msg-2', folderId: 'folder-2' })

    const res = await patch('/messages/msg-2', { flagsSeen: true }, H1)
    expect(res.status).toBe(404)
    expect(setMessageFlagsMock).not.toHaveBeenCalled()
  })

  it.each([
    ['an empty body', {}],
    ['a body with neither recognized field', { somethingElse: true }],
  ])('returns 400 for %s', async (_label, body) => {
    insertMessage()
    const res = await patch('/messages/msg-1', body, H1)
    expect(res.status).toBe(400)
    expect(setMessageFlagsMock).not.toHaveBeenCalled()
    // Local row must be untouched by a rejected request.
    expect(getMessageRaw('msg-1')?.flags_seen).toBe(0)
  })

  it('updates only flagsSeen, leaving flagsFlagged unchanged, and returns the summary shape with 200', async () => {
    insertMessage({ imapUid: 100, flagsSeen: 0, flagsFlagged: 1 })

    const res = await patch('/messages/msg-1', { flagsSeen: true }, H1)
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body).toMatchObject({
      id: 'msg-1',
      subject: 'Hello there',
      fromAddress: 'alice@example.com',
      fromName: 'Alice',
      snippet: 'Hello there, this is a snippet',
      flagsSeen: true,
      flagsFlagged: true,
      hasAttachments: false,
    })
    expect(body).toHaveProperty('date')
    const keys = Object.keys(body)
    expect(keys).not.toContain('bodyText')
    expect(keys).not.toContain('toAddresses')
    expect(keys).not.toContain('flagsDeleted')

    const row = getMessageRaw('msg-1')
    expect(row?.flags_seen).toBe(1)
    expect(row?.flags_flagged).toBe(1)
  })

  it('updates only flagsFlagged, leaving flagsSeen unchanged', async () => {
    insertMessage({ imapUid: 100, flagsSeen: 1, flagsFlagged: 0 })

    const res = await patch('/messages/msg-1', { flagsFlagged: true }, H1)
    expect(res.status).toBe(200)
    const row = getMessageRaw('msg-1')
    expect(row?.flags_seen).toBe(1)
    expect(row?.flags_flagged).toBe(1)
  })

  it('updates both fields when both are provided', async () => {
    insertMessage({ imapUid: 100, flagsSeen: 0, flagsFlagged: 0 })

    const res = await patch('/messages/msg-1', { flagsSeen: true, flagsFlagged: true }, H1)
    expect(res.status).toBe(200)
    const row = getMessageRaw('msg-1')
    expect(row?.flags_seen).toBe(1)
    expect(row?.flags_flagged).toBe(1)
  })

  it('can flip flags back to false', async () => {
    insertMessage({ imapUid: 100, flagsSeen: 1, flagsFlagged: 1 })

    const res = await patch('/messages/msg-1', { flagsSeen: false, flagsFlagged: false }, H1)
    expect(res.status).toBe(200)
    const row = getMessageRaw('msg-1')
    expect(row?.flags_seen).toBe(0)
    expect(row?.flags_flagged).toBe(0)
  })

  it('calls setMessageFlags with the account, folder name, imapUid, and { seen, flagged } before updating the local row', async () => {
    insertMessage({ imapUid: 555, flagsSeen: 0, flagsFlagged: 0 })

    const res = await patch('/messages/msg-1', { flagsSeen: true, flagsFlagged: true }, H1)
    expect(res.status).toBe(200)

    expect(setMessageFlagsMock).toHaveBeenCalledTimes(1)
    const [accountArg, folderNameArg, uidArg, flagsArg] = setMessageFlagsMock.mock.calls[0]!
    expect((accountArg as Record<string, unknown>)['id']).toBe('acc-1')
    expect(folderNameArg).toBe('INBOX')
    expect(uidArg).toBe(555)
    expect(flagsArg).toMatchObject({ seen: true, flagged: true })
  })

  it('skips the IMAP write-through entirely for a synthetic placeholder row (imapUid <= 0)', async () => {
    insertMessage({ id: 'msg-synth', imapUid: -1234567890, flagsSeen: 0, flagsFlagged: 0 })

    const res = await patch('/messages/msg-synth', { flagsSeen: true }, H1)
    expect(res.status).toBe(200)
    expect(setMessageFlagsMock).not.toHaveBeenCalled()

    const row = getMessageRaw('msg-synth')
    expect(row?.flags_seen).toBe(1)
  })

  it('returns 502 with { error } and leaves the local row unchanged when setMessageFlags rejects', async () => {
    insertMessage({ imapUid: 100, flagsSeen: 0, flagsFlagged: 0 })
    setMessageFlagsMock.mockRejectedValueOnce(new Error('IMAP STORE failed'))

    const res = await patch('/messages/msg-1', { flagsSeen: true }, H1)
    expect(res.status).toBe(502)
    const body = (await res.json()) as { error?: unknown }
    expect(body).toHaveProperty('error')
    expect(typeof body.error).toBe('string')

    const row = getMessageRaw('msg-1')
    expect(row?.flags_seen).toBe(0)
    expect(row?.flags_flagged).toBe(0)
  })
})

describe('DELETE /messages/:id', () => {
  beforeEach(() => {
    insertAccount()
    insertFolder({ id: 'folder-1', accountId: 'acc-1', name: 'INBOX', specialUse: 'inbox' })
  })

  it('returns 401 without auth', async () => {
    insertMessage()
    const res = await del('/messages/msg-1')
    expect(res.status).toBe(401)
  })

  it('returns 404 for a nonexistent message id', async () => {
    const res = await del('/messages/does-not-exist', H1)
    expect(res.status).toBe(404)
  })

  it('returns 404 for a message id owned by a different user', async () => {
    insertAccount({ id: 'acc-2', userId: 'user-2' })
    insertFolder({ id: 'folder-2', accountId: 'acc-2' })
    insertMessage({ id: 'msg-2', folderId: 'folder-2' })

    const res = await del('/messages/msg-2', H1)
    expect(res.status).toBe(404)
    expect(removeMessageMock).not.toHaveBeenCalled()
  })

  it('moves to trash: calls removeMessage with the Trash folder name as the 4th arg when a distinct Trash folder is known', async () => {
    insertFolder({ id: 'folder-trash', accountId: 'acc-1', name: 'Trash', specialUse: 'trash' })
    insertMessage({ id: 'msg-1', folderId: 'folder-1', imapUid: 100 })

    const res = await del('/messages/msg-1', H1)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean }
    expect(body).toEqual({ ok: true })

    expect(removeMessageMock).toHaveBeenCalledTimes(1)
    const [accountArg, folderNameArg, uidArg, trashArg] = removeMessageMock.mock.calls[0]!
    expect((accountArg as Record<string, unknown>)['id']).toBe('acc-1')
    expect(folderNameArg).toBe('INBOX')
    expect(uidArg).toBe(100)
    expect(trashArg).toBe('Trash')

    expect(getMessageRaw('msg-1')).toBeUndefined()
  })

  it('permanently deletes in place: calls removeMessage with null as the 4th arg when no Trash folder is known locally', async () => {
    insertMessage({ id: 'msg-1', folderId: 'folder-1', imapUid: 100 })

    const res = await del('/messages/msg-1', H1)
    expect(res.status).toBe(200)

    expect(removeMessageMock).toHaveBeenCalledTimes(1)
    const [, folderNameArg, uidArg, trashArg] = removeMessageMock.mock.calls[0]!
    expect(folderNameArg).toBe('INBOX')
    expect(uidArg).toBe(100)
    expect(trashArg).toBeNull()

    expect(getMessageRaw('msg-1')).toBeUndefined()
  })

  it('permanently deletes in place: calls removeMessage with null when the message is already sitting in the Trash folder itself', async () => {
    const trash = insertFolder({ id: 'folder-trash', accountId: 'acc-1', name: 'Trash', specialUse: 'trash' })
    insertMessage({ id: 'msg-1', folderId: trash.id, imapUid: 100 })

    const res = await del('/messages/msg-1', H1)
    expect(res.status).toBe(200)

    expect(removeMessageMock).toHaveBeenCalledTimes(1)
    const [, folderNameArg, uidArg, trashArg] = removeMessageMock.mock.calls[0]!
    expect(folderNameArg).toBe('Trash')
    expect(uidArg).toBe(100)
    expect(trashArg).toBeNull()

    expect(getMessageRaw('msg-1')).toBeUndefined()
  })

  it('skips the IMAP call entirely for a synthetic placeholder row (imapUid <= 0), still deleting the local row', async () => {
    insertMessage({ id: 'msg-synth', folderId: 'folder-1', imapUid: -1234567890 })

    const res = await del('/messages/msg-synth', H1)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean }
    expect(body).toEqual({ ok: true })

    expect(removeMessageMock).not.toHaveBeenCalled()
    expect(getMessageRaw('msg-synth')).toBeUndefined()
  })

  it('returns 502 with { error } and leaves the local row present when removeMessage rejects', async () => {
    insertMessage({ id: 'msg-1', folderId: 'folder-1', imapUid: 100 })
    removeMessageMock.mockRejectedValueOnce(new Error('IMAP MOVE failed'))

    const before = countMailMessages()
    const res = await del('/messages/msg-1', H1)
    expect(res.status).toBe(502)
    const body = (await res.json()) as { error?: unknown }
    expect(body).toHaveProperty('error')
    expect(typeof body.error).toBe('string')

    expect(countMailMessages()).toBe(before)
    expect(getMessageRaw('msg-1')).toBeDefined()
  })
})

describe('GET /folders/:folderId/messages?q=', () => {
  beforeEach(() => {
    insertAccount()
    insertFolder()
    insertMessage({
      id: 'msg-a',
      imapUid: 1,
      subject: 'Quarterly Report',
      fromAddress: 'alice@example.com',
      fromName: 'Alice Wonderland',
      bodyText: 'Numbers for Q1 are attached.',
    })
    insertMessage({
      id: 'msg-b',
      imapUid: 2,
      subject: 'Lunch plans',
      fromAddress: 'bob@example.com',
      fromName: 'Bob Marley',
      bodyText: "Let's grab lunch tomorrow.",
    })
    insertMessage({
      id: 'msg-c',
      imapUid: 3,
      subject: 'Meeting notes',
      fromAddress: 'carol@example.com',
      fromName: 'Carol Danvers',
      bodyText: 'Discussed the roadmap for next quarter.',
    })
  })

  it('filters to only the message whose subject contains the search term (case-insensitive)', async () => {
    const res = await get('/folders/folder-1/messages?q=quarterly', H1)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { messages: Array<Record<string, unknown>>; total: number }
    expect(body.total).toBe(1)
    expect(body.messages).toHaveLength(1)
    expect(body.messages[0]?.['id']).toBe('msg-a')
  })

  it('filters to only the message whose fromName contains the search term', async () => {
    const res = await get('/folders/folder-1/messages?q=Marley', H1)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { messages: Array<Record<string, unknown>>; total: number }
    expect(body.total).toBe(1)
    expect(body.messages).toHaveLength(1)
    expect(body.messages[0]?.['id']).toBe('msg-b')
  })

  it('filters to only the message whose body text contains the search term', async () => {
    const res = await get('/folders/folder-1/messages?q=roadmap', H1)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { messages: Array<Record<string, unknown>>; total: number }
    expect(body.total).toBe(1)
    expect(body.messages).toHaveLength(1)
    expect(body.messages[0]?.['id']).toBe('msg-c')
  })

  it('returns an empty list with total 0 when the search term matches nothing', async () => {
    const res = await get('/folders/folder-1/messages?q=xyzzy-no-match', H1)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { messages: Array<Record<string, unknown>>; total: number }
    expect(body.total).toBe(0)
    expect(body.messages).toEqual([])
  })

  it('applies limit/offset pagination on top of the filtered set', async () => {
    // "example.com" appears in all three fromAddress values.
    const res = await get('/folders/folder-1/messages?q=example.com&limit=2&offset=0', H1)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { messages: Array<Record<string, unknown>>; total: number }
    expect(body.total).toBe(3)
    expect(body.messages).toHaveLength(2)

    const res2 = await get('/folders/folder-1/messages?q=example.com&limit=2&offset=2', H1)
    const body2 = (await res2.json()) as { messages: Array<Record<string, unknown>>; total: number }
    expect(body2.total).toBe(3)
    expect(body2.messages).toHaveLength(1)
  })

  it('behaves unchanged (returns all messages) when q is absent', async () => {
    const res = await get('/folders/folder-1/messages', H1)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { messages: Array<Record<string, unknown>>; total: number }
    expect(body.total).toBe(3)
    expect(body.messages).toHaveLength(3)
  })

  it('scopes q to the caller\'s own folder (404 for another user\'s folder id, unaffected by q)', async () => {
    insertAccount({ id: 'acc-2', userId: 'user-2' })
    insertFolder({ id: 'folder-2', accountId: 'acc-2' })
    const res = await get('/folders/folder-2/messages?q=quarterly', H1)
    expect(res.status).toBe(404)
  })
})
