import { useState } from 'react'
import {
  ArrowLeft, CornerUpLeft, CornerUpRight, Download, Forward, MailOpen,
  Paperclip, Star, Trash2,
} from 'lucide-react'
import { downloadBlob, formatDate, Modal } from '@zudar107/schloss-ui'
import { useToast } from '../../hooks/useToast'
import { fetchAttachmentBlob, type MailMessageDetail } from '../../lib/api'
import type { ComposeMode } from './ComposeModal'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`
  const units = ['КБ', 'МБ', 'ГБ']
  let value = bytes / 1024
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unitIndex]}`
}

function fromDisplay(message: MailMessageDetail): string {
  if (message.fromName) return `${message.fromName} <${message.fromAddress ?? ''}>`
  return message.fromAddress ?? 'Неизвестный отправитель'
}

function addressListDisplay(addresses: MailMessageDetail['toAddresses']): string {
  if (addresses.length === 0) return '—'
  return addresses.map((a) => a.name ? `${a.name} <${a.address ?? ''}>` : (a.address ?? '')).join(', ')
}

export function MessageDetail({ message, onBack, onCompose, onMarkUnread, onToggleFlag, onDelete }: {
  message: MailMessageDetail
  onBack: () => void
  onCompose: (mode: ComposeMode) => void
  onMarkUnread: () => void
  onToggleFlag: () => void
  onDelete: () => void
}) {
  const toast = useToast()
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  async function handleDownload(attachmentId: string, filename: string) {
    setDownloadingId(attachmentId)
    try {
      const blob = await fetchAttachmentBlob(message.id, attachmentId)
      downloadBlob(blob, filename)
    } catch {
      toast.showError('Не удалось скачать вложение')
    } finally {
      setDownloadingId(null)
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', gap: '0.75rem', flexWrap: 'wrap' }}>
        <button type="button" onClick={onBack} className="btn-ghost" style={{ paddingLeft: '0.5rem' }}>
          <ArrowLeft size={16} />Назад к списку
        </button>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button type="button" onClick={() => onCompose('reply')} className="btn-ghost" style={{ border: '1px solid var(--border)' }}>
            <CornerUpLeft size={14} />Ответить
          </button>
          <button type="button" onClick={() => onCompose('replyAll')} className="btn-ghost" style={{ border: '1px solid var(--border)' }}>
            <CornerUpRight size={14} />Ответить всем
          </button>
          <button type="button" onClick={() => onCompose('forward')} className="btn-ghost" style={{ border: '1px solid var(--border)' }}>
            <Forward size={14} />Переслать
          </button>
          <button type="button" onClick={onToggleFlag} className="btn-ghost" style={{ border: '1px solid var(--border)' }}>
            <Star size={14} fill={message.flagsFlagged ? 'var(--warning)' : 'none'} color={message.flagsFlagged ? 'var(--warning)' : undefined} />
            {message.flagsFlagged ? 'Убрать флажок' : 'Флажок'}
          </button>
          <button type="button" onClick={onMarkUnread} className="btn-ghost" style={{ border: '1px solid var(--border)' }}>
            <MailOpen size={14} />Непрочитано
          </button>
          <button type="button" onClick={() => setConfirmDelete(true)} className="btn-ghost" style={{ border: '1px solid var(--danger)', color: 'var(--danger)' }}>
            <Trash2 size={14} />Удалить
          </button>
        </div>
      </div>

      <div className="card" style={{ padding: '1.5rem' }}>
        <h1 style={{ margin: '0 0 0.75rem', fontSize: '1.125rem', fontWeight: 700, color: 'var(--text-primary)' }}>
          {message.subject || '(без темы)'}
        </h1>

        <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>
          <strong style={{ color: 'var(--text-primary)' }}>От:</strong> {fromDisplay(message)}
        </div>
        <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>
          <strong style={{ color: 'var(--text-primary)' }}>Кому:</strong> {addressListDisplay(message.toAddresses)}
        </div>
        {message.date && (
          <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
            {formatDate(message.date)}
          </div>
        )}

        {message.attachments.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1.25rem' }}>
            {message.attachments.map((att) => (
              <button
                key={att.id}
                type="button"
                onClick={() => void handleDownload(att.id, att.filename)}
                disabled={downloadingId === att.id}
                className="btn-ghost"
                style={{ fontSize: '0.8125rem', border: '1px solid var(--border)' }}
              >
                <Paperclip size={14} />
                {att.filename}
                <span style={{ color: 'var(--text-muted)' }}>({formatBytes(att.sizeBytes)})</span>
                <Download size={14} />
              </button>
            ))}
          </div>
        )}

        <pre style={{
          margin: 0, padding: '1rem', borderRadius: 'var(--radius-md)', background: 'var(--bg-base)',
          fontSize: '0.875rem', lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          color: 'var(--text-primary)', fontFamily: 'var(--font-sans)',
        }}>
          {message.bodyText || '(пустое письмо)'}
        </pre>
      </div>
      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Удалить письмо?"
        actions={[
          { label: 'Отмена', onClick: () => setConfirmDelete(false), variant: 'secondary' },
          { label: 'Удалить', onClick: () => { setConfirmDelete(false); onDelete() }, variant: 'danger' },
        ]}
      >
        Письмо будет перемещено в корзину почтового аккаунта. Если корзина недоступна, удаление будет окончательным.
      </Modal>
    </div>
  )
}
