# Changelog

## Unreleased

- Add the durable Schlussel account-deletion consumer, permanent user
  tombstones, and atomic mail mirror and credential purge.
- Restrict and pin outbound IMAP/SMTP DNS resolution with operator allowlists.
- Require explicit IMAP STARTTLS and share transport option mapping.
- Bound message text synchronization and attachment streaming.
- Make mirror resets, UID insertion, and successful-read reconciliation atomic.
- Reconcile provider-filed Sent messages by Message-ID; make APPEND opt-in.
- Add URL-backed mail pagination, direct data export, and delete confirmation.
