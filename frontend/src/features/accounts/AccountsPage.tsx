import { useEffect, useState } from 'react'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Inbox, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { Button, EmptyState, Toast } from '@zudar107/schloss-ui'
import { HeroIllustration } from '../../components/HeroIllustration'
import { useToast } from '../../hooks/useToast'
import { AccountFormModal } from './AccountFormModal'
import {
  ApiError, createMailAccount, deleteMailAccount, getMailAccounts, updateMailAccount,
  type MailAccount, type MailAccountFields, type MailAccountUpdate,
} from '../../lib/api'

const SECURITY_LABEL: Record<MailAccount['imapSecurity'], string> = {
  tls: 'TLS', starttls: 'STARTTLS', none: 'без шифрования',
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError && error.status === 400) return 'Проверьте введённые данные'
  return fallback
}

export function AccountsPage() {
  const queryClient = useQueryClient()
  const toast = useToast()
  const navigate = useNavigate()
  const search = useSearch({ strict: false }) as { new?: boolean }
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<MailAccount | undefined>(undefined)

  const { data: accounts = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['accounts'],
    queryFn: getMailAccounts,
  })

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ['accounts'] })
  }

  const createMutation = useMutation({
    mutationFn: (fields: MailAccountFields) => createMailAccount(fields),
    onSuccess: () => {
      setFormOpen(false)
      invalidate()
      toast.showSuccess('Аккаунт подключён')
    },
  })

  const updateMutation = useMutation({
    mutationFn: (input: { id: string; fields: MailAccountUpdate }) => updateMailAccount(input.id, input.fields),
    onSuccess: () => {
      setFormOpen(false)
      setEditing(undefined)
      invalidate()
      toast.showSuccess('Изменения сохранены')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteMailAccount(id),
    onSuccess: () => {
      invalidate()
      toast.showSuccess('Аккаунт отключён')
    },
    onError: () => toast.showError('Не удалось отключить аккаунт'),
  })

  function openCreate() {
    setEditing(undefined)
    createMutation.reset()
    setFormOpen(true)
  }

  function openEdit(account: MailAccount) {
    setEditing(account)
    updateMutation.reset()
    setFormOpen(true)
  }

  function closeForm() {
    setFormOpen(false)
    setEditing(undefined)
  }

  // A "Подключить аккаунт" action elsewhere in the app (MailPage's own
  // empty state, when there's nowhere yet to redirect other than here)
  // links to /accounts?new=true so the create form opens immediately
  // instead of landing on this page and requiring a second click. The
  // param is stripped right after opening so a later refresh/back
  // doesn't keep reopening it.
  useEffect(() => {
    if (search.new) {
      openCreate()
      void navigate({ to: '/accounts', search: {}, replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.new])

  function handleFormSubmit(fields: MailAccountFields | MailAccountUpdate) {
    if (editing) {
      updateMutation.mutate({ id: editing.id, fields: fields as MailAccountUpdate })
    } else {
      createMutation.mutate(fields as MailAccountFields)
    }
  }

  const pending = createMutation.isPending || updateMutation.isPending
  const activeError = editing ? updateMutation.error : createMutation.error
  const formError = activeError ? errorMessage(activeError, 'Не удалось сохранить аккаунт. Попробуйте ещё раз.') : null

  return (
    <div>
      <div style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text-primary)' }}>
            Аккаунты
          </h1>
          <p style={{ margin: '0.25rem 0 0', color: 'var(--text-muted)', fontSize: '0.8125rem' }}>
            Внешние почтовые аккаунты, подключённые по IMAP/SMTP
          </p>
        </div>
        <Button variant="primary" onClick={openCreate}>
          <Plus size={16} />Подключить аккаунт
        </Button>
      </div>

      {isLoading && (
        <div className="empty-wrap">
          <LoadingAccountsState />
        </div>
      )}
      {isError && (
        <div className="empty-wrap" role="alert">
          <ErrorAccountsState onRetry={() => void refetch()} />
        </div>
      )}

      {!isLoading && !isError && accounts.length === 0 && (
        <div className="empty-wrap">
          <EmptyState
            illustration={<HeroIllustration size={100} />}
            title="Аккаунтов пока нет"
            description="Подключите первый почтовый аккаунт, чтобы начать работу с почтой."
            actionLabel="Подключить аккаунт"
            actionIcon={<Plus size={16} />}
            onAction={openCreate}
          />
        </div>
      )}

      {!isLoading && !isError && accounts.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {accounts.map((account) => (
            <AccountRow
              key={account.id}
              account={account}
              onEdit={() => openEdit(account)}
              onDelete={() => deleteMutation.mutate(account.id)}
            />
          ))}
        </div>
      )}

      {formOpen && (
        <AccountFormModal
          key={editing?.id ?? 'new'}
          open
          account={editing}
          onClose={closeForm}
          onSubmit={handleFormSubmit}
          pending={pending}
          error={formError}
        />
      )}

      {toast.toast && (
        <Toast open variant={toast.toast.variant} message={toast.toast.message} onDismiss={toast.dismiss} />
      )}
    </div>
  )
}

function AccountRow({ account, onEdit, onDelete }: {
  account: MailAccount; onEdit: () => void; onDelete: () => void
}) {
  return (
    <div className="card" style={{ padding: '1rem 1.25rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
      <div style={{
        width: 40, height: 40, borderRadius: 10, background: 'var(--accent-muted)', color: 'var(--accent)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>
        <Inbox size={18} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '0.9375rem', fontWeight: 600, color: 'var(--text-primary)' }}>{account.label}</div>
        <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
          {account.imapUsername} · {account.imapHost}:{account.imapPort} ({SECURITY_LABEL[account.imapSecurity]})
        </div>
        {account.syncState === 'error' && account.lastError && (
          <div style={{ fontSize: '0.75rem', color: 'var(--danger)', marginTop: '0.25rem' }}>{account.lastError}</div>
        )}
      </div>
      <div style={{ display: 'flex', gap: '0.25rem', flexShrink: 0 }}>
        <IconActionButton onClick={onEdit} label={`Изменить «${account.label}»`}><Pencil size={15} /></IconActionButton>
        <IconActionButton onClick={onDelete} danger label={`Отключить «${account.label}»`}><Trash2 size={15} /></IconActionButton>
      </div>
    </div>
  )
}

// EmptyState itself requires an action, which a bare loading state has
// none of - this mirrors its illustration+title markup directly so
// loading still belongs to the same "mascot + centered text" visual
// family as every other start/empty page instead of falling back to
// unstyled inline text.
function LoadingAccountsState() {
  return (
    <div style={{ textAlign: 'center', padding: '4rem 2rem', maxWidth: 440, margin: '0 auto' }}>
      <div style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        padding: '1.5rem', borderRadius: 'var(--radius-lg)', background: 'var(--accent-muted)',
        margin: '0 auto 1.25rem',
      }}>
        <HeroIllustration size={100} />
      </div>
      <h2 style={{ margin: 0, color: 'var(--text-primary)', fontSize: '1.125rem', fontWeight: 600 }}>Загрузка…</h2>
    </div>
  )
}

function ErrorAccountsState({ onRetry }: { onRetry: () => void }) {
  return (
    <EmptyState
      illustration={<HeroIllustration size={100} />}
      title="Не удалось загрузить аккаунты"
      description="Проверьте соединение и попробуйте ещё раз."
      actionLabel="Повторить"
      actionIcon={<RefreshCw size={16} />}
      onAction={onRetry}
    />
  )
}

function IconActionButton({ onClick, danger, disabled, label, children }: {
  onClick: () => void; danger?: boolean; disabled?: boolean; label: string; children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick() }}
      aria-label={label}
      title={label}
      disabled={disabled}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28,
        border: 0, background: 'transparent', color: danger ? 'var(--danger)' : 'var(--text-secondary)',
        cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1, borderRadius: 7, flexShrink: 0,
      }}
    >
      {children}
    </button>
  )
}
