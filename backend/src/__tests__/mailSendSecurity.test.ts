import { describe, expect, it, vi } from 'vitest'

const { createTransportMock, sendTransportMock } = vi.hoisted(() => {
  const sendTransportMock = vi.fn(async () => undefined)
  const createTransportMock = vi.fn(() => ({ sendMail: sendTransportMock, close: vi.fn() }))
  return { createTransportMock, sendTransportMock }
})
vi.mock('nodemailer', () => ({ default: { createTransport: createTransportMock } }))
vi.mock('../lib/outboundResolver.js', () => ({
  resolveOutboundHost: vi.fn(async () => ({ address: '8.8.8.8', family: 4, lookup: vi.fn() })),
}))

import { encryptCredential } from '../lib/credentialCrypto.js'
import { sendMail } from '../lib/mailSend.js'
import type { MailAccount } from '../db/schema.js'

function account(security: MailAccount['smtpSecurity']): MailAccount {
  return {
    id: 'account', userId: 'user', label: 'Mail',
    imapHost: 'imap.example.com', imapPort: 993, imapSecurity: 'tls',
    imapUsername: 'me@example.com', imapPasswordEncrypted: encryptCredential('imap-password'),
    smtpHost: 'smtp.example.com', smtpPort: 587, smtpSecurity: security,
    smtpUsername: 'me@example.com', smtpPasswordEncrypted: encryptCredential('smtp-password'),
    fromName: 'Me', fromEmail: 'me@example.com', sentFilingMode: 'provider',
    syncState: 'pending', lastSyncedAt: null, lastError: null, createdAt: new Date(),
  }
}

describe('SMTP transport security', () => {
  it('pins the validated address while retaining the hostname for TLS', async () => {
    await sendMail(account('starttls'), { to: ['you@example.com'], subject: 'Hello', bodyText: 'Body' })
    expect(createTransportMock).toHaveBeenCalledWith(expect.objectContaining({
      host: '8.8.8.8', secure: false, requireTLS: true,
      tls: { servername: 'smtp.example.com' },
    }))
    expect(sendTransportMock).toHaveBeenCalledTimes(1)
  })
})
