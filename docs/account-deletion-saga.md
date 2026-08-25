# Account deletion consumer

`POST /internal/v1/account-deletions` accepts only a short-lived Schlussel
RS256 token with exact `hof-deletion:herold` audience, deletion token use and
scope, and subject/job claims matching the strict request body.

One transaction records the immutable job and permanent tombstone, then
cascade-purges encrypted account credentials, folders, message bodies,
attachment references, and sync state with the local user. Exact replay
succeeds and mismatched job or subject identities conflict. Tombstones prevent
still-valid access tokens from recreating the deleted mail mirror.
