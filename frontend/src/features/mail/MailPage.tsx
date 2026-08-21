import { useState } from 'react'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertOctagon, FileEdit, Folder as FolderIcon, Inbox as InboxIcon,
  PenSquare, Paperclip, RefreshCw, Send, Trash2,
} from 'lucide-react'
import { EmptyState, formatDate } from '@zudar107/schloss-ui'
import { HeroIllustration } from '../../components/HeroIllustration'
import { MessageDetail } from './MessageDetail'
import { ComposeModal, type ComposeInitial, type ComposeMode } from './ComposeModal'
import { useToast } from '../../hooks/useToast'
import {
  getMailAccounts, getMailFolders, getFolderMessages, getMailMessage,
  type MailFolder, type MailMessageDetail, type MailMessageSummary,
} from '../../lib/api'

const SPECIAL_USE_ICONS: Record<string, React.ReactNode> = {
  inbox: <InboxIcon size={16} />,
  sent: <Send size={16} />,
  drafts: <FileEdit size={16} />,
  trash: <Trash2 size={16} />,
  junk: <AlertOctagon size={16} />,
}

const SPECIAL_USE_LABELS: Record<string, string> = {
  inbox: 'Входящие',
  sent: 'Отправленные',
  drafts: 'Черновики',
  trash: 'Корзина',
  junk: 'Спам',
}

function folderIcon(specialUse: MailFolder['specialUse']) {
  return (specialUse && SPECIAL_USE_ICONS[specialUse]) ?? <FolderIcon size={16} />
}

function folderDisplayName(folder: MailFolder): string {
  return (folder.specialUse && SPECIAL_USE_LABELS[folder.specialUse]) ?? folder.name
}

function withPrefix(prefix: string, subject: string | null): string {
  const s = subject ?? ''
  const already = new RegExp(`^${prefix}:`, 'i').test(s)
  return already ? s : `${prefix}: ${s}`.trim()
}

function quoteBody(message: MailMessageDetail): string {
  const who = message.fromName || message.fromAddress || 'Отправитель'
  const header = message.date ? `${who} (${formatDate(message.date)}) писал(а):` : `${who} писал(а):`
  const quoted = message.bodyText.split('\n').map((line) => `> ${line}`).join('\n')
  return `\n\n${header}\n${quoted}`
}

// Account/folder/message selection lives in the URL (same convention as
// Schrank's own ?folder=), not component state - a shared link or
// browser back/forward lands on the exact same view.
type MailSearch = { account?: string; folder?: string; message?: string }

