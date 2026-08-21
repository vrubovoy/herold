import { useState } from 'react'
import { Field, Modal } from '@zudar107/schloss-ui'
import { sendMailMessage, type MailAccount } from '../../lib/api'

export type ComposeMode = 'new' | 'reply' | 'replyAll' | 'forward'

const TITLES: Record<ComposeMode, string> = {
  new: 'Новое письмо',
  reply: 'Ответ',
  replyAll: 'Ответ всем',
  forward: 'Переслать',
}

// Pre-filled values the caller (MailPage) computes from the message being
// replied to/forwarded - a fresh compose passes only accountId/mode.
export interface ComposeInitial {
  accountId: string
  mode: ComposeMode
  to?: string
  cc?: string
  subject?: string
  bodyText?: string
  inReplyTo?: string
}

function splitAddresses(raw: string): string[] {
  return raw.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean)
}

export interface ComposeModalProps {
  open: boolean
  accounts: MailAccount[]
  initial: ComposeInitial
  onClose: () => void
  onSent: () => void
}

// The caller renders this with `key` derived from `initial` (mode + which
// message, if any) so switching what's being composed remounts it with
// fresh state instead of carrying over a previous draft's text.
export function ComposeModal({ open, accounts, initial, onClose, onSent }: ComposeModalProps) {
  const [accountId, setAccountId] = useState(initial.accountId)
  const [to, setTo] = useState(initial.to ?? '')
  const [cc, setCc] = useState(initial.cc ?? '')
  const [bcc, setBcc] = useState('')
  const [subject, setSubject] = useState(initial.subject ?? '')
  const [bodyText, setBodyText] = useState(initial.bodyText ?? '')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSend() {
    const toList = splitAddresses(to)
    if (toList.length === 0) {
      setError('Укажите хотя бы одного получателя')
      return
    }
    if (!bodyText.trim()) {
      setError('Текст письма не может быть пустым')
      return
    }
    setPending(true)
    setError(null)
    try {
      await sendMailMessage(accountId, {
        to: toList,
        cc: cc ? splitAddresses(cc) : undefined,
        bcc: bcc ? splitAddresses(bcc) : undefined,
        subject: subject.trim() || undefined,
        bodyText,
        inReplyTo: initial.inReplyTo,
      })
      onSent()
    } catch {
      setError('Не удалось отправить письмо')
    } finally {
      setPending(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={TITLES[initial.mode]}
      size="large"
      actions={[
        { label: 'Отмена', onClick: onClose, variant: 'secondary' },
        { label: pending ? 'Отправка…' : 'Отправить', onClick: () => void handleSend(), variant: 'primary' },
      ]}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {error && <div role="alert" className="inline-error">{error}</div>}

        {accounts.length > 1 && (
          <Field as="select" label="Отправитель" value={accountId} onChange={(e) => setAccountId(e.target.value)} disabled={pending}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.label} ({a.fromEmail})</option>
            ))}
          </Field>
        )}

        <Field
          label="Кому"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder="user@example.com, ещё@example.com"
          disabled={pending}
          autoFocus
        />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
          <Field label="Копия" value={cc} onChange={(e) => setCc(e.target.value)} disabled={pending} />
          <Field label="Скрытая копия" value={bcc} onChange={(e) => setBcc(e.target.value)} disabled={pending} />
        </div>
        <Field label="Тема" value={subject} onChange={(e) => setSubject(e.target.value)} disabled={pending} />

        <div>
          <span className="label">Текст письма</span>
          <textarea
            value={bodyText}
            onChange={(e) => setBodyText(e.target.value)}
            disabled={pending}
            rows={12}
            style={{
              width: '100%', resize: 'vertical', padding: '0.75rem', borderRadius: 8,
              border: '1px solid var(--border)', background: 'var(--bg-surface)', color: 'var(--text-primary)',
              fontSize: '0.875rem', fontFamily: 'var(--font-sans)', outline: 'none',
            }}
          />
        </div>
      </div>
    </Modal>
  )
}
