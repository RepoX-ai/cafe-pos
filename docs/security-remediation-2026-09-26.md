# Security remediation — 26 September 2026

## What this patch fixes

- Production rejects the published `.env.example` auth secret and known test secrets.
- POS checkout checks the rendered business/user scope against the freshly validated
  database session before any order, stock, or print work. The client value can
  only reject a request; it never selects or authorizes a tenant.
- A scope rejection preserves the original pending order and idempotency key.
  Switch back to the original café/account and retry. Do not start a replacement
  order until the original result is known.
- Backups use directory mode 700, file mode 600, a process lock, temporary files,
  archive validation, and a SHA-256 manifest. Pruning happens only after success.
  Uploads require a named rclone `crypt` remote; remote retention is independent.
- `deploy/security-check.py` checks resolved Compose settings, running container
  port bindings, and actual runtime database-role flags without printing secrets.
- CI runs type checking, unit tests, and selected authentication, tenant-reference,
  membership-concurrency, rate-limit, and staff-permission integration tests on a
  disposable PostgreSQL service. It uses no production credentials.

No database schema migration is added by this patch.

## Apply on the VPS

Do not redeploy if the checks below fail. These steps require the VPS operator;
repository changes alone do not modify the running server.

1. Use unique production database owner/app passwords, a freshly generated
   `AUTH_SECRET`, and fresh staff passwords. A new database does not itself prove
   that passwords or secrets were changed. Never post `.env` or credentials in PRs.
   Changing only `.env` does not rotate an existing PostgreSQL owner's password;
   rotate that role in PostgreSQL too. App-role rotation uses the existing
   migration/role provisioning procedure in `docs/deployment.md`.
2. Pull the reviewed merge commit using the existing deployment process. Run:

   ```bash
   cd /opt/cafe-pos
   python3 deploy/security-check.py
   ```

   Repeat after the application is rebuilt/restarted. This check makes no changes.
   A pass is limited to its stated checks; it is not a complete penetration test.
3. Confirm host/provider firewall rules permit HTTP/HTTPS and restrict SSH to the
   operator's access path. PostgreSQL 5432 and app 3000 must not be public. Verify
   Nginx overwrites the trusted IP header and serves the valid HTTPS certificate.
   Do not rerun the fresh-server setup script on the live VPS as a repair shortcut.
4. Configure an rclone `crypt` remote over an off-server storage account as the
   backup operator, and save its encryption credentials separately for recovery.
   In `.env`, set `RCLONE_REMOTE=cafepos-crypt:backups` (using the actual remote).
   Then run:

   ```bash
   bash deploy/backup.sh
   ```

   **Behavior change:** a missing or unencrypted remote now fails visibly. If
   off-site storage is still being provisioned, temporarily run
   `ALLOW_LOCAL_ONLY_BACKUP=1 bash deploy/backup.sh`; set that explicitly in cron
   only while needed. Local backups are private but not encrypted on disk.
   Review cron output and configure failure notifications through your monitoring.
5. Download a completed backup pair and manifest through the crypt remote into a
   private recovery directory. Verify `sha256sum -c backup-<stamp>.sha256` there.
   From the application directory, run the existing restore drill:

   ```bash
   bash scripts/verify-backup.sh --docker /absolute/path/to/db-<stamp>.dump
   ```

   This restores into a generated temporary database, checks it, and drops that
   temporary database. Also inspect the restored image archive. A successful
   upload or archive-header check is not a substitute for this restore drill.
6. Complete the historical backup exposure cleanup: ask GitHub Support to purge
   retained PR refs 2–5, as recorded in `docs/security-incident-backup-in-git.md`.
   Only GitHub/the repository owner can close that external cleanup step.

## Verification and remaining scope

Locally run in the remediation workspace:

```bash
node --experimental-strip-types --test tests/security/auth.test.mjs
python3 -m unittest discover -s tests/security -p '*_test.py' -v
bash -n deploy/backup.sh
```

Backup tests use stub Docker/rclone processes: they verify permissions, checksums,
publication/failure handling, and configuration enforcement. They do not prove a
live database restore or encryption-provider setup.

The workspace could not download npm dependencies. Full type/unit/integration
results must come from the PR's Security regression check or an authorized local
checkout. Do not treat unexecuted tests as passed.

Authenticated live testing is still required using disposable test accounts/data:

- cashier cannot reach staff/settings/expenses/profit or invoke their mutations;
- manager cannot change staff or owner settings;
- a user with different roles in two cafés cannot read/write the other's data;
- deactivated users/memberships and expired sessions lose access;
- stale POS checkout creates no order and preserves the retry payload;
- repeat submission does not create another order or stock movement.

Independent café tabs are **not implemented** here. The active café remains shared
by tabs in one browser session. Checkout now rejects stale context, but admin
forms still need the broader per-page context design and authenticated regression
coverage before separate café tabs are supported. Use separate browser profiles
for Matsudon and Konichiwa meanwhile.

The previous public login/redirect checks and source review did not establish
that the live site is free of vulnerabilities. VPS access, authenticated browser
sessions, live deployment verification, off-site storage setup, and GitHub Support
cleanup were unavailable during these repo changes.
