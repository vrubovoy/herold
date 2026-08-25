import nodemailer from 'nodemailer'
import MailComposer from 'nodemailer/lib/mail-composer/index.js'
import { randomUUID } from 'node:crypto'
import { isIP } from 'node:net'
import type { MailAccount } from '../db/schema.js'
import { decryptCredential } from './credentialCrypto.js'
import { resolveOutboundHost } from './outboundResolver.js'

export interface OutgoingMail {
  to: string[]
  cc?: string[]
  bcc?: string[]
  subject: string
  bodyText: string
  // The RFC822 Message-ID of the message being replied to (angle-bracket
  // form, exactly as mirrored in mailMessages.messageId) - References is
  // deliberately derived from this alone rather than tracked as a real
  // growing chain, since mailMessages doesn't store the original
  // message's own References header.
  inReplyTo?: string
}

export interface SentMail {
  messageId: string
  // The exact raw RFC822 bytes handed to the SMTP transport - reused
  // as-is for the best-effort IMAP APPEND to Sent (see
  // features/messages/router.ts), so the mirrored copy is byte-identical
  // to what was actually sent rather than a second, potentially
  // slightly different, re-composition of the same fields.
  raw: Buffer
}

// nodemailer, unlike imapflow (see lib/imapConnection.ts's own comment on
// this same three-way split), can actually force a truly-plaintext-only
// connection - 'none' maps to `ignoreTLS: true` rather than sharing
// 'starttls''s opportunistic-upgrade behavior.
async function transportOptions(account: MailAccount) {
  const resolved = await resolveOutboundHost(account.smtpHost)
  const auth = { user: account.smtpUsername, pass: decryptCredential(account.smtpPasswordEncrypted) }
  const base = {
    // Nodemailer performs its own DNS resolution before opening a socket,
    // so pass the validated address as the host and retain the operator's
    // hostname only for certificate verification/SNI.
    host: resolved.address, port: account.smtpPort, auth,
    connectionTimeout: 20_000, greetingTimeout: 20_000,
    // nodemailer's own default (no cap - effectively unbounded) leaves a
    // stalled connection hanging for a very long time if the server
    // accepts the TCP connection but then never responds mid-transaction
    // (no packets to time out the connect/greeting phases against) - a
    // "Отправка…" button that never resolves reads as the app being
    // frozen, not as a slow server. dnsTimeout guards the lookup itself.
    socketTimeout: 20_000, dnsTimeout: 20_000,
    tls: { servername: isIP(account.smtpHost.replace(/^\[|\]$/g, '')) ? undefined : account.smtpHost },
  }
  switch (account.smtpSecurity) {
    case 'tls': return { ...base, secure: true }
    case 'starttls': return { ...base, secure: false, requireTLS: true }
    case 'none': return { ...base, secure: false, ignoreTLS: true }
  }
}

// Same reasoning as lib/imapConnection.ts's localizeImapError - nodemailer
// throws raw English text, never fit to show a user directly.
export function localizeSmtpError(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: string }).code
    if (code === 'EAUTH') return 'Неверный логин или пароль для SMTP'
    if (code === 'ETIMEDOUT' || code === 'ESOCKET') return 'SMTP-сервер не отвечает - проверьте адрес, порт и шифрование'
    if (code === 'ECONNECTION') return 'Не удалось подключиться к SMTP-серверу - проверьте адрес и порт'
    if (code === 'EDNS') return 'SMTP-сервер не найден - проверьте адрес'
    if (code === 'EENVELOPE') return 'Некорректный адрес отправителя или получателя'
    if (code === 'EOUTBOUND') return 'Адрес SMTP-сервера запрещён политикой безопасности'
  }
  return 'Не удалось отправить письмо. Проверьте настройки SMTP, логин и пароль'
}

export async function sendMail(account: MailAccount, mail: OutgoingMail): Promise<SentMail> {
  const domain = account.fromEmail.split('@')[1] ?? 'herold.local'
  const messageId = `<${randomUUID()}@${domain}>`

  const mailOptions = {
    from: { name: account.fromName, address: account.fromEmail },
    to: mail.to,
    cc: mail.cc,
    bcc: mail.bcc,
    subject: mail.subject,
    text: mail.bodyText,
    messageId,
    inReplyTo: mail.inReplyTo,
    references: mail.inReplyTo ? [mail.inReplyTo] : undefined,
  }

  // Composed once, sent as `raw` rather than handing the same field set to
  // sendMail() a second time to compose internally - guarantees the bytes
  // we later APPEND to Sent are exactly what went out over SMTP.
  const raw = await new MailComposer(mailOptions).compile().build()

  const transport = nodemailer.createTransport(await transportOptions(account))
  try {
    await transport.sendMail({
      raw,
      envelope: { from: account.fromEmail, to: [...mail.to, ...(mail.cc ?? []), ...(mail.bcc ?? [])] },
    })
  } finally {
    transport.close()
  }

  return { messageId, raw }
}
