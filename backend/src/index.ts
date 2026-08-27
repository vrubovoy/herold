import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { logger } from 'hono/logger'
import { checkJwksReachable, createCorsMiddleware } from '@zudar107/schloss-server-kit'
import { bodyLimit } from 'hono/body-limit'
import { db, sqlite } from './db/index.js'
import { assertSchemaCurrent, parseMigrateOnStartup, prepareDatabase } from './db/migrate.js'
import { buildInfo } from './build-info.js'
import { usersRouter } from './features/users/router.js'
import { accountsRouter } from './features/accounts/router.js'
import { foldersRouter } from './features/folders/router.js'
import { messagesRouter } from './features/messages/router.js'
import { exportsRouter } from './features/exports/router.js'
import { JWKS_URL, requireAuth, requireAdmin } from './middleware/auth.js'
import { openApiDocument } from './openapi.js'
import { startMailSyncWorker } from './sync/worker.js'
import { deletionsRouter } from './features/deletions/router.js'

prepareDatabase(db, sqlite, parseMigrateOnStartup(process.env['MIGRATE_ON_STARTUP']))

const ALLOWED_ORIGINS = (process.env['ALLOWED_ORIGINS'] ?? 'http://localhost:5179')
  .split(',').map((o) => o.trim())

const app = new Hono()

app.use('*', bodyLimit({
  maxSize: 1 * 1024 * 1024,
  onError: (c) => c.json({ error: 'Request body too large' }, 413),
}))
app.use('*', logger())
app.use('*', createCorsMiddleware({ allowedOrigins: ALLOWED_ORIGINS }))

app.get('/health', (c) => c.json({ status: 'ok', service: 'Herold', ...buildInfo }))
app.get('/ready', async (c) => {
  try {
    assertSchemaCurrent(sqlite)
  } catch {
    return c.json({ status: 'unavailable', service: 'Herold' }, 503)
  }
  if (!(await checkJwksReachable(JWKS_URL))) {
    return c.json({ status: 'unavailable', service: 'Herold' }, 503)
  }
  return c.json({ status: 'ready', service: 'Herold' })
})

// Reached from herold/frontend's own /docs page as /backend/openapi.json
// (the frontend container's Caddyfile already proxies /backend/* here
// with the prefix stripped) - no new reverse-proxy rule needed.
app.get('/openapi.json', requireAuth, requireAdmin, (c) => c.json(openApiDocument))

app.route('/users', usersRouter)
app.route('/accounts', accountsRouter)
// Mounted before foldersRouter/messagesRouter below - both of those are
// mounted at root '/' and each registers its own `router.use('*',
// requireAuth)`. In Hono, a wildcard middleware on a sub-app mounted at
// '/' matches every path handled by the whole app, not just that
// sub-app's own routes, and is applied in registration order: whichever
// router is mounted first gets first crack at every incoming request.
// exportsRouter must therefore be registered before them, or its own
// GET /exports/me route never gets a chance to run requireExportAuth -
// foldersRouter's/messagesRouter's plain requireAuth (which doesn't
// understand export delegation tokens) intercepts and 401s it first.
app.route('/exports', exportsRouter)
app.route('/internal/v1', deletionsRouter)
// Both mounted at root, not '/accounts' or '/folders' - their own
// internal routes already spell out the full path (e.g.
// '/accounts/:accountId/folders', '/folders/:folderId/messages')
// since a folder/message's URL shape isn't a strict sub-resource of
// exactly one prefix the way accounts' own CRUD is.
app.route('/', foldersRouter)
app.route('/', messagesRouter)

const PORT = Number(process.env['PORT'] ?? 3006)
const server = serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`[Herold API] Running on http://localhost:${PORT}`)
})

const mailSyncWorker = startMailSyncWorker()

let shutdownPromise: Promise<void> | undefined
function shutdown(): Promise<void> {
  if (shutdownPromise) return shutdownPromise
  const httpStopped = new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
  })
  shutdownPromise = Promise.all([httpStopped, mailSyncWorker.stop()]).then(() => undefined)
  return shutdownPromise
}
process.once('SIGINT', () => shutdown())
process.once('SIGTERM', () => shutdown())

export { app }
