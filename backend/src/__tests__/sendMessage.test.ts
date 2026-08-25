import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../db/index.js', async () => await import('./helpers/db.js'))
vi.mock('../middleware/auth.js', async () => await import('./helpers/auth-mock.js'))

// The route under test calls two internal helpers that must never touch a
// real network: sendMail (SMTP submission) and appendToSent (best-effort
// IMAP APPEND into the Sent folder). Both are mocked wholesale, hoisted so
// the vi.mock factories below (which are themselves hoisted above these
// const declarations) can reference them.
const { sendMailMock, appendToSentMock } = vi.hoisted(() => {
  const sendMailMock = vi.fn(async (_account: unknown, _mail: unknown) => ({
    messageId: '<generated@test>',
    raw: Buffer.from('raw rfc822 bytes'),
  }))
  const appendToSentMock = vi.fn(async (_account: unknown, _folderName: unknown, _raw: unknown) => undefined)
  return { sendMailMock, appendToSentMock }
})
vi.mock('../lib/mailSend.js', async (importOriginal) => ({
  // localizeSmtpError is a pure text-translation function the route also
  // imports from this module - kept real (not mocked) so the 502 path
  // below exercises its actual behavior.
  ...(await importOriginal<typeof import('../lib/mailSend.js')>()),
  sendMail: sendMailMock,
}))
vi.mock('../lib/imapConnection.js', () => ({ appendToSent: appendToSentMock }))

import { sqlite, cleanDb } from './helpers/db.js'
import { createTestApp } from './helpers/setup.js'
import { encryptCredential } from '../lib/credentialCrypto.js'

const app = createTestApp()

const H1 = { Authorization: 'Bearer test-token' }
const H2 = { Authorization: 'Bearer user2-token' }

const get = (path: string, headers?: Record<string, string>) =>
  headers ? app.request(path, { headers }) : app.request(path)

