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
