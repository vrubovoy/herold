import { describe, expect, it, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MailPage } from '../features/mail/MailPage'

const mockNavigate = vi.fn()
const mockUseSearch = vi.fn(() => ({}) as Record<string, unknown>)
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
  useSearch: () => mockUseSearch(),
}))

vi.mock('../lib/api', () => ({
  getMailAccounts: vi.fn(),
  getMailFolders: vi.fn(),
  getFolderMessages: vi.fn(),
  getMailMessage: vi.fn(),
  fetchAttachmentBlob: vi.fn(),
}))

import {
  getMailAccounts, getMailFolders, getFolderMessages, getMailMessage,
  type MailAccount, type MailFolder, type MailMessageSummary, type MailMessageDetail,
} from '../lib/api'

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

const sampleAccount: MailAccount = {
  id: 'acc-1',
  label: 'Личная почта',
  imapHost: 'imap.example.com',
  imapPort: 993,
  imapSecurity: 'tls',
  imapUsername: 'user@example.com',
  smtpHost: 'smtp.example.com',
  smtpPort: 465,
  smtpSecurity: 'tls',
  smtpUsername: 'user@example.com',
  fromName: 'User Name',
  fromEmail: 'user@example.com',
  syncState: 'ok',
  lastSyncedAt: '2026-08-20T10:00:00.000Z',
  lastError: null,
  createdAt: '2026-08-19T10:00:00.000Z',
}

const inboxFolder: MailFolder = {
  id: 'folder-inbox', name: 'INBOX', specialUse: 'inbox', createdAt: '2026-08-19T10:00:00.000Z',
}
const sentFolder: MailFolder = {
  id: 'folder-sent', name: 'Sent', specialUse: 'sent', createdAt: '2026-08-19T10:00:00.000Z',
}

const unreadMessage: MailMessageSummary = {
  id: 'msg-1',
  subject: 'Unread subject line',
  fromAddress: 'alice@example.com',
  fromName: 'Alice Sender',
  date: '2026-08-20T09:00:00.000Z',
  snippet: 'Unread snippet',
  flagsSeen: false,
  flagsFlagged: false,
  hasAttachments: false,
}

const readMessage: MailMessageSummary = {
  id: 'msg-2',
  subject: 'Read subject line',
  fromAddress: 'bob@example.com',
  fromName: 'Bob Sender',
  date: '2026-08-19T09:00:00.000Z',
  snippet: 'Read snippet',
  flagsSeen: true,
  flagsFlagged: false,
  hasAttachments: false,
}

const messageDetail: MailMessageDetail = {
  id: 'msg-1',
  messageId: '<msg-1@example.com>',
  subject: 'Unread subject line',
  fromAddress: 'alice@example.com',
  fromName: 'Alice Sender',
  toAddresses: [{ name: 'Me', address: 'me@example.com' }],
  date: '2026-08-20T09:00:00.000Z',
  bodyText: 'This is the full body text of the message.',
  flagsSeen: false,
  flagsFlagged: false,
  attachments: [],
  createdAt: '2026-08-20T09:00:00.000Z',
}

beforeEach(() => {
  vi.mocked(getMailAccounts).mockReset()
  vi.mocked(getMailFolders).mockReset()
  vi.mocked(getFolderMessages).mockReset()
  vi.mocked(getMailMessage).mockReset()
  mockNavigate.mockReset()
  mockUseSearch.mockReturnValue({})
})

describe('MailPage — no accounts', () => {
  it('shows an invitation to connect an account, which navigates to /accounts', async () => {
    const user = userEvent.setup()
    vi.mocked(getMailAccounts).mockResolvedValue([])
    render(<MailPage />, { wrapper: createWrapper() })

    expect((await screen.findAllByText(/аккаунт/i)).length).toBeGreaterThanOrEqual(1)
    const actionButton = await screen.findByRole('button', { name: /аккаунт/i })
    await user.click(actionButton)

    await waitFor(() => expect(mockNavigate).toHaveBeenCalled())
    const call = mockNavigate.mock.calls.at(-1)?.[0]
    expect(call).toMatchObject({ to: '/accounts' })
  })
})

describe('MailPage — loads folders and messages for the selected account', () => {
  it('fetches folders for the account, prefers the inbox folder for the message list, and renders message subjects/senders', async () => {
    vi.mocked(getMailAccounts).mockResolvedValue([sampleAccount])
    vi.mocked(getMailFolders).mockResolvedValue([sentFolder, inboxFolder])
    vi.mocked(getFolderMessages).mockResolvedValue({ messages: [unreadMessage, readMessage], total: 2 })

    render(<MailPage />, { wrapper: createWrapper() })

    await screen.findByText(unreadMessage.subject!)

    expect(getMailFolders).toHaveBeenCalledWith(sampleAccount.id)
    expect(getFolderMessages).toHaveBeenCalledWith(inboxFolder.id)

    expect(screen.getByText(unreadMessage.subject!)).toBeInTheDocument()
    expect(screen.getByText(readMessage.subject!)).toBeInTheDocument()
    expect(screen.getByText(unreadMessage.fromName!)).toBeInTheDocument()
    expect(screen.getByText(readMessage.fromName!)).toBeInTheDocument()
  })
})

