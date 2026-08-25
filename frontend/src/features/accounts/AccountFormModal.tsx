import { useState } from 'react'
import { Button, Field, Modal, SegmentedControl } from '@zudar107/schloss-ui'
import { CheckCircle2, XCircle } from 'lucide-react'
import { testImapConnection, testSavedMailAccountConnection, type MailAccount, type MailAccountFields, type MailAccountUpdate, type MailSecurity } from '../../lib/api'

const SECURITY_OPTIONS: { value: MailSecurity; label: string }[] = [
  { value: 'tls', label: 'TLS' },
  { value: 'starttls', label: 'STARTTLS' },
  { value: 'none', label: 'Нет' },
]
const SENT_FILING_OPTIONS = [
  { value: 'provider' as const, label: 'Провайдер' },
  { value: 'append' as const, label: 'Herold (APPEND)' },
]

// Most providers pair a security mode with a conventional port -
// used when unchecking "same as IMAP" to seed the now-visible SMTP
// fields with something coherent instead of always defaulting to
// STARTTLS/587 regardless of what the user picked for IMAP.
const SMTP_PORT_FOR_SECURITY: Record<MailSecurity, string> = {
  tls: '465', starttls: '587', none: '25',
}

interface FormState {
  label: string
  imapHost: string
  imapPort: string
  imapSecurity: MailSecurity
  imapUsername: string
  imapPassword: string
  sameAsImap: boolean
  smtpHost: string
  smtpPort: string
  smtpSecurity: MailSecurity
  smtpUsername: string
  smtpPassword: string
  fromName: string
  fromEmail: string
  sentFilingMode: 'provider' | 'append'
}

function initialState(account?: MailAccount): FormState {
  if (!account) {
    return {
      label: '', imapHost: '', imapPort: '993', imapSecurity: 'tls', imapUsername: '', imapPassword: '',
      sameAsImap: true,
      smtpHost: '', smtpPort: '587', smtpSecurity: 'starttls', smtpUsername: '', smtpPassword: '',
      fromName: '', fromEmail: '', sentFilingMode: 'provider',
    }
  }
  return {
    label: account.label,
    imapHost: account.imapHost, imapPort: String(account.imapPort), imapSecurity: account.imapSecurity,
    imapUsername: account.imapUsername, imapPassword: '',
    // Editing always shows its own real SMTP fields - "same as IMAP" is
    // only ever a convenience for filling in a *new* account, not
    // something reconstructed by comparing two already-saved accounts'
    // values (host/username matching could easily be coincidental).
    sameAsImap: false,
    smtpHost: account.smtpHost, smtpPort: String(account.smtpPort), smtpSecurity: account.smtpSecurity,
    smtpUsername: account.smtpUsername, smtpPassword: '',
    fromName: account.fromName, fromEmail: account.fromEmail, sentFilingMode: account.sentFilingMode,
  }
}

export interface AccountFormModalProps {
  open: boolean
  account?: MailAccount
  onClose: () => void
  onSubmit: (fields: MailAccountFields | MailAccountUpdate) => void
  pending: boolean
  error: string | null
}

