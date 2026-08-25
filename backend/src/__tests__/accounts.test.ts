import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../db/index.js', async () => await import('./helpers/db.js'))
vi.mock('../middleware/auth.js', async () => await import('./helpers/auth-mock.js'))
vi.mock('../lib/outboundResolver.js', () => ({
  resolveOutboundHost: vi.fn(async () => ({ address: '203.0.113.1', family: 4, lookup: vi.fn() })),
}))

// Mocked at the module level so POST /accounts/test-connection and
// POST /accounts/:id/test-connection never open a real network
// connection - instances expose `connect` and `close` as vi.fn()s so
// each test can control (or inspect calls to) either. Declared via
// vi.hoisted since vi.mock's factory below is itself hoisted above
// these imports/const declarations.
const { connectMock, closeMock, ImapFlowMock } = vi.hoisted(() => {
  const connectMock = vi.fn(async () => undefined)
  const closeMock = vi.fn(async () => undefined)
  const ImapFlowMock = vi.fn().mockImplementation(function (this: unknown) {
    Object.assign(this as object, { connect: connectMock, close: closeMock })
  })
  return { connectMock, closeMock, ImapFlowMock }
})
vi.mock('imapflow', () => ({ ImapFlow: ImapFlowMock }))

import { sqlite, cleanDb } from './helpers/db.js'
import { createTestApp } from './helpers/setup.js'

const app = createTestApp()

const H1 = { Authorization: 'Bearer test-token' }
const H2 = { Authorization: 'Bearer user2-token' }

const get = (path: string, headers?: Record<string, string>) =>
  headers ? app.request(path, { headers }) : app.request(path)

