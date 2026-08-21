import { describe, expect, it, beforeEach, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
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
  updateMailMessageFlags: vi.fn(),
  deleteMailMessage: vi.fn(),
}))

import {
  getMailAccounts, getMailFolders, getFolderMessages, getMailMessage,
  updateMailMessageFlags, deleteMailMessage,
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
  vi.mocked(updateMailMessageFlags).mockReset()
  vi.mocked(deleteMailMessage).mockReset()
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
    expect(getFolderMessages).toHaveBeenCalledWith(inboxFolder.id, undefined)

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

// Helper shared by the new describe blocks below: extracts the search
// object a navigate() call was made with, mirroring the two-phase
// pattern already established by "MailPage — opening a message" above -
// clicking navigates, and the resulting search state is what needs to be
// fed back into mockUseSearch on a fresh render to observe what happens
// once the URL "has" that state.
function extractNavSearch(navArg: unknown): Record<string, unknown> {
  const arg = navArg as { search?: Record<string, unknown> } | Record<string, unknown>
  return ('search' in arg ? arg.search : arg) as Record<string, unknown>
}

describe('MailPage — search box filters the message list', () => {
  it('typing a query and pressing Enter navigates with a search state containing q, and once applied fetches messages with that query', async () => {
    const user = userEvent.setup()
    vi.mocked(getMailAccounts).mockResolvedValue([sampleAccount])
    vi.mocked(getMailFolders).mockResolvedValue([inboxFolder])
    vi.mocked(getFolderMessages).mockResolvedValue({ messages: [unreadMessage, readMessage], total: 2 })

    const { unmount } = render(<MailPage />, { wrapper: createWrapper() })
    await screen.findByText(unreadMessage.subject!)

    let input: HTMLElement
    try {
      input = screen.getByRole('searchbox')
    } catch {
      input = screen.getByPlaceholderText(/поиск|тема|отправител/i)
    }
    await user.type(input, 'invoice{Enter}')

    await waitFor(() => expect(mockNavigate).toHaveBeenCalled())
    const navArg = mockNavigate.mock.calls.at(-1)?.[0]
    const nextSearch = extractNavSearch(navArg)
    expect(nextSearch).toMatchObject({ q: 'invoice' })
    unmount()

    vi.mocked(getFolderMessages).mockReset()
    vi.mocked(getFolderMessages).mockResolvedValue({ messages: [unreadMessage], total: 1 })
    mockUseSearch.mockReturnValue(nextSearch)
    render(<MailPage />, { wrapper: createWrapper() })

    await waitFor(() =>
      expect(getFolderMessages).toHaveBeenCalledWith(inboxFolder.id, expect.objectContaining({ q: 'invoice' })),
    )
  })
})

describe('MailPage — star/flag toggle on a message row', () => {
  it('clicking the flag control on a row toggles flagsFlagged via updateMailMessageFlags, without navigating into the message', async () => {
    const user = userEvent.setup()
    vi.mocked(getMailAccounts).mockResolvedValue([sampleAccount])
    vi.mocked(getMailFolders).mockResolvedValue([inboxFolder])
    vi.mocked(getFolderMessages).mockResolvedValue({ messages: [unreadMessage, readMessage], total: 2 })
    vi.mocked(updateMailMessageFlags).mockResolvedValue({ ...unreadMessage, flagsFlagged: true })

    render(<MailPage />, { wrapper: createWrapper() })
    const subjectEl = await screen.findByText(unreadMessage.subject!)

    // Walk up from the subject text looking for a row-scoped clickable
    // flag/star control (a smaller nested button distinct from the
    // full-row "open message" click target). Prefer one whose accessible
    // name mentions the flag concept; fall back to the first nested
    // button found within the row ancestry otherwise.
    let flagButton: HTMLElement | null = null
    let node: HTMLElement | null = subjectEl
    for (let i = 0; i < 8 && node && !flagButton; i++) {
      const named = within(node).queryAllByRole('button', { name: /флаж|звезд|star|flag/i })
      if (named.length > 0) flagButton = named[0]
      node = node.parentElement
    }
    if (!flagButton) {
      node = subjectEl
      for (let i = 0; i < 8 && node && !flagButton; i++) {
        const buttons = within(node).queryAllByRole('button')
        if (buttons.length > 0) flagButton = buttons[0]
        node = node.parentElement
      }
    }
    expect(flagButton).not.toBeNull()

    await user.click(flagButton!)

    await waitFor(() =>
      expect(updateMailMessageFlags).toHaveBeenCalledWith(
        unreadMessage.id,
        expect.objectContaining({ flagsFlagged: true }),
      ),
    )
    expect(mockNavigate).not.toHaveBeenCalled()
  })
})

describe('MailPage — auto-marks a message as read when opened', () => {
  it('opening an unread message calls updateMailMessageFlags with flagsSeen: true', async () => {
    const user = userEvent.setup()
    vi.mocked(getMailAccounts).mockResolvedValue([sampleAccount])
    vi.mocked(getMailFolders).mockResolvedValue([inboxFolder])
    vi.mocked(getFolderMessages).mockResolvedValue({ messages: [unreadMessage, readMessage], total: 2 })
    vi.mocked(getMailMessage).mockResolvedValue(messageDetail)
    vi.mocked(updateMailMessageFlags).mockResolvedValue({ ...unreadMessage, flagsSeen: true })

    const { unmount } = render(<MailPage />, { wrapper: createWrapper() })
    const row = await screen.findByText(unreadMessage.subject!)
    await user.click(row)

    await waitFor(() => expect(mockNavigate).toHaveBeenCalled())
    const nextSearch = extractNavSearch(mockNavigate.mock.calls.at(-1)?.[0])
    unmount()

    mockUseSearch.mockReturnValue(nextSearch)
    render(<MailPage />, { wrapper: createWrapper() })

    await waitFor(() => expect(getMailMessage).toHaveBeenCalledWith(unreadMessage.id))
    await screen.findByText(messageDetail.bodyText)

    await waitFor(() =>
      expect(updateMailMessageFlags).toHaveBeenCalledWith(
        unreadMessage.id,
        expect.objectContaining({ flagsSeen: true }),
      ),
    )
  })

  it('opening an already-read message does not auto-mark it as read again', async () => {
    const user = userEvent.setup()
    vi.mocked(getMailAccounts).mockResolvedValue([sampleAccount])
    vi.mocked(getMailFolders).mockResolvedValue([inboxFolder])
    vi.mocked(getFolderMessages).mockResolvedValue({ messages: [unreadMessage, readMessage], total: 2 })
    const readDetail: MailMessageDetail = {
      ...messageDetail,
      id: readMessage.id,
      subject: readMessage.subject,
      flagsSeen: true,
    }
    vi.mocked(getMailMessage).mockResolvedValue(readDetail)

    const { unmount } = render(<MailPage />, { wrapper: createWrapper() })
    const row = await screen.findByText(readMessage.subject!)
    await user.click(row)

    await waitFor(() => expect(mockNavigate).toHaveBeenCalled())
    const nextSearch = extractNavSearch(mockNavigate.mock.calls.at(-1)?.[0])
    unmount()

    mockUseSearch.mockReturnValue(nextSearch)
    render(<MailPage />, { wrapper: createWrapper() })

    await waitFor(() => expect(getMailMessage).toHaveBeenCalledWith(readMessage.id))
    await screen.findByText(readDetail.bodyText)

    // Give any would-be auto-mark-as-read effect a chance to fire before
    // asserting it never did.
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(updateMailMessageFlags).not.toHaveBeenCalledWith(
      readMessage.id,
      expect.objectContaining({ flagsSeen: true }),
    )
  })
})

describe('MailPage — message detail action buttons', () => {
  async function renderWithDetailOpen() {
    const user = userEvent.setup()
    vi.mocked(getMailAccounts).mockResolvedValue([sampleAccount])
    vi.mocked(getMailFolders).mockResolvedValue([inboxFolder])
    vi.mocked(getFolderMessages).mockResolvedValue({ messages: [unreadMessage, readMessage], total: 2 })
    vi.mocked(getMailMessage).mockResolvedValue(messageDetail)

    const { unmount } = render(<MailPage />, { wrapper: createWrapper() })
    const row = await screen.findByText(unreadMessage.subject!)
    await user.click(row)

    await waitFor(() => expect(mockNavigate).toHaveBeenCalled())
    const nextSearch = extractNavSearch(mockNavigate.mock.calls.at(-1)?.[0])
    unmount()

    mockUseSearch.mockReturnValue(nextSearch)
    render(<MailPage />, { wrapper: createWrapper() })
    await screen.findByText(messageDetail.bodyText)

    return user
  }

  it('clicking "mark as unread" calls updateMailMessageFlags with flagsSeen: false', async () => {
    const user = await renderWithDetailOpen()
    vi.mocked(updateMailMessageFlags).mockResolvedValue({ ...unreadMessage, flagsSeen: false })

    const button = await screen.findByRole('button', { name: /непрочитан/i })
    await user.click(button)

    await waitFor(() =>
      expect(updateMailMessageFlags).toHaveBeenCalledWith(
        messageDetail.id,
        expect.objectContaining({ flagsSeen: false }),
      ),
    )
  })

  it('clicking the flag/star action calls updateMailMessageFlags with the flipped flagsFlagged value', async () => {
    const user = await renderWithDetailOpen()
    const flipped = !messageDetail.flagsFlagged
    vi.mocked(updateMailMessageFlags).mockResolvedValue({ ...unreadMessage, flagsFlagged: flipped })

    const button = await screen.findByRole('button', { name: /флажок/i })
    await user.click(button)

    await waitFor(() =>
      expect(updateMailMessageFlags).toHaveBeenCalledWith(
        messageDetail.id,
        expect.objectContaining({ flagsFlagged: flipped }),
      ),
    )
  })

  it('clicking "delete" calls deleteMailMessage with the message id', async () => {
    const user = await renderWithDetailOpen()
    vi.mocked(deleteMailMessage).mockResolvedValue({ ok: true })

    const button = await screen.findByRole('button', { name: /удалить/i })
    await user.click(button)

    await waitFor(() => expect(deleteMailMessage).toHaveBeenCalledWith(messageDetail.id))
  })
})
