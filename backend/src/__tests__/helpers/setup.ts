import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { checkJwksReachable } from '@zudar107/schloss-server-kit'
import { usersRouter } from '../../features/users/router.js'
import { accountsRouter } from '../../features/accounts/router.js'
import { foldersRouter } from '../../features/folders/router.js'
import { messagesRouter } from '../../features/messages/router.js'
import { exportsRouter } from '../../features/exports/router.js'
import { JWKS_URL, requireAuth, requireAdmin } from '../../middleware/auth.js'
import { openApiDocument } from '../../openapi.js'
import { assertSchemaCurrent } from '../../db/migrate.js'
import { sqlite } from '../../db/index.js'

/**
 * Build a minimal Hono app wired up with the real routers plus the
 * inline /health, /ready, and /openapi.json routes that index.ts itself
 * defines. Those are reconstructed here rather than importing index.ts
 * directly, since index.ts eagerly runs drizzle's migrate() against the
 * db module at import time (which would blow up against helpers/db.ts's
 * already-migrated in-memory db) and, as the real entrypoint, also
 * starts an HTTP listener as a side effect.
 *
 * The db and auth modules are expected to have been mocked by the calling
 * test file (via vi.mock('../db/index.js', ...) and
 * vi.mock('../middleware/auth.js', ...)) before this function is called.
 */
export function createTestApp() {
  const app = new Hono()
  // Mirrors index.ts's real middleware stack, not just the routers - so
  // this exact behavior (body-size limiting) is exercised in tests too.
  app.use(
    '*',
    bodyLimit({
      maxSize: 1 * 1024 * 1024,
      onError: (c) => c.json({ error: 'Request body too large' }, 413),
    }),
  )
  app.get('/health', (c) => c.json({ status: 'ok', service: 'Herold' }))
  // Mirrors index.ts's own real /ready logic (schema currency, then the
  // Schlüssel JWKS dependency), not just a static "ready" stub - see the
  // module comment for why this is reconstructed rather than imported.
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
  app.get('/openapi.json', requireAuth, requireAdmin, (c) => c.json(openApiDocument))
  app.route('/users', usersRouter)
  app.route('/accounts', accountsRouter)
  // exportsRouter must be mounted before foldersRouter/messagesRouter -
  // see the matching comment in index.ts. Both of those are mounted at
  // root '/' with their own `router.use('*', requireAuth)`, which in Hono
  // leaks onto every path in the whole app, not just their own routes,
  // in registration order - mounting them first would otherwise make
  // their plain requireAuth intercept GET /exports/me before
  // exportsRouter's own requireExportAuth ever runs.
  app.route('/exports', exportsRouter)
  app.route('/', foldersRouter)
  app.route('/', messagesRouter)
  return app
}