function jsonRequest(
  method: string,
  path: string,
  body: unknown,
  headers?: Record<string, string>,
) {
  return app.request(path, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

const post = (path: string, body: unknown, headers?: Record<string, string>) =>
  jsonRequest('POST', path, body, headers)
const patch = (path: string, body: unknown, headers?: Record<string, string>) =>
  jsonRequest('PATCH', path, body, headers)
const del = (path: string, headers?: Record<string, string>) =>
  app.request(path, { method: 'DELETE', headers })

interface RawMailAccountRow {
  id: string
  user_id: string
  label: string
  imap_password_encrypted: string
  smtp_password_encrypted: string
}

function selectRawAccount(id: string): RawMailAccountRow | undefined {
  return sqlite.prepare('SELECT * FROM mail_accounts WHERE id = ?').get(id) as
    | RawMailAccountRow
    | undefined
}

function validFields(overrides: Record<string, unknown> = {}) {
  return {
    label: 'My work mail',
    imapHost: 'imap.example.com',
    imapPort: 993,
    imapSecurity: 'tls',
    imapUsername: 'me@example.com',
    imapPassword: 'super-secret-imap-pw',
    smtpHost: 'smtp.example.com',
    smtpPort: 465,
    smtpSecurity: 'tls',
    smtpUsername: 'me@example.com',
    smtpPassword: 'super-secret-smtp-pw',
    fromName: 'Me',
    fromEmail: 'me@example.com',
    ...overrides,
  }
}

async function createAccount(headers: Record<string, string> = H1, overrides = {}) {
  const res = await post('/accounts', validFields(overrides), headers)
  expect(res.status).toBe(201)
  return (await res.json()) as Record<string, unknown>
}

beforeEach(() => {
  cleanDb()
  connectMock.mockReset().mockResolvedValue(undefined)
  closeMock.mockReset().mockResolvedValue(undefined)
  ImapFlowMock.mockClear()
})

const FORBIDDEN_KEYS = [
  'imapPassword',
  'smtpPassword',
  'imapPasswordEncrypted',
  'smtpPasswordEncrypted',
]

function assertNoPasswordLeak(body: unknown, plaintexts: string[]) {
  const json = JSON.stringify(body)
  for (const key of FORBIDDEN_KEYS) {
    expect(json).not.toContain(`"${key}"`)
  }
  for (const plaintext of plaintexts) {
    expect(json).not.toContain(plaintext)
  }
}

describe('GET /accounts', () => {
  it('returns 401 without a valid token', async () => {
    const res = await get('/accounts')
    expect(res.status).toBe(401)
  })

  it('returns an empty array when the caller has no accounts', async () => {
    const res = await get('/accounts', H1)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([])
  })

  it('returns only the caller\'s own accounts, never another user\'s, with the documented shape and no password fields', async () => {
    const mine = await createAccount(H1, { label: 'Mine' })
    await createAccount(H2, { label: 'Not mine' })

    const res = await get('/accounts', H1)
    expect(res.status).toBe(200)
    const body = (await res.json()) as Array<Record<string, unknown>>
    expect(body).toHaveLength(1)
    expect(body[0]).toMatchObject({
      id: mine.id,
      label: 'Mine',
      imapHost: 'imap.example.com',
      imapPort: 993,
      imapSecurity: 'tls',
      imapUsername: 'me@example.com',
      smtpHost: 'smtp.example.com',
      smtpPort: 465,
      smtpSecurity: 'tls',
      smtpUsername: 'me@example.com',
      fromName: 'Me',
      fromEmail: 'me@example.com',
      syncState: 'pending',
      lastSyncedAt: null,
      lastError: null,
    })
    expect(body[0]).toHaveProperty('createdAt')
    assertNoPasswordLeak(body, ['super-secret-imap-pw', 'super-secret-smtp-pw'])
  })
})

describe('POST /accounts', () => {
  it('returns 401 without a valid token', async () => {
    const res = await post('/accounts', validFields())
    expect(res.status).toBe(401)
  })

  it('creates an account and returns 201 with the created shape, defaults, and no password leak', async () => {
    const res = await post('/accounts', validFields(), H1)
    expect(res.status).toBe(201)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.id).toEqual(expect.any(String))
    expect(body.label).toBe('My work mail')
    expect(body.syncState).toBe('pending')
    expect(body.lastSyncedAt).toBeNull()
    expect(body.lastError).toBeNull()
    assertNoPasswordLeak(body, ['super-secret-imap-pw', 'super-secret-smtp-pw'])
  })

  it('persists the created account - visible via a following GET /accounts and GET /accounts/:id', async () => {
    const created = await createAccount()

    const listRes = await get('/accounts', H1)
    const list = (await listRes.json()) as Array<Record<string, unknown>>
    expect(list.map((a) => a.id)).toContain(created.id)

    const oneRes = await get(`/accounts/${created.id}`, H1)
    expect(oneRes.status).toBe(200)
    expect((await oneRes.json())).toMatchObject({ id: created.id, label: 'My work mail' })
  })

  it('encrypts the password at rest - the raw imap_password_encrypted column is neither equal to nor contains the plaintext', async () => {
    const created = await createAccount(H1, { imapPassword: 'plaintext-marker-pw-1' })
    const row = selectRawAccount(created.id as string)
    expect(row).toBeDefined()
    expect(row!.imap_password_encrypted).not.toBe('plaintext-marker-pw-1')
    expect(row!.imap_password_encrypted).not.toContain('plaintext-marker-pw-1')
  })

  it.each([
    ['missing label', { label: undefined }],
    ['empty label', { label: '' }],
    ['label too long', { label: 'x'.repeat(201) }],
    ['invalid imapSecurity', { imapSecurity: 'ssl' }],
    ['invalid fromEmail format', { fromEmail: 'not-an-email' }],
    ['imapPort too low', { imapPort: 0 }],
    ['imapPort too high', { imapPort: 65536 }],
    ['empty imapPassword', { imapPassword: '' }],
    ['empty smtpPassword', { smtpPassword: '' }],
    ['missing imapHost', { imapHost: undefined }],
  ])('returns 400 for %s', async (_label, overrides) => {
    const res = await post('/accounts', validFields(overrides), H1)
    expect(res.status).toBe(400)
  })
})

describe('GET /accounts/:id', () => {
  it('returns 401 without a valid token', async () => {
    const res = await get('/accounts/nonexistent')
    expect(res.status).toBe(401)
  })

  it('returns 404 for a nonexistent id', async () => {
    const res = await get('/accounts/does-not-exist', H1)
    expect(res.status).toBe(404)
  })

  it('returns 404 (not 403) for an id that belongs to a different user', async () => {
    const other = await createAccount(H2)
    const res = await get(`/accounts/${other.id}`, H1)
    expect(res.status).toBe(404)
  })

  it('returns 200 with the account for its owner', async () => {
    const mine = await createAccount(H1)
    const res = await get(`/accounts/${mine.id}`, H1)
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.id).toBe(mine.id)
    assertNoPasswordLeak(body, ['super-secret-imap-pw', 'super-secret-smtp-pw'])
  })
})

