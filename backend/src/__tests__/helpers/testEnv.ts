import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// db/index.ts reads DATABASE_PATH from process.env at module-load time -
// a vitest setupFiles entry runs before a test file's own imports are
// evaluated, so setting this here guarantees db/index.ts sees a real,
// isolated per-run temp file rather than the actual ./data used by
// `pnpm dev` - tests would otherwise write into (and potentially collide
// with) local dev data.
process.env['DATABASE_PATH'] = join(mkdtempSync(join(tmpdir(), 'herold-test-')), 'herold.db')
