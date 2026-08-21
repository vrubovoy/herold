// Thin wrapper around @zudar107/schloss-ui's config-driven API client -
// `apiClient` (the raw instance) is also exported so hooks/useAuth.ts can
// share the exact same token state via useAuthProvider's `apiClient` config.
import { createApiClient, ApiError } from '@zudar107/schloss-ui'
import { buildSchluesselLoginUrl } from './authRedirect'

export { ApiError }

export const apiClient = createApiClient({
  base: '/backend',
  // A background request's own refresh-and-retry both failed - the
  // session is genuinely gone, so send the browser to schlussel's
  // hosted login (PKCE) rather than a local /login route this app
  // doesn't have.
  onUnauthorized: () => {
    void buildSchluesselLoginUrl(window.location.pathname).then((url) => {
      window.location.href = url
    })
  },
})

export const setAccessToken = apiClient.setAccessToken
export const getAccessToken = apiClient.getAccessToken

export const api = {
  get: apiClient.get,
  post: apiClient.post,
  put: apiClient.put,
  patch: apiClient.patch,
  delete: apiClient.delete,
}

export type MailSecurity = 'tls' | 'starttls' | 'none'

export interface MailAccount {
  id: string
  label: string
  imapHost: string
  imapPort: number
  imapSecurity: MailSecurity
  imapUsername: string
  smtpHost: string
  smtpPort: number
  smtpSecurity: MailSecurity
  smtpUsername: string
  fromName: string
  fromEmail: string
  syncState: 'pending' | 'ok' | 'error'
  lastSyncedAt: string | null
  lastError: string | null
  createdAt: string
}

// Never round-trips through MailAccount - the backend never returns a
// password, encrypted or otherwise (see the backend's own mailAccountJson).
export interface MailAccountFields {
  label: string
  imapHost: string
  imapPort: number
  imapSecurity: MailSecurity
  imapUsername: string
  imapPassword: string
  smtpHost: string
  smtpPort: number
  smtpSecurity: MailSecurity
  smtpUsername: string
  smtpPassword: string
  fromName: string
  fromEmail: string
}

export type MailAccountUpdate = Partial<MailAccountFields>

export type TestConnectionResult = { ok: true } | { ok: false; error: string }

export function getMailAccounts(): Promise<MailAccount[]> {
  return api.get('/accounts')
}

export function createMailAccount(input: MailAccountFields): Promise<MailAccount> {
  return api.post('/accounts', input)
}

export function updateMailAccount(id: string, input: MailAccountUpdate): Promise<MailAccount> {
  return api.patch(`/accounts/${encodeURIComponent(id)}`, input)
}

export function deleteMailAccount(id: string): Promise<{ ok: true }> {
  return api.delete(`/accounts/${encodeURIComponent(id)}`)
}

export function testImapConnection(input: {
  imapHost: string
  imapPort: number
  imapSecurity: MailSecurity
  imapUsername: string
  imapPassword: string
}): Promise<TestConnectionResult> {
  return api.post('/accounts/test-connection', input)
}

// For the edit form's "Test connection" when the password field was left
// blank ("keep existing") - the frontend never has that plaintext to
// send, so the backend decrypts and tests the already-stored one instead.
export function testSavedMailAccountConnection(id: string): Promise<TestConnectionResult> {
  return api.post(`/accounts/${encodeURIComponent(id)}/test-connection`, {})
}
