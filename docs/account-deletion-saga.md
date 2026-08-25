# Account deletion saga hook

Herold must not infer platform account deletion from a normal user request.
The current Schlossel token contract has no trusted deletion-event producer,
so adding a public tombstone endpoint now would weaken authorization rather
than provide a safe additive integration.

A later account-saga pass can add an internal endpoint with this contract:

- authenticate a dedicated service audience and `account:delete` scope;
- accept the Schlossel user ID plus a stable saga event ID;
- insert an event-ID tombstone and delete the user's Herold rows in one
  transaction;
- return success when the same event ID is replayed;
- retain no IMAP/SMTP credentials or mirrored message data after commit;
- expose completion to the saga producer without requiring a user session.

The natural implementation point is a new router mounted before the root mail
routers in `backend/src/index.ts`. Until trusted producer authentication is
available, `DELETE /accounts/:id` remains limited to disconnecting one external
mail account owned by the authenticated user.
