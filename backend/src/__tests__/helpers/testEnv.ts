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

// A fixed, valid (32-byte-decoded) key - lib/credentialCrypto.ts throws
// without one. Fixed rather than randomly generated per run so a test
// asserting on a specific stored ciphertext would be reproducible; no
// test currently does, but there's no reason to make failures
// nondeterministic when a constant is just as easy.
process.env['HEROLD_CREDENTIAL_ENCRYPTION_KEY'] = 'qK+Wx510v3pdeUqnkjLEnplqTvwWBkXDS9uz4LdHL5c='
