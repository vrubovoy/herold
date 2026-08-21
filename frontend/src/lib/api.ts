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

export interface MailFolder {
  id: string
  name: string
  specialUse: 'inbox' | 'sent' | 'drafts' | 'trash' | 'junk' | null
  createdAt: string
}

export interface MailAddress {
  name?: string
  address?: string
}

export interface MailMessageSummary {
  id: string
  subject: string | null
  fromAddress: string | null
  fromName: string | null
  date: string | null
  snippet: string
  flagsSeen: boolean
  flagsFlagged: boolean
  hasAttachments: boolean
}

export interface MailAttachment {
  id: string
  filename: string
  mimeType: string
  sizeBytes: number
}

export interface MailMessageDetail {
  id: string
  subject: string | null
  fromAddress: string | null
  fromName: string | null
  toAddresses: MailAddress[]
  date: string | null
  bodyText: string
  flagsSeen: boolean
  flagsFlagged: boolean
  attachments: MailAttachment[]
  createdAt: string
}

export function getMailFolders(accountId: string): Promise<MailFolder[]> {
  return api.get(`/accounts/${encodeURIComponent(accountId)}/folders`)
}

export function getFolderMessages(
  folderId: string,
  params?: { limit?: number; offset?: number },
): Promise<{ messages: MailMessageSummary[]; total: number }> {
  const query = new URLSearchParams()
  if (params?.limit) query.set('limit', String(params.limit))
  if (params?.offset) query.set('offset', String(params.offset))
  const qs = query.toString()
  return api.get(`/folders/${encodeURIComponent(folderId)}/messages${qs ? `?${qs}` : ''}`)
}

export function getMailMessage(id: string): Promise<MailMessageDetail> {
  return api.get(`/messages/${encodeURIComponent(id)}`)
}

export function attachmentDownloadUrl(messageId: string, attachmentId: string): string {
  return `/backend/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`
}

// Same reasoning as Schrank's own fetchFileBlob - a plain <a href> can't
// carry a bearer token, so downloading an attachment needs an
// authenticated fetch first, turning the response into a blob URL the
// browser can actually save.
export async function fetchAttachmentBlob(messageId: string, attachmentId: string): Promise<Blob> {
  const token = getAccessToken()
  const res = await fetch(attachmentDownloadUrl(messageId, attachmentId), {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    credentials: 'include',
  })
  if (!res.ok) throw new ApiError(res.status, await res.text())
  return res.blob()
}
