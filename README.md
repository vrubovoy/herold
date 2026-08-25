# Herold

[![Test](https://github.com/zudaR107/herold/actions/workflows/test.yml/badge.svg)](https://github.com/zudaR107/herold/actions/workflows/test.yml)
[![License: AGPL v3](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)

Part of the [Hof platform](https://github.com/zudaR107/Hof) — a suite of
self-hosted personal services:

- [`schloss`](https://github.com/zudaR107/schloss) — home page / launcher
- [`schlussel`](https://github.com/zudaR107/schlussel) — auth: accounts, login, tokens
- [`kuvert`](https://github.com/zudaR107/kuvert) — envelope budgeting
- [`tafel`](https://github.com/zudaR107/tafel) — task/project tracking
- [`zettel`](https://github.com/zudaR107/zettel) — markdown note-taking
- [`glocke`](https://github.com/zudaR107/glocke) — in-app notification center and delivery foundation
- [`schrank`](https://github.com/zudaR107/schrank) — file storage with nested folders
- **`herold`** (this repo) — webmail client for external IMAP/SMTP accounts
- [`wachter`](https://github.com/vrubovoy/wachter) — server resource monitoring
- [`tor`](https://github.com/zudaR107/tor) — reverse-proxy gateway
- [`schloss-ui`](https://github.com/zudaR107/schloss-ui) — shared frontend components
- [`schloss-server-kit`](https://github.com/zudaR107/schloss-server-kit) — shared backend auth/CORS kit

Herold ("herald" in German — the medieval messenger who carried letters
between courts) is a personal webmail client: it connects to a user's own
external IMAP/SMTP mail accounts and lets them read and send mail through
one interface. It is explicitly **not** a mail server or MTA — Herold
never accepts inbound SMTP or hosts mailboxes of its own, it only talks
to accounts a user already has elsewhere.

## How it fits into the platform

Herold has no login form of its own. An unauthenticated visitor is
redirected to Schlüssel's hosted login page and back; the backend
verifies the resulting token itself against Schlüssel's public key
(JWKS) rather than calling back to Schlüssel on every request. Shared
logic (JWKS verification, CORS, PKCE login redirect, the API client,
and the resizable sidebar) comes from
[`schloss-server-kit`](https://github.com/zudaR107/schloss-server-kit) and
[`schloss-ui`](https://github.com/zudaR107/schloss-ui), not duplicated here.
The shared header notification bell is wired up like every other app's,
even though Herold itself never emits a Glocke event of its own - it
only needs to *show* notifications from other services (Kuvert, Tafel,
...), so a user can see and jump to one no matter which app they're
currently in.

This repo is a pnpm workspace with two packages:

- `backend/` — the Hono + Drizzle/SQLite backend
- `frontend/` — the React frontend

## Status

Platform wiring, mail account management (connect/edit/disconnect,
"test connection" before saving, passwords encrypted at rest),
read-only IMAP sync (a background worker mirrors every connected
account's folders and messages - headers + plain-text body, never raw
HTML or attachment bytes - into the local database on a timer, with
attachments streamed live from IMAP on demand rather than stored),
composing/sending mail (new message, reply, reply-all, forward) via the
account's own SMTP settings, with a best-effort local + IMAP-APPEND
mirror into Sent, and message actions/search: read/unread and
flag/star (written through to the real server before the local mirror
updates), delete (moves to the account's Trash folder via IMAP `MOVE`,
or permanently deletes in place if no Trash folder is known yet), and
a search box over the local mirror (subject/sender/body, per folder).
A metadata-only `GET /exports/me` (account labels/hosts, folder names,
message counts - never credentials or message content) is also
implemented.

## API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | Liveness check |
| `GET` | `/ready` | Readiness check |
| `GET` | `/users/me` | The caller's own profile (auto-provisioned from their Schlüssel token) |
| `GET` | `/accounts` | The caller's connected mail accounts |
| `POST` | `/accounts` | Connect a new mail account |
| `GET` | `/accounts/:id` | A single mail account |
| `PATCH` | `/accounts/:id` | Update a mail account (a blank password field leaves the stored credential unchanged) |
| `DELETE` | `/accounts/:id` | Disconnect a mail account |
| `POST` | `/accounts/test-connection` | Verify IMAP credentials (submitted directly, not yet saved) |
| `POST` | `/accounts/:id/test-connection` | Re-verify a saved account's stored IMAP credential |
| `GET` | `/accounts/:accountId/folders` | An account's mirrored IMAP folders |
| `GET` | `/folders/:folderId/messages` | A folder's mirrored messages, newest first, paginated (`limit`/`offset`); optional `q` searches subject/sender/body |
| `GET` | `/messages/:id` | A single message in full (headers + plain-text body + attachment list) |
| `PATCH` | `/messages/:id` | Mark read/unread and/or flagged - writes through to IMAP (`STORE`) before updating the local mirror |
| `DELETE` | `/messages/:id` | Moves to Trash (IMAP `MOVE`), or permanently deletes in place if no Trash folder is known yet |
| `GET` | `/messages/:id/attachments/:attachmentId` | Streams an attachment's bytes live from IMAP - never stored locally |
| `POST` | `/accounts/:accountId/messages/send` | Sends via the account's SMTP settings; best-effort mirrors into the local + real Sent folder |
| `GET` | `/exports/me` | Metadata-only JSON snapshot (account labels/hosts, folder names, message counts - never credentials or message content) |

See [`Hof/ROADMAP.md`](https://github.com/zudaR107/Hof/blob/main/ROADMAP.md) for
the platform-wide picture.

## Local development

```sh
git submodule update --init
pnpm install
pnpm --filter @zudar107/schloss-server-kit build
pnpm --filter @zudar107/schloss-ui build
pnpm dev:backend   # backend on http://localhost:3006
pnpm dev:frontend  # frontend on http://localhost:5179
```

```sh
pnpm --filter backend test
pnpm --filter backend lint
pnpm --filter frontend test
pnpm --filter frontend lint
```

### Environment variables

`.env.example` contains Docker Compose substitutions. Direct backend runs
use the defaults shown below unless the variables are exported in the shell;
the backend does not load `.env` itself. Vite does load `.env`, but only
exposes variables prefixed with `VITE_` to frontend code.

| Variable | Purpose |
|---|---|
| `DATABASE_PATH` | SQLite file path when running the backend directly |
| `SCHLUSSEL_JWKS_URL` | Where the backend fetches Schlüssel's public key to verify tokens |
| `JWT_ISSUER` | Must match Schlüssel's own issuer, or every token gets rejected |
| `ALLOWED_ORIGINS` | Comma-separated CORS allowlist when running the backend directly |
| `HEROLD_ALLOWED_ORIGINS` | CORS allowlist passed to the backend by Docker Compose |
| `HEROLD_CREDENTIAL_ENCRYPTION_KEY` | Encrypts stored IMAP/SMTP passwords at rest - a 32-byte base64 key, e.g. `openssl rand -base64 32` |
| `HEROLD_SYNC_INTERVAL_MS` | How often the background sync worker polls connected accounts for new mail (default 180000 = 3 minutes) |
| `SCHLUSSEL_WEB_URL` | Schlüssel browser URL baked into the frontend by Docker Compose |
| `SCHLOSS_URL` | Schloss home URL baked into the frontend by Docker Compose |
| `GLOCKE_URL` | Glocke URL baked into the frontend by Docker Compose (the shared notification bell) |

For a direct Vite build, the corresponding build-time variables are
`VITE_SCHLUSSEL_URL`, `VITE_SCHLOSS_URL`, and `VITE_GLOCKE_URL`; their
local defaults are `http://localhost:4001`, `http://localhost:3000`, and
`http://localhost:5177`, respectively.

## Running with Docker

```sh
docker network create schloss-net   # one-time, shared with the other repos
cp .env.example .env
docker compose up -d
```

Neither service publishes a host port — both are reached through the
[tor](https://github.com/zudaR107/tor) gateway (`https://herold.localhost` in local dev
- tor's Caddy auto-upgrades everything to HTTPS with its own locally-trusted CA), on the
same `schloss-net` network as every other service.

## License

AGPL-3.0 — see [LICENSE](LICENSE).