function jsonRequest(method: string, path: string, body: unknown, headers?: Record<string, string>) {
  return app.request(path, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

const post = (path: string, body: unknown, headers?: Record<string, string>) =>
  jsonRequest('POST', path, body, headers)

function ensureUser(id: string, email: string) {
  const existing = sqlite.prepare('SELECT id FROM users WHERE id = ?').get(id)
  if (!existing) {
    sqlite.prepare('INSERT INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?)').run(id, email, email, Date.now())
  }
}

function insertAccount(overrides: Partial<{
  id: string; userId: string; fromName: string; fromEmail: string
}> = {}) {
  const account = {
    id: 'acc-1', userId: 'user-1', fromName: 'Me', fromEmail: 'me@example.com',
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
      account.id, account.userId, 'Test account', 'imap.example.com', 993, 'tls', 'me@example.com', encryptCredential('fake-imap-password'),
      'smtp.example.com', 465, 'tls', 'me@example.com', encryptCredential('fake-smtp-password'),
      account.fromName, account.fromEmail, 'ok', null, null, Date.now(),
    )
  return account
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
    id: 'msg-existing',
    folderId: 'folder-1',
    imapUid: 100,
    subject: 'Existing message',
    fromAddress: 'someone@example.com',
    fromName: 'Someone',
    toAddresses: JSON.stringify([{ address: 'me@example.com' }]),
    date: Date.now(),
    snippet: 'Existing message snippet',
    bodyText: 'Existing message body.',
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

function countMailMessages(): number {
  const row = sqlite.prepare('SELECT COUNT(*) as c FROM mail_messages').get() as { c: number }
  return row.c
}

function validSendBody(overrides: Record<string, unknown> = {}) {
  return {
    to: ['bob@example.com'],
    subject: 'Hello from a test',
    bodyText: 'This is the body of the message.',
    ...overrides,
  }
}

beforeEach(() => {
  cleanDb()
  ensureUser('user-1', 'test@example.com')
  ensureUser('user-2', 'test2@example.com')
  sendMailMock.mockReset().mockResolvedValue({
    messageId: '<generated@test>',
    raw: Buffer.from('raw rfc822 bytes'),
  })
  appendToSentMock.mockReset().mockResolvedValue(undefined)
})

describe('POST /accounts/:accountId/messages/send', () => {
  it('returns 401 without auth', async () => {
    const res = await post('/accounts/acc-1/messages/send', validSendBody())
    expect(res.status).toBe(401)
  })

  it('returns 404 for a nonexistent accountId', async () => {
    const res = await post('/accounts/does-not-exist/messages/send', validSendBody(), H1)
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error?: unknown }
    expect(body).toHaveProperty('error')
  })

  it('returns 404 for an accountId belonging to a different user', async () => {
    insertAccount({ id: 'acc-other', userId: 'user-2' })
    const res = await post('/accounts/acc-other/messages/send', validSendBody(), H1)
    expect(res.status).toBe(404)
  })

  it.each([
    ['missing "to"', { to: undefined }],
    ['empty "to" array', { to: [] }],
    ['an invalid email in "to"', { to: ['not-an-email'] }],
    ['an invalid email in "cc"', { cc: ['not-an-email'] }],
    ['an invalid email in "bcc"', { bcc: ['not-an-email'] }],
    ['missing bodyText', { bodyText: undefined }],
    ['empty bodyText', { bodyText: '' }],
  ])('returns 400 for %s', async (_label, overrides) => {
    insertAccount()
    const res = await post('/accounts/acc-1/messages/send', validSendBody(overrides), H1)
    expect(res.status).toBe(400)
    expect(sendMailMock).not.toHaveBeenCalled()
  })

  it('returns 201 with { ok: true, message: null } and writes nothing to mail_messages when no Sent folder exists', async () => {
    insertAccount()
    insertFolder({ id: 'folder-inbox', accountId: 'acc-1', name: 'INBOX', specialUse: 'inbox' })
    insertMessage({ id: 'msg-existing', folderId: 'folder-inbox' })

    const before = countMailMessages()
    const res = await post('/accounts/acc-1/messages/send', validSendBody(), H1)
    expect(res.status).toBe(201)
    const body = (await res.json()) as { ok: boolean; message: unknown }
    expect(body.ok).toBe(true)
    expect(body.message).toBeNull()

    expect(countMailMessages()).toBe(before)
    expect(sendMailMock).toHaveBeenCalledTimes(1)
    expect(appendToSentMock).not.toHaveBeenCalled()

    // The pre-existing INBOX message list is unaffected.
    const listRes = await get('/folders/folder-inbox/messages', H1)
    const listBody = (await listRes.json()) as { messages: Array<Record<string, unknown>>; total: number }
    expect(listBody.total).toBe(1)
  })

  it('returns 201 with a populated message summary and mirrors the message into mail_messages when a Sent folder exists', async () => {
    insertAccount()
    const sentFolder = insertFolder({ id: 'folder-sent', accountId: 'acc-1', name: 'Sent', specialUse: 'sent' })

    const res = await post(
      '/accounts/acc-1/messages/send',
      validSendBody({ to: ['bob@example.com', 'carol@example.com'], subject: 'Meeting notes', bodyText: 'See attached notes.' }),
      H1,
    )
    expect(res.status).toBe(201)
    const body = (await res.json()) as { ok: boolean; message: Record<string, unknown> | null }
    expect(body.ok).toBe(true)
    expect(body.message).not.toBeNull()
    const summary = body.message!
    expect(summary).toMatchObject({
      subject: 'Meeting notes',
      fromAddress: 'me@example.com',
      fromName: 'Me',
      flagsSeen: true,
      flagsFlagged: false,
      hasAttachments: false,
    })
    expect(summary).toHaveProperty('id')
    expect(summary).toHaveProperty('date')
    expect(summary).toHaveProperty('snippet')
    const keys = Object.keys(summary)
    expect(keys).not.toContain('bodyText')
    expect(keys).not.toContain('toAddresses')
    expect(keys).not.toContain('flagsDeleted')

    // Visible via the ordinary folder-listing endpoint.
    const listRes = await get(`/folders/${sentFolder.id}/messages`, H1)
    expect(listRes.status).toBe(200)
    const listBody = (await listRes.json()) as { messages: Array<Record<string, unknown>>; total: number }
    expect(listBody.total).toBe(1)
    expect(listBody.messages[0]).toMatchObject({
      id: summary.id,
      subject: 'Meeting notes',
      fromAddress: 'me@example.com',
      fromName: 'Me',
      flagsSeen: true,
    })

    // Full detail (toAddresses + bodyText) via GET /messages/:id.
    const detailRes = await get(`/messages/${summary.id as string}`, H1)
    expect(detailRes.status).toBe(200)
    const detail = (await detailRes.json()) as Record<string, unknown>
    expect(detail.toAddresses).toEqual([{ address: 'bob@example.com' }, { address: 'carol@example.com' }])
    expect(detail.bodyText).toBe('See attached notes.')
    expect(detail.fromAddress).toBe('me@example.com')
    expect(detail.fromName).toBe('Me')
    expect(detail.flagsSeen).toBe(true)
    expect(detail.flagsFlagged).toBe(false)
    expect(sqlite.prepare('SELECT reconciliation_state FROM mail_messages WHERE id = ?').get(summary.id))
      .toMatchObject({ reconciliation_state: 'pending' })
    expect(appendToSentMock).not.toHaveBeenCalled()
  })

  it('stores a null/empty subject when the request omits it', async () => {
    insertAccount()
    insertFolder({ id: 'folder-sent', accountId: 'acc-1', name: 'Sent', specialUse: 'sent' })

    const res = await post('/accounts/acc-1/messages/send', { to: ['bob@example.com'], bodyText: 'No subject here.' }, H1)
    expect(res.status).toBe(201)
    const body = (await res.json()) as { message: Record<string, unknown> | null }
    expect(body.message?.subject == null || body.message?.subject === '').toBe(true)
  })

  it('calls sendMail with the account and mail fields, and appendToSent with the Sent folder name and raw bytes', async () => {
    insertAccount()
    sqlite.prepare("UPDATE mail_accounts SET sent_filing_mode = 'append' WHERE id = 'acc-1'").run()
    const sentFolder = insertFolder({ id: 'folder-sent', accountId: 'acc-1', name: 'Sent', specialUse: 'sent' })
    sendMailMock.mockResolvedValueOnce({ messageId: '<abc123@test>', raw: Buffer.from('specific raw bytes') })

    const res = await post(
      '/accounts/acc-1/messages/send',
      validSendBody({ to: ['bob@example.com'], cc: ['carol@example.com'], bodyText: 'Body text here.' }),
      H1,
    )
    expect(res.status).toBe(201)

    expect(sendMailMock).toHaveBeenCalledTimes(1)
    const [accountArg, mailArg] = sendMailMock.mock.calls[0]!
    expect((accountArg as Record<string, unknown>).id).toBe('acc-1')
    expect(mailArg).toMatchObject({
      to: ['bob@example.com'],
      cc: ['carol@example.com'],
      bodyText: 'Body text here.',
    })

    expect(appendToSentMock).toHaveBeenCalledTimes(1)
    const [, folderNameArg, rawArg] = appendToSentMock.mock.calls[0]!
    expect(folderNameArg).toBe(sentFolder.name)
    expect(Buffer.isBuffer(rawArg)).toBe(true)
    expect((rawArg as Buffer).toString()).toBe('specific raw bytes')
  })

  it('passes inReplyTo through to sendMail when provided', async () => {
    insertAccount()
    insertFolder({ id: 'folder-sent', accountId: 'acc-1', name: 'Sent', specialUse: 'sent' })

    const res = await post(
      '/accounts/acc-1/messages/send',
      validSendBody({ inReplyTo: '<original@example.com>' }),
      H1,
    )
    expect(res.status).toBe(201)

    expect(sendMailMock).toHaveBeenCalledTimes(1)
    const [, mailArg] = sendMailMock.mock.calls[0]!
    expect((mailArg as Record<string, unknown>).inReplyTo).toBe('<original@example.com>')
  })

  it('returns 502 with { error } when sendMail rejects, and writes nothing even when a Sent folder exists', async () => {
    insertAccount()
    insertFolder({ id: 'folder-sent', accountId: 'acc-1', name: 'Sent', specialUse: 'sent' })
    sendMailMock.mockRejectedValueOnce(new Error('SMTP connection refused'))

    const before = countMailMessages()
    const res = await post('/accounts/acc-1/messages/send', validSendBody(), H1)
    expect(res.status).toBe(502)
    const body = (await res.json()) as { error?: unknown }
    expect(body).toHaveProperty('error')
    expect(typeof body.error).toBe('string')

    expect(countMailMessages()).toBe(before)
    expect(appendToSentMock).not.toHaveBeenCalled()
  })

  it('still returns 201 with the message populated and inserted when appendToSent rejects (fire-and-forget)', async () => {
    insertAccount()
    const sentFolder = insertFolder({ id: 'folder-sent', accountId: 'acc-1', name: 'Sent', specialUse: 'sent' })
    appendToSentMock.mockRejectedValueOnce(new Error('IMAP APPEND failed'))

    const res = await post('/accounts/acc-1/messages/send', validSendBody(), H1)
    expect(res.status).toBe(201)
    const body = (await res.json()) as { ok: boolean; message: Record<string, unknown> | null }
    expect(body.ok).toBe(true)
    expect(body.message).not.toBeNull()

    const listRes = await get(`/folders/${sentFolder.id}/messages`, H1)
    const listBody = (await listRes.json()) as { total: number }
    expect(listBody.total).toBe(1)
  })

  it('does not allow sending against another user\'s account even with a valid body (ownership check via H2)', async () => {
    insertAccount({ id: 'acc-1', userId: 'user-1' })
    insertFolder({ id: 'folder-sent', accountId: 'acc-1', name: 'Sent', specialUse: 'sent' })

    const res = await post('/accounts/acc-1/messages/send', validSendBody(), H2)
    expect(res.status).toBe(404)
    expect(sendMailMock).not.toHaveBeenCalled()
  })
})
