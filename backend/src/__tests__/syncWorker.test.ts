import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../db/index.js', async () => await import('./helpers/db.js'))

// A hoisted, stateful ImapFlow mock, extending accounts.test.ts's own
// constructor-function pattern with `list`, `getMailboxLock`, `fetch`, and
// a mutable `mailbox` property the worker reads as a plain property (not a
// return value) right after acquiring a mailbox lock.
//
// `connect` and `getMailboxLock` read `this.__host` / `this.__path` (set by
// the constructor / getMailboxLock itself) so each test can give different
// ImapFlow *instances* (i.e. different accounts, or different folder paths
// within one account) different behavior without relying on call order.
const {
  ImapFlowMock, connectMock, logoutMock, closeMock, listMock, getMailboxLockMock, fetchMock,
  mailboxByPath, listByHost, connectShouldFailForHost,
} = vi.hoisted(() => {
  const mailboxByPath = new Map<string, { uidValidity: bigint; uidNext: number }>()
  const listByHost = new Map<string, unknown[]>()
  const connectShouldFailForHost = new Set<string>()

  const connectMock = vi.fn(async function (this: Record<string, unknown>) {
    if (connectShouldFailForHost.has(this['__host'] as string)) {
      throw new Error(`Connection refused for ${String(this['__host'])}`)
    }
  })
  const logoutMock = vi.fn(async () => undefined)
  const closeMock = vi.fn(async () => undefined)
  const listMock = vi.fn(async function (this: Record<string, unknown>) {
    return listByHost.get(this['__host'] as string) ?? []
  })
  const getMailboxLockMock = vi.fn(async function (this: Record<string, unknown>, path: string) {
    const mb = mailboxByPath.get(path) ?? { uidValidity: 1n, uidNext: 1 }
    this['mailbox'] = mb
    return { release: vi.fn() }
  })
  // Default: no messages. Each test overrides this with its own
  // implementation branching on `query.envelope` (full fetch) vs
  // flags-only fetch.
  const fetchMock = vi.fn((_range: unknown, _query: Record<string, unknown>, _options?: unknown): AsyncGenerator<any, void, unknown> => {
    async function* empty() {}
    return empty()
  })

  const ImapFlowMock = vi.fn().mockImplementation(function (this: Record<string, unknown>, options: { host: string }) {
    Object.assign(this, {
      __host: options.host,
      mailbox: null,
      connect: connectMock,
      logout: logoutMock,
      close: closeMock,
      list: listMock,
      getMailboxLock: getMailboxLockMock,
      fetch: fetchMock,
    })
  })

  return { ImapFlowMock, connectMock, logoutMock, closeMock, listMock, getMailboxLockMock, fetchMock, mailboxByPath, listByHost, connectShouldFailForHost }
})
vi.mock('imapflow', () => ({ ImapFlow: ImapFlowMock }))

import { sqlite, cleanDb } from './helpers/db.js'
import { encryptCredential } from '../lib/credentialCrypto.js'
import { startMailSyncWorker } from '../sync/worker.js'

function asyncIterableFrom<T>(items: T[]) {
  async function* gen() {
    for (const item of items) yield item
  }
  return gen()
}

function ensureUser(id: string, email: string) {
  const existing = sqlite.prepare('SELECT id FROM users WHERE id = ?').get(id)
  if (!existing) {
    sqlite.prepare('INSERT INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?)').run(id, email, email, Date.now())
  }
}

