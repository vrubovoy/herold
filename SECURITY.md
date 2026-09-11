# Security Policy

## Supported versions

Herold is deployed continuously from `main` — there are no maintained
release branches. Security fixes land on `main` and that is the only
supported version.

## Reporting a vulnerability

Please do not open a public issue for security vulnerabilities. Instead,
use GitHub's private reporting flow:

1. Go to the [Security tab](../../security) of this repository.
2. Click "Report a vulnerability".
3. Describe the issue, including reproduction steps if you have them.

This is a small, mostly-solo project, so response time is best-effort, not
contractual — but you can expect an initial reply within a few days.

## Image publish integrity

`.github/workflows/test.yml`'s `publish` job pushes signed, attested
container images to `ghcr.io/vrubovoy/herold-backend` and
`ghcr.io/vrubovoy/herold-frontend`. Their integrity depends on repository
settings kept outside this file:

- **Require actions pinned to a full-length commit SHA**
  (`actions/permissions` → `sha_pinning_required: true`). Every `uses:`
  here is already SHA-pinned.
- **Environment `publish`** with a deployment branch policy allowing only
  the `main` branch and the `v*` tag pattern.
- **Two tag rulesets on `refs/tags/v*`**: one blocking `deletion` /
  `non_fast_forward` / `update` for everyone; one restricting `creation`
  to a repository admin (CI never creates a `v*` tag — a human cuts the
  release).

**Threat model (Model 1).** Every same-repo actor with write access is
trusted; today the only one is a repository admin. A feature branch
controls its own copy of `test.yml` and could drop `environment:` and
request `packages: write`, so the Environment policy gates an *unmodified*
workflow, not a hostile write-collaborator. It still cannot create a `v*`
tag (ruleset) or forge the `@refs/tags/vX.Y.Z` Sigstore identity a
consumer (`hof-ops`'s release lock) checks.

## Scope

Herold stores a user's external IMAP/SMTP credentials (encrypted at
rest) and a local mirror of their mail. The highest-priority reports
here are anything that could expose one user's mail or credentials to
another — a missing or incorrect authorization check on any route, a
weakness in the credential encryption-at-rest scheme, or a way to make
Herold connect to or act on an account other than the caller's own —
followed by the same token/redirect concerns shared with kuvert/tafel/
zettel/schrank/schloss (access token in memory, PKCE verifier in
`sessionStorage`, the auth handoff to/from Schlüssel).