describe('PATCH /accounts/:id', () => {
  it('returns 401 without a valid token', async () => {
    const res = await patch('/accounts/whatever', { label: 'x' })
    expect(res.status).toBe(401)
  })

  it('returns 404 for a nonexistent id', async () => {
    const res = await patch('/accounts/does-not-exist', { label: 'x' }, H1)
    expect(res.status).toBe(404)
  })

  it('returns 404 (not 403) when patching another user\'s account', async () => {
    const other = await createAccount(H2)
    const res = await patch(`/accounts/${other.id}`, { label: 'hijacked' }, H1)
    expect(res.status).toBe(404)

    // Confirm the other user's row was actually left untouched.
    const stillTheirs = await get(`/accounts/${other.id}`, H2)
    expect((await stillTheirs.json() as Record<string, unknown>).label).toBe('My work mail')
  })

  it('updates just the given field(s), leaving everything else (including the encrypted password) unchanged', async () => {
    const created = await createAccount()
    const before = selectRawAccount(created.id as string)!

    const res = await patch(`/accounts/${created.id}`, { label: 'Renamed' }, H1)
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.label).toBe('Renamed')
    expect(body.imapHost).toBe('imap.example.com')
    expect(body.fromEmail).toBe('me@example.com')

    const after = selectRawAccount(created.id as string)!
    expect(after.imap_password_encrypted).toBe(before.imap_password_encrypted)
    expect(after.smtp_password_encrypted).toBe(before.smtp_password_encrypted)
  })

  it('replaces the stored imap credential when a new imapPassword is provided', async () => {
    const created = await createAccount()
    const before = selectRawAccount(created.id as string)!

    const res = await patch(`/accounts/${created.id}`, { imapPassword: 'brand-new-imap-pw' }, H1)
    expect(res.status).toBe(200)

    const after = selectRawAccount(created.id as string)!
    expect(after.imap_password_encrypted).not.toBe(before.imap_password_encrypted)
    expect(after.imap_password_encrypted).not.toContain('brand-new-imap-pw')
  })

  it('leaves the raw encrypted column byte-for-byte unchanged when imapPassword/smtpPassword are omitted from the PATCH body', async () => {
    const created = await createAccount()
    const before = selectRawAccount(created.id as string)!

    const res = await patch(`/accounts/${created.id}`, { label: 'Just a rename' }, H1)
    expect(res.status).toBe(200)

    const after = selectRawAccount(created.id as string)!
    expect(after.imap_password_encrypted).toBe(before.imap_password_encrypted)
    expect(after.smtp_password_encrypted).toBe(before.smtp_password_encrypted)
  })

  it('never returns a password field in the response', async () => {
    const created = await createAccount()
    const res = await patch(`/accounts/${created.id}`, { label: 'Renamed again' }, H1)
    const body = await res.json()
    assertNoPasswordLeak(body, ['super-secret-imap-pw', 'super-secret-smtp-pw'])
  })

  it('atomically clears the old mirror and resets sync state when IMAP settings change', async () => {
    const created = await createAccount()
    sqlite.prepare(
      'INSERT INTO mail_folders (id, account_id, name, uid_validity, last_seen_uid, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run('folder-old', created.id, 'INBOX', 1, 4, Date.now())
    sqlite.prepare(
      `INSERT INTO mail_messages (
        id, folder_id, imap_uid, to_addresses, date, snippet, body_text, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('message-old', 'folder-old', 4, '[]', Date.now(), 'old', 'old', Date.now())

    const res = await patch(`/accounts/${created.id}`, { imapHost: 'new-imap.example.com' }, H1)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ imapHost: 'new-imap.example.com', syncState: 'pending', lastSyncedAt: null })
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM mail_folders WHERE account_id = ?').get(created.id))
      .toMatchObject({ count: 0 })
  })
})

describe('DELETE /accounts/:id', () => {
  it('returns 401 without a valid token', async () => {
    const res = await del('/accounts/whatever')
    expect(res.status).toBe(401)
  })

  it('returns 404 for a nonexistent id', async () => {
    const res = await del('/accounts/does-not-exist', H1)
    expect(res.status).toBe(404)
  })

  it('returns 404 (not 403) when deleting another user\'s account, and leaves it intact', async () => {
    const other = await createAccount(H2)
    const res = await del(`/accounts/${other.id}`, H1)
    expect(res.status).toBe(404)
    expect(selectRawAccount(other.id as string)).toBeDefined()
  })

  it('deletes the account - a following GET 404s and the raw row is gone', async () => {
    const created = await createAccount()
    const res = await del(`/accounts/${created.id}`, H1)
    expect(res.status).toBe(200)

    const getRes = await get(`/accounts/${created.id}`, H1)
    expect(getRes.status).toBe(404)
    expect(selectRawAccount(created.id as string)).toBeUndefined()
  })
})

describe('POST /accounts/test-connection', () => {
  const testConnBody = {
    imapHost: 'imap.example.com',
    imapPort: 993,
    imapSecurity: 'tls',
    imapUsername: 'me@example.com',
    imapPassword: 'try-me-pw',
  }

  it('returns 401 without a valid token', async () => {
    const res = await post('/accounts/test-connection', testConnBody)
    expect(res.status).toBe(401)
  })

  it('is matched as its own literal route, not treated as GET-style /accounts/:id with id "test-connection"', async () => {
    const res = await post('/accounts/test-connection', testConnBody, H1)
    expect(res.status).not.toBe(404)
  })

  it('returns 200 { ok: true } when the mocked ImapFlow connect() resolves', async () => {
    connectMock.mockResolvedValueOnce(undefined)
    const res = await post('/accounts/test-connection', testConnBody, H1)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  it('maps STARTTLS to a mandatory upgrade and none to an explicit plaintext connection', async () => {
    await post('/accounts/test-connection', { ...testConnBody, imapSecurity: 'starttls' }, H1)
    expect(ImapFlowMock.mock.calls.at(-1)?.[0]).toMatchObject({ secure: false, doSTARTTLS: true })

    await post('/accounts/test-connection', { ...testConnBody, imapSecurity: 'none' }, H1)
    expect(ImapFlowMock.mock.calls.at(-1)?.[0]).toMatchObject({ secure: false, doSTARTTLS: false })
  })

  it('returns 200 { ok: false, error } (not a 4xx/5xx) when the mocked ImapFlow connect() rejects', async () => {
    // The raw underlying error text is never surfaced to the user (it's
    // English/library-specific, e.g. "Command failed") - the route
    // translates it to a fixed Russian message instead. See
    // lib/imapConnection.ts's own localizeImapError.
    connectMock.mockRejectedValueOnce(new Error('Invalid credentials'))
    const res = await post('/accounts/test-connection', testConnBody, H1)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; error?: string }
    expect(body.ok).toBe(false)
    expect(typeof body.error).toBe('string')
    expect(body.error).not.toContain('Invalid credentials')
    expect(body.error).toMatch(/[а-яё]/i)
  })

  it.each([
    ['missing imapHost', { imapHost: undefined }],
    ['missing imapPassword', { imapPassword: undefined }],
    ['invalid imapSecurity', { imapSecurity: 'ssl' }],
    ['imapPort out of range', { imapPort: 0 }],
  ])('returns 400 for %s', async (_label, overrides) => {
    const res = await post('/accounts/test-connection', { ...testConnBody, ...overrides }, H1)
    expect(res.status).toBe(400)
  })
})

describe('POST /accounts/:id/test-connection', () => {
  it('returns 401 without a valid token', async () => {
    const res = await post('/accounts/whatever/test-connection', {})
    expect(res.status).toBe(401)
  })

  it('returns 404 for a nonexistent id', async () => {
    const res = await post('/accounts/does-not-exist/test-connection', {}, H1)
    expect(res.status).toBe(404)
  })

  it('returns 404 (not 403) when testing another user\'s account', async () => {
    const other = await createAccount(H2)
    const res = await post(`/accounts/${other.id}/test-connection`, {}, H1)
    expect(res.status).toBe(404)
  })

  it('tests the already-saved credential using ImapFlow constructed with the stored connection options, without needing one in the body', async () => {
    const created = await createAccount(H1, {
      imapHost: 'stored.imap.example.com',
      imapPort: 993,
      imapUsername: 'stored-user@example.com',
    })
    connectMock.mockResolvedValueOnce(undefined)

    const res = await post(`/accounts/${created.id}/test-connection`, {}, H1)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })

    expect(ImapFlowMock).toHaveBeenCalled()
    const optionsArg = ImapFlowMock.mock.calls.at(-1)?.[0] as Record<string, unknown>
    expect(optionsArg.host).toBe('stored.imap.example.com')
    expect(optionsArg.port).toBe(993)
    // Username may appear top-level or nested under `auth`, depending on
    // how imapConnection.ts shapes ImapFlow's constructor options.
    const flatUsername = optionsArg.user ?? optionsArg.username
    const authUsername = (optionsArg.auth as Record<string, unknown> | undefined)?.user
    expect(flatUsername ?? authUsername).toBe('stored-user@example.com')
  })

  it('propagates a connect() failure as { ok: false, error } for the saved-account variant too', async () => {
    const created = await createAccount()
    connectMock.mockRejectedValueOnce(new Error('Connection timed out'))

    const res = await post(`/accounts/${created.id}/test-connection`, {}, H1)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; error?: string }
    expect(body.ok).toBe(false)
    expect(typeof body.error).toBe('string')
    expect((body.error ?? '').length).toBeGreaterThan(0)
  })

  it('tests unsaved IMAP overrides while retaining the stored password', async () => {
    const created = await createAccount()
    const res = await post(`/accounts/${created.id}/test-connection`, {
      imapHost: 'override.example.com', imapPort: 143,
      imapSecurity: 'starttls', imapUsername: 'override-user@example.com',
    }, H1)
    expect(res.status).toBe(200)
    expect(ImapFlowMock.mock.calls.at(-1)?.[0]).toMatchObject({
      host: 'override.example.com', port: 143, doSTARTTLS: true,
      auth: { user: 'override-user@example.com' },
    })
  })
})
