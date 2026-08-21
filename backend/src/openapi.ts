import { OpenAPIRegistry, OpenApiGeneratorV3 } from '@asteasolutions/zod-to-openapi'
import { z } from 'zod'

// Purely additive/descriptive: this file only describes the API surface
// already implemented under src/features/*/router.ts. It has zero
// effect on runtime request validation - deleting it wouldn't change
// any endpoint's behavior. Grows alongside mail account management,
// sync, and sending in later stages; this is the bootstrap-only surface.

const registry = new OpenAPIRegistry()

registry.registerComponent('securitySchemes', 'bearerAuth', {
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'JWT',
})

const BEARER = [{ bearerAuth: [] }]

const userResponseSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  weekStart: z.enum(['monday', 'sunday']).nullable(),
  dateFormat: z.enum(['dmy', 'mdy', 'ymd']).nullable(),
  timezone: z.string().nullable(),
})

registry.registerPath({
  method: 'get', path: '/users/me', tags: ['users'], summary: 'Get the current user', security: BEARER,
  responses: { 200: { description: 'Current user', content: { 'application/json': { schema: userResponseSchema } } } },
})

const errorResponseSchema = z.object({ error: z.string() })
const securitySchema = z.enum(['tls', 'starttls', 'none'])

const mailAccountResponseSchema = z.object({
  id: z.string(),
  label: z.string(),
  imapHost: z.string(),
  imapPort: z.number().int(),
  imapSecurity: securitySchema,
  imapUsername: z.string(),
  smtpHost: z.string(),
  smtpPort: z.number().int(),
  smtpSecurity: securitySchema,
  smtpUsername: z.string(),
  fromName: z.string(),
  fromEmail: z.string(),
  syncState: z.enum(['pending', 'ok', 'error']),
  lastSyncedAt: z.iso.datetime().nullable(),
  lastError: z.string().nullable(),
  createdAt: z.iso.datetime(),
})
const mailAccountFieldsSchema = z.object({
  label: z.string().min(1).max(200),
  imapHost: z.string().min(1).max(255),
  imapPort: z.number().int().min(1).max(65535),
  imapSecurity: securitySchema,
  imapUsername: z.string().min(1).max(255),
  imapPassword: z.string().min(1).max(1000),
  smtpHost: z.string().min(1).max(255),
  smtpPort: z.number().int().min(1).max(65535),
  smtpSecurity: securitySchema,
  smtpUsername: z.string().min(1).max(255),
  smtpPassword: z.string().min(1).max(1000),
  fromName: z.string().min(1).max(200),
  fromEmail: z.email().max(320),
})
const mailAccountUpdateSchema = mailAccountFieldsSchema.partial()
const testConnectionRequestSchema = z.object({
  imapHost: z.string().min(1).max(255),
  imapPort: z.number().int().min(1).max(65535),
  imapSecurity: securitySchema,
  imapUsername: z.string().min(1).max(255),
  imapPassword: z.string().min(1).max(1000),
})
const testConnectionResponseSchema = z.union([
  z.object({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), error: z.string() }),
])

registry.registerPath({
  method: 'get', path: '/accounts', tags: ['accounts'], summary: "List the caller's connected mail accounts", security: BEARER,
  responses: { 200: { description: 'Mail accounts', content: { 'application/json': { schema: z.array(mailAccountResponseSchema) } } } },
})
registry.registerPath({
  method: 'post', path: '/accounts', tags: ['accounts'], summary: 'Connect a new mail account', security: BEARER,
  request: { body: { content: { 'application/json': { schema: mailAccountFieldsSchema } } } },
  responses: {
    201: { description: 'Created account', content: { 'application/json': { schema: mailAccountResponseSchema } } },
  },
})
registry.registerPath({
  method: 'post', path: '/accounts/test-connection', tags: ['accounts'],
  summary: 'Verify IMAP credentials without saving them',
  description: 'Opens a real IMAP connection, attempts LOGIN, and logs out immediately - never persists anything.',
  security: BEARER,
  request: { body: { content: { 'application/json': { schema: testConnectionRequestSchema } } } },
  responses: {
    200: { description: 'Connection attempt outcome (ok:true or ok:false with an error message)', content: { 'application/json': { schema: testConnectionResponseSchema } } },
  },
})
registry.registerPath({
  method: 'post', path: '/accounts/{id}/test-connection', tags: ['accounts'],
  summary: "Re-verify a saved account's stored IMAP credential",
  description: 'Same outcome shape as POST /accounts/test-connection, but decrypts and tests the already-stored password instead of one supplied in the request.',
  security: BEARER,
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: { description: 'Connection attempt outcome', content: { 'application/json': { schema: testConnectionResponseSchema } } },
    404: { description: 'Not found', content: { 'application/json': { schema: errorResponseSchema } } },
  },
})
registry.registerPath({
  method: 'get', path: '/accounts/{id}', tags: ['accounts'], summary: 'Get a single mail account', security: BEARER,
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: { description: 'Mail account', content: { 'application/json': { schema: mailAccountResponseSchema } } },
    404: { description: 'Not found', content: { 'application/json': { schema: errorResponseSchema } } },
  },
})
registry.registerPath({
  method: 'patch', path: '/accounts/{id}', tags: ['accounts'], summary: 'Update a mail account', security: BEARER,
  description: 'Every field is optional - omitting a password field leaves the stored credential unchanged.',
  request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: mailAccountUpdateSchema } } } },
  responses: {
    200: { description: 'Updated account', content: { 'application/json': { schema: mailAccountResponseSchema } } },
    404: { description: 'Not found', content: { 'application/json': { schema: errorResponseSchema } } },
  },
})
registry.registerPath({
  method: 'delete', path: '/accounts/{id}', tags: ['accounts'], summary: 'Disconnect a mail account', security: BEARER,
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: { description: 'Deleted' },
    404: { description: 'Not found', content: { 'application/json': { schema: errorResponseSchema } } },
  },
})

const mailFolderResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  specialUse: z.enum(['inbox', 'sent', 'drafts', 'trash', 'junk']).nullable(),
  createdAt: z.iso.datetime(),
})
const mailMessageSummarySchema = z.object({
  id: z.string(),
  subject: z.string().nullable(),
  fromAddress: z.string().nullable(),
  fromName: z.string().nullable(),
  date: z.iso.datetime().nullable(),
  snippet: z.string(),
  flagsSeen: z.boolean(),
  flagsFlagged: z.boolean(),
  hasAttachments: z.boolean(),
})
const mailAddressSchema = z.object({ name: z.string().optional(), address: z.string().optional() })
const mailAttachmentSchema = z.object({ id: z.string(), filename: z.string(), mimeType: z.string(), sizeBytes: z.number().int() })
const mailMessageDetailSchema = z.object({
  id: z.string(),
  messageId: z.string().nullable(),
  subject: z.string().nullable(),
  fromAddress: z.string().nullable(),
  fromName: z.string().nullable(),
  toAddresses: z.array(mailAddressSchema),
  date: z.iso.datetime().nullable(),
  bodyText: z.string(),
  flagsSeen: z.boolean(),
  flagsFlagged: z.boolean(),
  attachments: z.array(mailAttachmentSchema),
  createdAt: z.iso.datetime(),
})

registry.registerPath({
  method: 'get', path: '/accounts/{accountId}/folders', tags: ['mail'],
  summary: "List an account's mirrored IMAP folders", security: BEARER,
  request: { params: z.object({ accountId: z.string() }) },
  responses: {
    200: { description: 'Folders', content: { 'application/json': { schema: z.array(mailFolderResponseSchema) } } },
    404: { description: 'Not found', content: { 'application/json': { schema: errorResponseSchema } } },
  },
})
registry.registerPath({
  method: 'get', path: '/folders/{folderId}/messages', tags: ['mail'],
  summary: 'List a folder\'s mirrored messages, newest first', security: BEARER,
  request: {
    params: z.object({ folderId: z.string() }),
    query: z.object({ limit: z.coerce.number().int().min(1).max(200).optional(), offset: z.coerce.number().int().min(0).optional() }),
  },
  responses: {
    200: {
      description: 'A page of messages plus the total count in this folder',
      content: { 'application/json': { schema: z.object({ messages: z.array(mailMessageSummarySchema), total: z.number().int() }) } },
    },
    404: { description: 'Not found', content: { 'application/json': { schema: errorResponseSchema } } },
  },
})
registry.registerPath({
  method: 'get', path: '/messages/{id}', tags: ['mail'], summary: 'Get a single message in full', security: BEARER,
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: { description: 'Message detail', content: { 'application/json': { schema: mailMessageDetailSchema } } },
    404: { description: 'Not found', content: { 'application/json': { schema: errorResponseSchema } } },
  },
})
const sendMessageRequestSchema = z.object({
  to: z.array(z.email()).min(1).max(50),
  cc: z.array(z.email()).max(50).optional(),
  bcc: z.array(z.email()).max(50).optional(),
  subject: z.string().max(500).optional(),
  bodyText: z.string().min(1).max(200_000),
  inReplyTo: z.string().max(1000).optional(),
})
const sendMessageResponseSchema = z.object({ ok: z.literal(true), message: mailMessageSummarySchema.nullable() })

registry.registerPath({
  method: 'post', path: '/accounts/{accountId}/messages/send', tags: ['mail'],
  summary: 'Send a message via the account\'s SMTP settings', security: BEARER,
  description: 'Best-effort mirrors the sent message into the local Sent folder and IMAP-APPENDs it to the server - `message` is null if no Sent folder has been discovered yet.',
  request: {
    params: z.object({ accountId: z.string() }),
    body: { content: { 'application/json': { schema: sendMessageRequestSchema } } },
  },
  responses: {
    201: { description: 'Sent', content: { 'application/json': { schema: sendMessageResponseSchema } } },
    404: { description: 'Not found', content: { 'application/json': { schema: errorResponseSchema } } },
    502: { description: 'The SMTP send itself failed', content: { 'application/json': { schema: errorResponseSchema } } },
  },
})

registry.registerPath({
  method: 'get', path: '/messages/{id}/attachments/{attachmentId}', tags: ['mail'],
  summary: 'Stream an attachment', security: BEARER,
  description: 'Never mirrored locally - opens a fresh IMAP connection per request and streams the bytes live.',
  request: { params: z.object({ id: z.string(), attachmentId: z.string() }) },
  responses: {
    200: { description: 'Raw attachment bytes, with the stored Content-Type/filename' },
    404: { description: 'Not found', content: { 'application/json': { schema: errorResponseSchema } } },
    502: { description: 'Could not fetch the attachment from the IMAP server', content: { 'application/json': { schema: errorResponseSchema } } },
  },
})

export const openApiDocument = new OpenApiGeneratorV3(registry.definitions).generateDocument({
  openapi: '3.0.0',
  info: { title: 'Herold API', version: '0.1.0' },
  servers: [{ url: '/' }],
})
