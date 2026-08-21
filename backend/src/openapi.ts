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

export const openApiDocument = new OpenApiGeneratorV3(registry.definitions).generateDocument({
  openapi: '3.0.0',
  info: { title: 'Herold API', version: '0.1.0' },
  servers: [{ url: '/' }],
})