function insertAccount(overrides: Partial<{ id: string; userId: string; imapHost: string; syncState: string }> = {}) {
  const account = { id: 'acc-1', userId: 'user-1', imapHost: 'imap.example.com', syncState: 'pending', ...overrides }
  ensureUser(account.userId, `${account.userId}@example.com`)
  sqlite
    .prepare(
      `INSERT INTO mail_accounts (
        id, user_id, label, imap_host, imap_port, imap_security, imap_username, imap_password_encrypted,
        smtp_host, smtp_port, smtp_security, smtp_username, smtp_password_encrypted,
        from_name, from_email, sync_state, last_synced_at, last_error, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      account.id, account.userId, 'Test account', account.imapHost, 993, 'tls', 'me@example.com', encryptCredential('fake-imap-pw'),
      'smtp.example.com', 465, 'tls', 'me@example.com', encryptCredential('fake-smtp-pw'),
      'Me', 'me@example.com', account.syncState, null, null, Date.now(),
    )
  return account
}

function getRawAccount(id: string) {
  return sqlite.prepare('SELECT * FROM mail_accounts WHERE id = ?').get(id) as {
    sync_state: string; last_synced_at: number | null; last_error: string | null
  } | undefined
}

function insertFolderRaw(overrides: {
  id: string; accountId: string; name: string; specialUse?: string | null; uidValidity: number; lastSeenUid: number
}) {
  sqlite
    .prepare(
      `INSERT INTO mail_folders (id, account_id, name, special_use, uid_validity, last_seen_uid, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(overrides.id, overrides.accountId, overrides.name, overrides.specialUse ?? null, overrides.uidValidity, overrides.lastSeenUid, Date.now())
}

function insertMessageRaw(overrides: { id: string; folderId: string; imapUid: number; subject?: string; bodyText?: string }) {
  sqlite
    .prepare(
      `INSERT INTO mail_messages (
        id, folder_id, imap_uid, message_id, subject, from_address, from_name, to_addresses,
        date, snippet, body_text, flags_seen, flags_flagged, flags_deleted, has_attachments,
        size_bytes, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      overrides.id, overrides.folderId, overrides.imapUid, null, overrides.subject ?? 'Old subject',
      'old@example.com', 'Old Sender', '[]', Date.now(), '', overrides.bodyText ?? 'old body', 0, 0, 0, 0, 100, Date.now(),
    )
}

function getFoldersForAccount(accountId: string) {
  return sqlite.prepare('SELECT * FROM mail_folders WHERE account_id = ?').all(accountId) as Array<{
    id: string; name: string; special_use: string | null; uid_validity: number; last_seen_uid: number
  }>
}

function getMessagesForFolder(folderId: string) {
  return sqlite.prepare('SELECT * FROM mail_messages WHERE folder_id = ?').all(folderId) as Array<{
    id: string; imap_uid: number; subject: string | null; body_text: string; flags_seen: number; flags_flagged: number
    has_attachments: number
  }>
}

function getAttachmentRefsForMessage(messageId: string) {
  return sqlite.prepare('SELECT * FROM mail_attachment_refs WHERE message_id = ?').all(messageId) as Array<{
    id: string; filename: string; mime_type: string; part_id: string
  }>
}

function rfc822(subject: string, bodyText: string) {
  return Buffer.from(
    `From: Alice <alice@example.com>\r\nTo: Bob <bob@example.com>\r\nSubject: ${subject}\r\nDate: Mon, 1 Jan 2026 10:00:00 +0000\r\n\r\n${bodyText}\r\n`,
  )
}

function envelopeFor(uid: number, subject: string) {
  return {
    subject,
    from: [{ name: 'Alice', address: 'alice@example.com' }],
    to: [{ name: 'Bob', address: 'bob@example.com' }],
    date: new Date('2026-01-01T10:00:00Z'),
    messageId: `<${uid}@example.com>`,
  }
}

const plainBodyStructure = { part: '1', type: 'text/plain', size: 50 }

const attachmentBodyStructure = {
  part: '',
  type: 'multipart/mixed',
  childNodes: [
    { part: '1', type: 'text/plain', size: 50 },
    {
      part: '2', type: 'application/pdf', size: 999, disposition: 'attachment',
      dispositionParameters: { filename: 'invoice.pdf' },
    },
  ],
}

async function runOnePass() {
  const worker = startMailSyncWorker()
  await worker.stop()
}

beforeEach(() => {
  cleanDb()
  connectMock.mockClear()
  logoutMock.mockClear()
  closeMock.mockClear()
  listMock.mockClear()
  getMailboxLockMock.mockClear()
  fetchMock.mockReset()
  fetchMock.mockImplementation(() => asyncIterableFrom([]))
  ImapFlowMock.mockClear()
  mailboxByPath.clear()
  listByHost.clear()
  connectShouldFailForHost.clear()
})

describe('folder listing / special-use mapping', () => {
  it('skips \\Noselect folders entirely (not opened, not mirrored)', async () => {
    insertAccount({ id: 'acc-1', imapHost: 'host-a' })
    listByHost.set('host-a', [
      { path: 'INBOX', flags: new Set(), specialUse: undefined },
      { path: '[Gmail]', flags: new Set(['\\Noselect']), specialUse: undefined },
    ])
    mailboxByPath.set('INBOX', { uidValidity: 100n, uidNext: 1 })

    await runOnePass()

    const folders = getFoldersForAccount('acc-1')
    expect(folders.map((f) => f.name)).toEqual(['INBOX'])
    expect(getMailboxLockMock).not.toHaveBeenCalledWith('[Gmail]')
  })

  it('treats a folder whose path is exactly "INBOX" (case-insensitively) as specialUse inbox regardless of server-reported specialUse', async () => {
    insertAccount({ id: 'acc-1', imapHost: 'host-b' })
    listByHost.set('host-b', [
      { path: 'inbox', flags: new Set(), specialUse: undefined },
    ])
    mailboxByPath.set('inbox', { uidValidity: 100n, uidNext: 1 })

    await runOnePass()

    const folders = getFoldersForAccount('acc-1')
    expect(folders).toHaveLength(1)
    expect(folders[0]!.special_use).toBe('inbox')
  })

  it('maps \\Sent/\\Drafts/\\Trash/\\Junk to sent/drafts/trash/junk, and anything else (including undefined) to null', async () => {
    insertAccount({ id: 'acc-1', imapHost: 'host-c' })
    listByHost.set('host-c', [
      { path: 'INBOX', flags: new Set(), specialUse: undefined },
      { path: 'Sent', flags: new Set(), specialUse: '\\Sent' },
      { path: 'Drafts', flags: new Set(), specialUse: '\\Drafts' },
      { path: 'Trash', flags: new Set(), specialUse: '\\Trash' },
      { path: 'Junk', flags: new Set(), specialUse: '\\Junk' },
      { path: 'Archive', flags: new Set(), specialUse: undefined },
      { path: 'Weird', flags: new Set(), specialUse: '\\SomethingElse' },
    ])
    for (const path of ['INBOX', 'Sent', 'Drafts', 'Trash', 'Junk', 'Archive', 'Weird']) {
      mailboxByPath.set(path, { uidValidity: 100n, uidNext: 1 })
    }

    await runOnePass()

    const folders = getFoldersForAccount('acc-1')
    const byName = Object.fromEntries(folders.map((f) => [f.name, f.special_use]))
    expect(byName).toEqual({
      INBOX: 'inbox',
      Sent: 'sent',
      Drafts: 'drafts',
      Trash: 'trash',
      Junk: 'junk',
      Archive: null,
      Weird: null,
    })
  })
})

describe('first-time folder + message sync', () => {
  it('creates the folder row with uid_validity from the mocked mailbox.uidValidity, fetches new messages with the documented query/options, and mirrors them (including body_text via real mailparser parsing)', async () => {
    insertAccount({ id: 'acc-1', imapHost: 'host-d' })
    listByHost.set('host-d', [{ path: 'INBOX', flags: new Set(), specialUse: undefined }])
    mailboxByPath.set('INBOX', { uidValidity: 12345n, uidNext: 2 })

    fetchMock.mockImplementation((_range: unknown, query: Record<string, unknown>) => {
      if (query['envelope']) {
        return asyncIterableFrom([
          {
            uid: 1,
            envelope: envelopeFor(1, 'Test'),
            flags: new Set(['\\Seen']),
            internalDate: new Date('2026-01-01T10:00:00Z'),
            size: 321,
            bodyStructure: plainBodyStructure,
            source: rfc822('Test', 'Hello world, this is the body.'),
          },
        ])
      }
      return asyncIterableFrom([])
    })

    await runOnePass()

    const folders = getFoldersForAccount('acc-1')
    expect(folders).toHaveLength(1)
    expect(Number(folders[0]!.uid_validity)).toBe(12345)
    expect(folders[0]!.last_seen_uid).toBe(1) // uidNext(2) - 1

    // The new-message fetch requested the documented set of fields, uid-mode.
    const fullCall = fetchMock.mock.calls.find((c) => (c[1] as Record<string, unknown>)['envelope'])
    expect(fullCall).toBeDefined()
    expect(fullCall![1]).toMatchObject({
      uid: true, envelope: true, flags: true, internalDate: true, size: true, bodyStructure: true, source: true,
    })
    expect(fullCall![2]).toMatchObject({ uid: true })

    const messages = getMessagesForFolder(folders[0]!.id)
    expect(messages).toHaveLength(1)
    expect(messages[0]!.imap_uid).toBe(1)
    expect(messages[0]!.subject).toBe('Test')
    expect(messages[0]!.body_text).toContain('Hello world, this is the body.')
    expect(Boolean(messages[0]!.flags_seen)).toBe(true)
    expect(Boolean(messages[0]!.has_attachments)).toBe(false)
  })

  it('inserts a mail_attachment_refs row for a message whose bodyStructure has a real attachment leaf, and sets has_attachments', async () => {
    insertAccount({ id: 'acc-1', imapHost: 'host-e' })
    listByHost.set('host-e', [{ path: 'INBOX', flags: new Set(), specialUse: undefined }])
    mailboxByPath.set('INBOX', { uidValidity: 1n, uidNext: 2 })

    fetchMock.mockImplementation((_range: unknown, query: Record<string, unknown>) => {
      if (query['envelope']) {
        return asyncIterableFrom([
          {
            uid: 1,
            envelope: envelopeFor(1, 'Has attachment'),
            flags: new Set(),
            internalDate: new Date('2026-01-01T10:00:00Z'),
            size: 1000,
            bodyStructure: attachmentBodyStructure,
            source: rfc822('Has attachment', 'See attached.'),
          },
        ])
      }
      return asyncIterableFrom([])
    })

    await runOnePass()

    const folder = getFoldersForAccount('acc-1')[0]!
    const messages = getMessagesForFolder(folder.id)
    expect(messages).toHaveLength(1)
    expect(Boolean(messages[0]!.has_attachments)).toBe(true)

    const refs = getAttachmentRefsForMessage(messages[0]!.id)
    expect(refs).toHaveLength(1)
    expect(refs[0]).toMatchObject({ filename: 'invoice.pdf', mime_type: 'application/pdf', part_id: '2' })
  })
})

describe('second pass: no duplicate re-insertion + flags refresh', () => {
  it('does not re-insert already-known UIDs, and updates flags_seen for an already-mirrored message without touching subject/body_text', async () => {
    insertAccount({ id: 'acc-1', imapHost: 'host-f' })
    listByHost.set('host-f', [{ path: 'INBOX', flags: new Set(), specialUse: undefined }])
    // uidNext stays fixed across both passes at 2 - i.e. UID 1 is the only
    // message that will ever exist; pass 2's new-message range (2..1) is
    // empty.
    mailboxByPath.set('INBOX', { uidValidity: 1n, uidNext: 2 })

    fetchMock.mockImplementation((_range: unknown, query: Record<string, unknown>) => {
      if (query['envelope']) {
        return asyncIterableFrom([
          {
            uid: 1,
            envelope: envelopeFor(1, 'Original subject'),
            flags: new Set(),
            internalDate: new Date('2026-01-01T10:00:00Z'),
            size: 500,
            bodyStructure: plainBodyStructure,
            source: rfc822('Original subject', 'Original body text.'),
          },
        ])
      }
      return asyncIterableFrom([])
    })

    await runOnePass()

    const folder = getFoldersForAccount('acc-1')[0]!
    let messages = getMessagesForFolder(folder.id)
    expect(messages).toHaveLength(1)
    expect(Boolean(messages[0]!.flags_seen)).toBe(false)
    expect(messages[0]!.subject).toBe('Original subject')

    // Second pass: the new-message fetch yields nothing (no new UIDs); the
    // flags-only fetch for the already-known UID reports it now \Seen.
    fetchMock.mockImplementation((_range: unknown, query: Record<string, unknown>) => {
      if (query['envelope']) {
        return asyncIterableFrom([])
      }
      return asyncIterableFrom([{ uid: 1, flags: new Set(['\\Seen']) }])
    })

    await runOnePass()

    messages = getMessagesForFolder(folder.id)
    expect(messages).toHaveLength(1) // no duplicate row for uid 1
    expect(Boolean(messages[0]!.flags_seen)).toBe(true) // flags refreshed
    expect(messages[0]!.subject).toBe('Original subject') // subject untouched
    expect(messages[0]!.body_text).toContain('Original body text.') // body untouched

    // The flags-only fetch requested exactly flags (and uid), not
    // envelope/source/bodyStructure.
    const flagsCall = fetchMock.mock.calls.find((c) => !(c[1] as Record<string, unknown>)['envelope'])
    expect(flagsCall).toBeDefined()
    const flagsQuery = flagsCall![1] as Record<string, unknown>
    expect(flagsQuery['uid']).toBe(true)
    expect(flagsQuery['flags']).toBe(true)
    expect(flagsQuery['envelope']).toBeFalsy()
    expect(flagsQuery['source']).toBeFalsy()
    expect(flagsQuery['bodyStructure']).toBeFalsy()
  })
})

describe('UIDVALIDITY change', () => {
  it('wipes the old mirror and resets last_seen_uid to 0 before fetching, when the reported uidValidity differs from the stored one', async () => {
    const account = insertAccount({ id: 'acc-1', imapHost: 'host-g' })
    insertFolderRaw({ id: 'folder-1', accountId: account.id, name: 'INBOX', specialUse: 'inbox', uidValidity: 1000, lastSeenUid: 5 })
    insertMessageRaw({ id: 'old-msg', folderId: 'folder-1', imapUid: 3, subject: 'Stale message' })

    listByHost.set('host-g', [{ path: 'INBOX', flags: new Set(), specialUse: undefined }])
    // Server now reports a different UIDVALIDITY - the old mirror is
    // meaningless.
    mailboxByPath.set('INBOX', { uidValidity: 2000n, uidNext: 51 })

    fetchMock.mockImplementation((_range: unknown, query: Record<string, unknown>) => {
      if (query['envelope']) {
        return asyncIterableFrom([
          {
            uid: 50,
            envelope: envelopeFor(50, 'Fresh after reset'),
            flags: new Set(),
            internalDate: new Date('2026-01-01T10:00:00Z'),
            size: 200,
            bodyStructure: plainBodyStructure,
            source: rfc822('Fresh after reset', 'Brand new body.'),
          },
        ])
      }
      // A flags-only fetch should not happen this pass, since lastSeenUid
      // was reset to 0 before any fetching for this pass - nothing pre-
      // existing to refresh flags for.
      return asyncIterableFrom([{ uid: 999, flags: new Set(['\\Seen']) }])
    })

    await runOnePass()

    const folder = getFoldersForAccount(account.id)[0]!
    expect(Number(folder.uid_validity)).toBe(2000)
    expect(folder.last_seen_uid).toBe(50)

    const messages = getMessagesForFolder(folder.id)
    expect(messages.map((m) => m.id)).not.toContain('old-msg')
    expect(messages).toHaveLength(1)
    expect(messages[0]!.imap_uid).toBe(50)
    expect(messages[0]!.subject).toBe('Fresh after reset')

    const flagsOnlyCalls = fetchMock.mock.calls.filter((c) => !(c[1] as Record<string, unknown>)['envelope'])
    expect(flagsOnlyCalls).toHaveLength(0)
  })
})

describe('account sync_state / last_synced_at / last_error', () => {
  it('sets sync_state to ok, last_synced_at non-null, last_error null after a successful pass', async () => {
    insertAccount({ id: 'acc-1', imapHost: 'host-h', syncState: 'pending' })
    listByHost.set('host-h', [])

    await runOnePass()

    const row = getRawAccount('acc-1')!
    expect(row.sync_state).toBe('ok')
    expect(row.last_synced_at).not.toBeNull()
    expect(row.last_error).toBeNull()
  })

  it('failure isolation: one account failing to connect gets sync_state error with last_error set, while a second, healthy account still syncs to ok in the same pass', async () => {
    insertAccount({ id: 'acc-fail', imapHost: 'host-fail', syncState: 'pending' })
    insertAccount({ id: 'acc-ok', imapHost: 'host-ok', syncState: 'pending' })
    connectShouldFailForHost.add('host-fail')
    listByHost.set('host-fail', [])
    listByHost.set('host-ok', [])

    await runOnePass()

    const failRow = getRawAccount('acc-fail')!
    expect(failRow.sync_state).toBe('error')
    expect(failRow.last_error).not.toBeNull()
    expect(typeof failRow.last_error).toBe('string')

    const okRow = getRawAccount('acc-ok')!
    expect(okRow.sync_state).toBe('ok')
    expect(okRow.last_error).toBeNull()
  })
})