describe('MailPage — unread vs read visual distinction', () => {
  it('renders some observable visual difference between an unread and a read message row', async () => {
    vi.mocked(getMailAccounts).mockResolvedValue([sampleAccount])
    vi.mocked(getMailFolders).mockResolvedValue([inboxFolder])
    vi.mocked(getFolderMessages).mockResolvedValue({ messages: [unreadMessage, readMessage], total: 2 })

    render(<MailPage />, { wrapper: createWrapper() })

    const unreadEl = await screen.findByText(unreadMessage.subject!)
    const readEl = screen.getByText(readMessage.subject!)

    // Walk up a few ancestors from each text node looking for a rendered
    // difference (inline style, class, or data attribute) between the
    // unread and read rows - whatever mechanism the component actually
    // uses to distinguish them.
    function ancestorSignatures(el: HTMLElement): string[] {
      const sigs: string[] = []
      let node: HTMLElement | null = el
      for (let i = 0; i < 5 && node; i++) {
        sigs.push(`${node.getAttribute('style') ?? ''}|${node.className ?? ''}`)
        node = node.parentElement
      }
      return sigs
    }

    const unreadSigs = ancestorSignatures(unreadEl)
    const readSigs = ancestorSignatures(readEl)
    const anyDifference = unreadSigs.some((sig, i) => sig !== readSigs[i])
    expect(anyDifference).toBe(true)
  })
})

describe('MailPage — opening a message', () => {
  it('clicking a message row navigates to select it, and once selected, fetches and renders its full detail', async () => {
    const user = userEvent.setup()
    vi.mocked(getMailAccounts).mockResolvedValue([sampleAccount])
    vi.mocked(getMailFolders).mockResolvedValue([inboxFolder])
    vi.mocked(getFolderMessages).mockResolvedValue({ messages: [unreadMessage, readMessage], total: 2 })
    vi.mocked(getMailMessage).mockResolvedValue(messageDetail)

    const { unmount } = render(<MailPage />, { wrapper: createWrapper() })
    const row = await screen.findByText(unreadMessage.subject!)
    await user.click(row)

    // Selection lives in the URL (same convention as this app's sibling
    // Schrank frontend's own ?folder= navigation) - clicking asks the
    // router to navigate somewhere that encodes the clicked message's id.
    await waitFor(() => expect(mockNavigate).toHaveBeenCalled())
    const navArg = mockNavigate.mock.calls.at(-1)?.[0] as { search?: Record<string, unknown> } | Record<string, unknown>
    expect(JSON.stringify(navArg)).toContain(unreadMessage.id)
    unmount()

    // Simulate having actually navigated there - re-render with useSearch
    // now reporting exactly what MailPage itself just asked navigate to set.
    const nextSearch = ('search' in navArg ? navArg.search : navArg) as Record<string, unknown>
    mockUseSearch.mockReturnValue(nextSearch)
    render(<MailPage />, { wrapper: createWrapper() })

    await waitFor(() => expect(getMailMessage).toHaveBeenCalledWith(unreadMessage.id))
    await screen.findByText(messageDetail.bodyText)
  })
})

describe('MailPage — message list empty state', () => {
  it('shows a no-messages indication when the folder has none', async () => {
    vi.mocked(getMailAccounts).mockResolvedValue([sampleAccount])
    vi.mocked(getMailFolders).mockResolvedValue([inboxFolder])
    vi.mocked(getFolderMessages).mockResolvedValue({ messages: [], total: 0 })

    render(<MailPage />, { wrapper: createWrapper() })

    await screen.findByText(/нет|пусто/i)
  })
})

describe('MailPage — message list error state', () => {
  it('shows an error with a retry action that re-fetches on click', async () => {
    const user = userEvent.setup()
    vi.mocked(getMailAccounts).mockResolvedValue([sampleAccount])
    vi.mocked(getMailFolders).mockResolvedValue([inboxFolder])
    vi.mocked(getFolderMessages).mockRejectedValue(new Error('network down'))

    render(<MailPage />, { wrapper: createWrapper() })

    await screen.findByText(/не удалось|ошибка/i)
    const callsBefore = vi.mocked(getFolderMessages).mock.calls.length

    vi.mocked(getFolderMessages).mockResolvedValueOnce({ messages: [unreadMessage], total: 1 })
    const retryButton = screen.getByRole('button', { name: /повтор/i })
    await user.click(retryButton)

    await waitFor(() => expect(vi.mocked(getFolderMessages).mock.calls.length).toBeGreaterThan(callsBefore))
  })
})
