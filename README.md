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

Bootstrapping: platform wiring (auth, CORS, the shared header/sidebar/
notification bell, `/health`+`/ready`, CI, Docker, the tor gateway
entry) is in place. Mail account management, IMAP/SMTP sync, and
sending are not implemented yet.

## API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | Liveness check |
| `GET` | `/ready` | Readiness check |
| `GET` | `/users/me` | The caller's own profile (auto-provisioned from their Schlüssel token) |

Grows alongside mail account management, sync, and sending in later
stages — see [`Hof/ROADMAP.md`](https://github.com/zudaR107/Hof/blob/main/ROADMAP.md).

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