// Shared by "Подключить аккаунт" (account omitted) and "Изменить" (account
// set). The caller renders this with `key={account?.id ?? 'new'}` so
// switching targets remounts it with fresh state instead of carrying over
// whatever was last typed for a different account.
export function AccountFormModal({ open, account, onClose, onSubmit, pending, error }: AccountFormModalProps) {
  const [form, setForm] = useState(() => initialState(account))
  const [testState, setTestState] = useState<'idle' | 'testing' | 'ok' | 'error'>('idle')
  const [testError, setTestError] = useState('')

  const isEdit = account !== undefined
  const smtp = form.sameAsImap
    ? { host: form.imapHost, port: form.imapPort, security: form.imapSecurity, username: form.imapUsername, password: form.imapPassword }
    : { host: form.smtpHost, port: form.smtpPort, security: form.smtpSecurity, username: form.smtpUsername, password: form.smtpPassword }

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => {
      const next = { ...prev, [key]: value }
      // Most providers (Yandex included) reject sending when the From:
      // address doesn't match the authenticated account, so a mismatch
      // here is a common real-world cause of "send failed", not just a
      // cosmetic default - keep "Email отправителя" following the IMAP
      // login as the user types it, for a *new* account, as long as they
      // haven't diverged it themselves (still blank, or still exactly
      // what the login was before this keystroke).
      if (key === 'imapUsername' && !isEdit && (prev.fromEmail === '' || prev.fromEmail === prev.imapUsername)) {
        next.fromEmail = value as string
      }
      return next
    })
    // Any change invalidates a previous test result - it tested a
    // credential set that no longer matches what would actually be saved.
    setTestState('idle')
  }

  // Unchecking "same as IMAP" reveals the SMTP fields - if they've never
  // been touched yet (still blank), seed their security/port from the
  // IMAP side's own current choice instead of leaving them at a fixed
  // STARTTLS/587 default that may not match what was just picked for
  // IMAP right above.
  function handleSameAsImapChange(checked: boolean) {
    setForm((prev) => {
      if (checked || prev.smtpHost) return { ...prev, sameAsImap: checked }
      return {
        ...prev, sameAsImap: checked,
        smtpSecurity: prev.imapSecurity, smtpPort: SMTP_PORT_FOR_SECURITY[prev.imapSecurity],
      }
    })
    setTestState('idle')
  }

  async function handleTestConnection() {
    setTestState('testing')
    setTestError('')
    try {
      // Editing with the password field left blank means "keep the
      // stored one" - the frontend never has that plaintext to send
      // back, so a saved account with no new password re-tests via the
      // stored-credential endpoint instead of sending one along.
      const result = isEdit && account && !form.imapPassword
        ? await testSavedMailAccountConnection(account.id, {
          imapHost: form.imapHost,
          imapPort: Number(form.imapPort),
          imapSecurity: form.imapSecurity,
          imapUsername: form.imapUsername,
        })
        : await testImapConnection({
          imapHost: form.imapHost,
          imapPort: Number(form.imapPort),
          imapSecurity: form.imapSecurity,
          imapUsername: form.imapUsername,
          imapPassword: form.imapPassword,
        })
      if (result.ok) {
        setTestState('ok')
      } else {
        setTestState('error')
        setTestError(result.error)
      }
    } catch {
      setTestState('error')
      setTestError('Не удалось выполнить проверку')
    }
  }

  function handleSubmit() {
    const fields: MailAccountFields = {
      label: form.label.trim(),
      imapHost: form.imapHost.trim(),
      imapPort: Number(form.imapPort),
      imapSecurity: form.imapSecurity,
      imapUsername: form.imapUsername.trim(),
      imapPassword: form.imapPassword,
      smtpHost: smtp.host.trim(),
      smtpPort: Number(smtp.port),
      smtpSecurity: smtp.security,
      smtpUsername: smtp.username.trim(),
      smtpPassword: smtp.password,
      fromName: form.fromName.trim(),
      fromEmail: form.fromEmail.trim(),
      sentFilingMode: form.sentFilingMode,
    }
    if (!isEdit) {
      onSubmit(fields)
      return
    }
    // Edit: omit both password fields entirely when left blank, so the
    // backend leaves the stored credential untouched instead of
    // overwriting it with an empty string.
    const update: MailAccountUpdate = { ...fields }
    if (!form.imapPassword) delete update.imapPassword
    if (!smtp.password) delete update.smtpPassword
    onSubmit(update)
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? 'Изменить аккаунт' : 'Подключить аккаунт'}
      size="large"
      actions={[
        { label: 'Отмена', onClick: onClose, variant: 'secondary' },
        { label: pending ? 'Сохранение…' : 'Сохранить', onClick: handleSubmit, variant: 'primary' },
      ]}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        {error && <div role="alert" className="inline-error">{error}</div>}

        <Field
          label="Название"
          value={form.label}
          onChange={(e) => update('label', e.target.value)}
          placeholder="Например, Личная почта"
          autoFocus
          disabled={pending}
          maxLength={200}
        />

        <div>
          <h3 style={{ margin: '0 0 0.625rem', fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
            IMAP (входящая почта)
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px', gap: '0.75rem', marginBottom: '0.75rem' }}>
            <Field label="Сервер" value={form.imapHost} onChange={(e) => update('imapHost', e.target.value)} placeholder="imap.example.com" disabled={pending} />
            <Field label="Порт" type="number" value={form.imapPort} onChange={(e) => update('imapPort', e.target.value)} disabled={pending} />
          </div>
          <div style={{ marginBottom: '0.75rem' }}>
            <span className="label">Шифрование</span>
            <SegmentedControl options={SECURITY_OPTIONS} value={form.imapSecurity} onChange={(v) => update('imapSecurity', v)} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <Field label="Логин" value={form.imapUsername} onChange={(e) => update('imapUsername', e.target.value)} disabled={pending} />
            <Field
              label="Пароль"
              type="password"
              value={form.imapPassword}
              onChange={(e) => update('imapPassword', e.target.value)}
              placeholder={isEdit ? 'Оставьте пустым, чтобы не менять' : undefined}
              disabled={pending}
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', marginTop: '0.875rem' }}>
            <Button variant="secondary" onClick={() => void handleTestConnection()} disabled={pending || testState === 'testing' || !form.imapHost || !form.imapUsername}>
              {testState === 'testing' ? 'Проверяем…' : 'Проверить соединение'}
            </Button>
            {testState === 'ok' && (
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', fontSize: '0.8125rem', color: 'var(--success)' }}>
                <CheckCircle2 size={16} />Соединение установлено
              </span>
            )}
            {testState === 'error' && (
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', fontSize: '0.8125rem', color: 'var(--danger)' }}>
                <XCircle size={16} />{testError}
              </span>
            )}
          </div>
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8125rem', color: 'var(--text-secondary)', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={form.sameAsImap}
            onChange={(e) => handleSameAsImapChange(e.target.checked)}
            disabled={pending}
          />
          Исходящая почта (SMTP) совпадает с IMAP
        </label>

        {!form.sameAsImap && (
          <div>
            <h3 style={{ margin: '0 0 0.625rem', fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
              SMTP (исходящая почта)
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px', gap: '0.75rem', marginBottom: '0.75rem' }}>
              <Field label="Сервер" value={form.smtpHost} onChange={(e) => update('smtpHost', e.target.value)} placeholder="smtp.example.com" disabled={pending} />
              <Field label="Порт" type="number" value={form.smtpPort} onChange={(e) => update('smtpPort', e.target.value)} disabled={pending} />
            </div>
            <div style={{ marginBottom: '0.75rem' }}>
              <span className="label">Шифрование</span>
              <SegmentedControl options={SECURITY_OPTIONS} value={form.smtpSecurity} onChange={(v) => update('smtpSecurity', v)} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <Field label="Логин" value={form.smtpUsername} onChange={(e) => update('smtpUsername', e.target.value)} disabled={pending} />
              <Field
                label="Пароль"
                type="password"
                value={form.smtpPassword}
                onChange={(e) => update('smtpPassword', e.target.value)}
                placeholder={isEdit ? 'Оставьте пустым, чтобы не менять' : undefined}
                disabled={pending}
              />
            </div>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
          <Field label="Имя отправителя" value={form.fromName} onChange={(e) => update('fromName', e.target.value)} placeholder="Как будет видно получателям" disabled={pending} />
          <Field label="Email отправителя" type="email" value={form.fromEmail} onChange={(e) => update('fromEmail', e.target.value)} disabled={pending} />
        </div>
        <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          У большинства провайдеров (включая Яндекс) email отправителя должен совпадать с логином IMAP - иначе сервер отклонит отправку.
        </p>
        <div>
          <span className="label">Сохранение отправленных</span>
          <SegmentedControl options={SENT_FILING_OPTIONS} value={form.sentFilingMode} onChange={(v) => update('sentFilingMode', v)} />
          <p style={{ margin: '0.375rem 0 0', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            По умолчанию копию сохраняет почтовый провайдер. APPEND нужен только провайдерам, которые этого не делают.
          </p>
        </div>
      </div>
    </Modal>
  )
}