export function MailPage() {
  const navigate = useNavigate()
  const search = useSearch({ strict: false }) as MailSearch
  const queryClient = useQueryClient()
  const toast = useToast()
  const [compose, setCompose] = useState<ComposeInitial | null>(null)

  const { data: accounts = [], isLoading: accountsLoading } = useQuery({
    queryKey: ['accounts'],
    queryFn: getMailAccounts,
  })

  const accountId = search.account ?? accounts[0]?.id ?? null

  const { data: folders = [], isLoading: foldersLoading } = useQuery({
    queryKey: ['mail-folders', accountId],
    queryFn: () => getMailFolders(accountId!),
    enabled: !!accountId,
  })

  const folderId = search.folder ?? folders.find((f) => f.specialUse === 'inbox')?.id ?? folders[0]?.id ?? null

  const { data: messagesPage, isLoading: messagesLoading, isError: messagesError, refetch: refetchMessages } = useQuery({
    queryKey: ['mail-messages', folderId],
    queryFn: () => getFolderMessages(folderId!),
    enabled: !!folderId,
  })

  const messageId = search.message ?? null
  const { data: message, isLoading: messageLoading } = useQuery({
    queryKey: ['mail-message', messageId],
    queryFn: () => getMailMessage(messageId!),
    enabled: !!messageId,
  })

  function goTo(next: MailSearch) {
    void navigate({ to: '/mail', search: next })
  }

  function openCompose(mode: ComposeMode) {
    if (!accountId) return
    if (mode === 'new') {
      setCompose({ accountId, mode })
      return
    }
    if (!message) return
    if (mode === 'forward') {
      setCompose({ accountId, mode, subject: withPrefix('Fwd', message.subject), bodyText: quoteBody(message) })
      return
    }
    const account = accounts.find((a) => a.id === accountId)
    const cc = mode === 'replyAll'
      ? message.toAddresses
        .map((a) => a.address)
        .filter((addr): addr is string => !!addr && addr !== account?.fromEmail && addr !== message.fromAddress)
        .join(', ')
      : undefined
    setCompose({
      accountId, mode, cc,
      to: message.fromAddress ?? '',
      subject: withPrefix('Re', message.subject),
      bodyText: quoteBody(message),
      inReplyTo: message.messageId ?? undefined,
    })
  }

  function handleComposeSent() {
    setCompose(null)
    toast.showSuccess('Письмо отправлено')
    void queryClient.invalidateQueries({ queryKey: ['mail-messages'] })
  }

  if (accountsLoading) {
    return <div className="empty-wrap"><LoadingMailState /></div>
  }

  if (accounts.length === 0) {
    return (
      <div className="empty-wrap">
        <EmptyState
          illustration={<HeroIllustration size={100} />}
          title="Сначала подключите аккаунт"
          description="Чтобы читать почту, подключите хотя бы один почтовый аккаунт."
          actionLabel="Подключить аккаунт"
          onAction={() => void navigate({ to: '/accounts' })}
        />
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'flex-start' }}>
      <aside style={{ width: 200, flexShrink: 0 }}>
        <button
          type="button"
          onClick={() => openCompose('new')}
          className="btn-ghost"
          style={{
            justifyContent: 'center', gap: '0.5rem', width: '100%', marginBottom: '1rem',
            background: 'var(--accent)', color: 'var(--text-inverted)', border: 'none', fontWeight: 600,
          }}
        >
          <PenSquare size={16} />Написать письмо
        </button>

        {accounts.length > 1 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', marginBottom: '1rem' }}>
            {accounts.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => goTo({ account: a.id })}
                className="btn-ghost"
                style={{
                  justifyContent: 'flex-start', fontWeight: a.id === accountId ? 600 : 500,
                  background: a.id === accountId ? 'var(--accent-muted)' : undefined,
                  color: a.id === accountId ? 'var(--accent-text)' : undefined,
                }}
              >
                {a.label}
              </button>
            ))}
          </div>
        )}

        <nav aria-label="Папки" style={{ display: 'flex', flexDirection: 'column', gap: '0.125rem' }}>
          {foldersLoading && <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', padding: '0.5rem' }}>Загрузка…</div>}
          {folders.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => goTo({ account: accountId!, folder: f.id })}
              className="btn-ghost"
              style={{
                justifyContent: 'flex-start', gap: '0.5rem',
                background: f.id === folderId ? 'var(--accent-muted)' : undefined,
                color: f.id === folderId ? 'var(--accent-text)' : undefined,
              }}
            >
              {folderIcon(f.specialUse)}
              {folderDisplayName(f)}
            </button>
          ))}
        </nav>
      </aside>

      <div style={{ flex: 1, minWidth: 0 }}>
        {messageId ? (
          messageLoading || !message ? (
            <div className="empty-wrap"><LoadingMailState /></div>
          ) : (
            <MessageDetail
              message={message}
              onBack={() => goTo({ account: accountId!, folder: folderId! })}
              onCompose={openCompose}
            />
          )
        ) : (
          <>
            {messagesLoading && <div className="empty-wrap"><LoadingMailState /></div>}

            {messagesError && (
              <div className="empty-wrap" role="alert">
                <EmptyState
                  illustration={<HeroIllustration size={100} />}
                  title="Не удалось загрузить письма"
                  description="Проверьте соединение и попробуйте ещё раз."
                  actionLabel="Повторить"
                  actionIcon={<RefreshCw size={16} />}
                  onAction={() => void refetchMessages()}
                />
              </div>
            )}

            {!messagesLoading && !messagesError && messagesPage?.messages.length === 0 && (
              <EmptyState
                illustration={<HeroIllustration size={100} />}
                title="Писем пока нет"
                description="Здесь появятся письма из этой папки после следующей синхронизации."
                actionLabel="Обновить"
                actionIcon={<RefreshCw size={16} />}
                onAction={() => void refetchMessages()}
              />
            )}

            {!messagesLoading && !messagesError && messagesPage && messagesPage.messages.length > 0 && (
              <div className="card" style={{ overflow: 'hidden' }}>
                {messagesPage.messages.map((m) => (
                  <MessageRow
                    key={m.id}
                    message={m}
                    onOpen={() => goTo({ account: accountId!, folder: folderId!, message: m.id })}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {compose && (
        <ComposeModal
          key={`${compose.mode}-${messageId ?? 'new'}`}
          open
          accounts={accounts}
          initial={compose}
          onClose={() => setCompose(null)}
          onSent={handleComposeSent}
        />
      )}
    </div>
  )
}

function MessageRow({ message, onOpen }: { message: MailMessageSummary; onOpen: () => void }) {
  const unread = !message.flagsSeen
  return (
    <button
      type="button"
      onClick={onOpen}
      style={{
        display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.75rem 1rem', width: '100%',
        border: 'none', borderBottom: '1px solid var(--border)', textAlign: 'left', cursor: 'pointer',
        background: 'transparent', font: 'inherit',
      }}
    >
      <span style={{
        width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
        background: unread ? 'var(--accent)' : 'transparent',
      }} />
      <span style={{
        width: 180, flexShrink: 0, fontSize: '0.8125rem', color: 'var(--text-primary)',
        fontWeight: unread ? 700 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {message.fromName || message.fromAddress || 'Неизвестно'}
      </span>
      <span style={{ flex: 1, minWidth: 0, display: 'flex', gap: '0.5rem', alignItems: 'baseline', overflow: 'hidden' }}>
        <span style={{ fontWeight: unread ? 700 : 400, color: 'var(--text-primary)', fontSize: '0.875rem', flexShrink: 0 }}>
          {message.subject || '(без темы)'}
        </span>
        <span style={{ color: 'var(--text-muted)', fontSize: '0.8125rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {message.snippet}
        </span>
      </span>
      {message.hasAttachments && <Paperclip size={14} color="var(--text-muted)" style={{ flexShrink: 0 }} />}
      {message.date && (
        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', flexShrink: 0, width: 90, textAlign: 'right' }}>
          {formatDate(message.date)}
        </span>
      )}
    </button>
  )
}

// EmptyState itself requires an action, which a bare loading state has
// none of - this mirrors its illustration+title markup directly so
// loading still belongs to the same "mascot + centered text" visual
// family as every other start/empty page instead of falling back to
// unstyled inline text.
function LoadingMailState() {
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
