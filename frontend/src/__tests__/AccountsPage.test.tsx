import { describe, expect, it, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AccountsPage } from '../features/accounts/AccountsPage'

vi.mock('../lib/api', () => ({
  getMailAccounts: vi.fn(),
  createMailAccount: vi.fn(),
  updateMailAccount: vi.fn(),
  deleteMailAccount: vi.fn(),
  testImapConnection: vi.fn(),
  testSavedMailAccountConnection: vi.fn(),
}))

import {
  getMailAccounts,
  createMailAccount,
  updateMailAccount,
  deleteMailAccount,
  type MailAccount,
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
  smtpUsername: 'smtp-user@example.com',
  fromName: 'User Name',
  fromEmail: 'user@example.com',
  syncState: 'pending',
  lastSyncedAt: null,
  lastError: null,
  createdAt: '2026-08-19T10:00:00.000Z',
}

const secondAccount: MailAccount = {
  ...sampleAccount,
  id: 'acc-2',
  label: 'Рабочая почта',
  imapHost: 'imap.work.example.com',
  imapUsername: 'work-user@example.com',
}

beforeEach(() => {
  vi.mocked(getMailAccounts).mockReset()
  vi.mocked(createMailAccount).mockReset()
  vi.mocked(updateMailAccount).mockReset()
  vi.mocked(deleteMailAccount).mockReset()
})

async function waitForLoadingToFinish() {
  await waitFor(() => expect(screen.queryByText('Загрузка…')).not.toBeInTheDocument())
}

describe('AccountsPage — loading state', () => {
  it('shows a loading indicator while getMailAccounts is pending', () => {
    vi.mocked(getMailAccounts).mockReturnValue(new Promise(() => {}))
    render(<AccountsPage />, { wrapper: createWrapper() })

    expect(screen.getByText(/Загрузка/)).toBeInTheDocument()
  })
})

describe('AccountsPage — error state', () => {
  it('shows an error message with a retry action that re-fetches on click', async () => {
    const user = userEvent.setup()
    vi.mocked(getMailAccounts).mockRejectedValue(new Error('network down'))
    render(<AccountsPage />, { wrapper: createWrapper() })

    await screen.findByText(/Не удалось/i)
    expect(getMailAccounts).toHaveBeenCalledTimes(1)

    vi.mocked(getMailAccounts).mockResolvedValueOnce([])
    const retryButton = screen.getByRole('button', { name: /Повтор/i })
    await user.click(retryButton)

    await waitFor(() => expect(getMailAccounts).toHaveBeenCalledTimes(2))
  })
})

describe('AccountsPage — empty state', () => {
  it('shows an invitation to connect an account with a "Подключить" action', async () => {
    vi.mocked(getMailAccounts).mockResolvedValue([])
    render(<AccountsPage />, { wrapper: createWrapper() })

    await screen.findByText(/Аккаунтов пока нет/i)
    // Two "Подключить..." buttons exist in this state - the page header
    // one and the empty-state one - `getAllByRole` confirms at least one
    // exists without over-specifying which.
    const connectButtons = screen.getAllByRole('button', { name: /Подключить/i })
    expect(connectButtons.length).toBeGreaterThanOrEqual(1)
  })
})

describe('AccountsPage — populated list', () => {
  it("shows each account's label, and imapHost/imapUsername for at least one", async () => {
    vi.mocked(getMailAccounts).mockResolvedValue([sampleAccount, secondAccount])
    render(<AccountsPage />, { wrapper: createWrapper() })

    await screen.findByText(sampleAccount.label)
    expect(screen.getByText(secondAccount.label)).toBeInTheDocument()

    // At least one account row shows its imapHost/imapUsername somewhere.
    const bodyText = document.body.textContent ?? ''
    expect(bodyText).toContain(sampleAccount.imapHost)
    expect(bodyText).toContain(sampleAccount.imapUsername)
  })
})

describe('AccountsPage — open create form', () => {
  it('opens the create form when the header "Подключить аккаунт" button is clicked', async () => {
    const user = userEvent.setup()
    vi.mocked(getMailAccounts).mockResolvedValue([sampleAccount])
    render(<AccountsPage />, { wrapper: createWrapper() })
    await screen.findByText(sampleAccount.label)

    // Only the header button exists in the populated-list render (no
    // empty-state one competing for the same accessible name).
    await user.click(screen.getByRole('button', { name: /Подключить аккаунт/i }))

    expect(await screen.findByLabelText('Название')).toBeInTheDocument()
    expect(screen.getByLabelText('Сервер')).toBeInTheDocument()
  })
})

describe('AccountsPage — create submits and refreshes', () => {
  it('submits the filled-in required fields via createMailAccount and refetches the list', async () => {
    const user = userEvent.setup()
    vi.mocked(getMailAccounts).mockResolvedValue([])
    vi.mocked(createMailAccount).mockResolvedValue(sampleAccount)
    render(<AccountsPage />, { wrapper: createWrapper() })
    await waitForLoadingToFinish()

    await user.click(screen.getAllByRole('button', { name: /Подключить/i })[0])

    await user.type(await screen.findByLabelText('Название'), 'Test Account')
    await user.type(screen.getByLabelText('Сервер'), 'imap.example.com')
    await user.type(screen.getByLabelText('Логин'), 'user@example.com')
    await user.type(screen.getByLabelText('Пароль'), 'pw123456')
    await user.type(screen.getByLabelText('Имя отправителя'), 'User')
    await user.type(screen.getByLabelText('Email отправителя'), 'user@example.com')

    const callsBefore = vi.mocked(getMailAccounts).mock.calls.length
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))

    await waitFor(() => expect(createMailAccount).toHaveBeenCalledTimes(1))
    expect(createMailAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        label: 'Test Account',
        imapHost: 'imap.example.com',
        imapUsername: 'user@example.com',
        imapPassword: 'pw123456',
        fromName: 'User',
        fromEmail: 'user@example.com',
      }),
    )

    // The list is refreshed after a successful create - either via a
    // refetch (another getMailAccounts call) or by the mutation's own
    // result being reflected; assert the refetch actually happened.
    await waitFor(() =>
      expect(vi.mocked(getMailAccounts).mock.calls.length).toBeGreaterThan(callsBefore),
    )
  })
})

describe('AccountsPage — delete', () => {
  it('calls deleteMailAccount with the row\'s id when its delete action is clicked', async () => {
    const user = userEvent.setup()
    vi.mocked(getMailAccounts).mockResolvedValue([sampleAccount])
    vi.mocked(deleteMailAccount).mockResolvedValue({ ok: true })
    render(<AccountsPage />, { wrapper: createWrapper() })
    await screen.findByText(sampleAccount.label)

    const deleteButton = screen.getByRole('button', { name: /Отключ|Удал/i })
    await user.click(deleteButton)

    await waitFor(() => expect(deleteMailAccount).toHaveBeenCalledWith(sampleAccount.id))
  })
})

describe('AccountsPage — edit opens pre-filled', () => {
  it("opens the form pre-filled with the account's existing label and imapHost", async () => {
    const user = userEvent.setup()
    vi.mocked(getMailAccounts).mockResolvedValue([sampleAccount])
    render(<AccountsPage />, { wrapper: createWrapper() })
    await screen.findByText(sampleAccount.label)

    const editButton = screen.getByRole('button', { name: /Изменить|Редактир/i })
    await user.click(editButton)

    expect(await screen.findByDisplayValue(sampleAccount.label)).toBeInTheDocument()
    expect(screen.getByDisplayValue(sampleAccount.imapHost)).toBeInTheDocument()
  })
})
