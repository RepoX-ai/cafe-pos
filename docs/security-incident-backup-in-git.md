# Security incident: database backup committed to git

A PostgreSQL dump under `backups/` was tracked in this repository. Even after
the file is removed from the tree, **git history still contains the dump**
until a separate history purge is completed. Treat the leak as real.

## Operator checklist

1. **Purge history separately** (not part of the remediation PR that only
   deletes the file from `HEAD`). Use `git filter-repo` / BFG on every remote
   and force every clone to re-fetch, or rotate the repo. Coordinate with
   anyone who may have forked or mirrored the dump.
2. **Force password resets** for every account whose password hash appeared
   in the dump (effectively: all users in that database). Do not rely on
   "change password on next login" alone if you cannot guarantee reachability.
3. **Invalidate all sessions** — truncate or delete the `sessions` table, or
   rotate `AUTH_SECRET` (which re-peppers session token hashes and forces
   re-login). Prefer both after a leak.
4. **Treat password hashes as compromised** — offline cracking is possible.
   Reset credentials; do not merely "monitor." Rotate any other secrets that
   may have lived in the same database (API keys, print-bridge secrets, etc.).
5. **Store future backups outside git** — encrypted object storage or an
   off-host path. Never commit `backups/`, `*.sql` dumps, or `*.dump` files.
   See [backup-restore.md](backup-restore.md).

## App-side follow-ups already in tree

- `backups/` is gitignored; dumps must not be re-added.
- Session tokens are HMAC-SHA256-peppered with `AUTH_SECRET`. Changing
  `AUTH_SECRET` invalidates existing session rows (users must re-login) —
  expected and desirable after this incident.
