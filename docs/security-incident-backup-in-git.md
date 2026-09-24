# Security incident: database backup committed to git

A PostgreSQL dump under `backups/` was tracked in this repository. The file
was removed from the tree in commit `7ad8c1a` (`bd3b5f2` before the history
rewrite) and purged from history on 24 Sep 2026. Treat the leak as real:
anyone who cloned before the purge still has it.

## Status

As of 24 Sep 2026:

- **Step 1: done except for GitHub-held PR refs.** History was rewritten with
  `git filter-repo --invert-paths --path backups/`, and `main` was
  force-pushed. The other remote branches were already merged or
  squash-merged into `main` and were deleted. A fresh clone has no
  `backups/` history, and blob `e57bb8c` is unreachable. The local working
  clone was reset and garbage-collected. **Still open:** `refs/pull/2` to
  `refs/pull/5` on GitHub point at pre-rewrite commits until GitHub Support
  purges them. Any other existing clone must be re-cloned, not pulled.
- **Steps 2–4: not done yet.** Planned for the move to the production VPS
  (new database credentials, new `AUTH_SECRET`, no carried-over sessions).
  The 5 user accounts in the dump must change their passwords before then.

Do not describe the incident as remediated until each step has been done
*and* independently checked by someone other than the person who did it.

## Operator checklist (each needs independent verification)

1. **Purge history** on every remote (`git filter-repo` or BFG), force every
   clone to re-fetch or re-clone, and ask the hosting provider to garbage-
   collect cached refs/PR views. Check forks and mirrors. *Verify:* a fresh
   clone's `git log --all -- backups/` is empty, and the old blob id is not
   reachable (`git cat-file -t <blob>` fails).
2. **Rotate the database credentials** that existed when the dump was
   committed (the `postgres` owner password and any application password),
   and any other secret that lived in that database or next to it
   (print-bridge secret, storage keys). *Verify:* the old credentials are
   refused.
3. **Invalidate all sessions**: rotate `AUTH_SECRET` (re-peppers session
   token hashes) and delete the `sessions` rows. *Verify:* a session cookie
   issued before the rotation is rejected.
4. **Reset every password whose hash was in the dump** — effectively all
   users in that database. bcrypt hashes can be cracked offline; do not rely
   on monitoring. *Verify:* each affected account's `password_hash` changed
   after the leak date (compare `users.updated_at`).
5. **Store future backups outside git**, encrypted and off-host
   ([backup-restore.md](backup-restore.md)).

## App-side measures already in the tree

- `backups/`, `*.dump` and loose `*.sql` are gitignored and excluded from the
  Docker build context.
- Session tokens are HMAC-SHA256-peppered with `AUTH_SECRET`, so rotating it
  invalidates every existing session row.
- The running app now connects as a least-privilege role; the owner password
  is only needed by the migrate step ([deployment.md](deployment.md#database-roles)).
