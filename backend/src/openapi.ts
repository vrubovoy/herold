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

export const openApiDocument = new OpenApiGeneratorV3(registry.definitions).generateDocument({
  openapi: '3.0.0',
  info: { title: 'Herold API', version: '0.1.0' },
  servers: [{ url: '/' }],
})
