# Go-live runbook: first VPS deployment

Step-by-step, from "the client has bought a server" to "the café is taking
orders". Written for doing this for the first time. The reasoning behind each
setting is in [deployment.md](deployment.md) (option B, fully VPS-hosted) and
[backup-restore.md](backup-restore.md). This file is the order to do it in.

**Decisions already made:**
- The app and Postgres both run on one VPS, in Docker Compose.
- Nginx on the host handles HTTPS with a free Let's Encrypt certificate.
- The database starts **empty**. Nothing is copied from the Supabase/Vercel
  staging setup. Owner accounts are created fresh, the Matsudon menu is
  re-imported by script, and recipes and stock are entered in the app.
- The provider is IDCloudHost or Biznet Gio (Jakarta).

**Time:** about half a day for steps 1–10, plus waiting for DNS. Do it at
least a few days before the first real service, so that if something goes
wrong in step 12 (tablets and printer), there's time to fix it.

**Placeholders used below:**

| Placeholder | Meaning | Example |
|---|---|---|
| `<SERVER_IP>` | the VPS public IPv4 address, from the provider panel | `103.x.x.x` |
| `POS_DOMAIN` | the hostname staff will open | `pos.matsudon.id` |
| `<you>` | your Linux username on the server | `denny` |

Commands marked **laptop** run in PowerShell on your Windows machine.
Commands marked **server** run in the SSH session.

---

## 1. Buy the server

Ask the client to buy (or buy on their account):

- **Location:** Jakarta.
- **OS:** Ubuntu **24.04 LTS** (64-bit). The setup script assumes it.
- **Size:** 2 vCPU, **4 GB RAM**, 40 GB+ SSD. 2 GB RAM also works (the
  script adds swap), but building the app will be slow.
- **Public IPv4 address:** yes.
- **Backup/snapshot add-on:** turn it on if it's offered. It's a cheap
  second safety net on top of step 10.

Write down the IP address and the root password the provider gives you.
If the panel asks for an SSH key at creation, paste the key from step 3 and
skip step 3's copy command.

If the provider panel has its own firewall or "security group", allow
inbound TCP **22, 80, 443** and nothing else.

## 2. Point the domain at the server

In the DNS settings of the domain (wherever the client bought it):

| Type | Name | Value | TTL |
|---|---|---|---|
| A | `pos` (or whatever the subdomain is) | `<SERVER_IP>` | 300 |

Check it has taken effect before step 8 (it can take anywhere from minutes
to a few hours):

```powershell
# laptop
nslookup POS_DOMAIN
```

It must print `<SERVER_IP>`.

## 3. Give the server your SSH key

This lets you log in with a key file instead of a password.

```powershell
# laptop — skip ssh-keygen if C:\Users\ADMIN\.ssh\id_ed25519.pub already exists
ssh-keygen -t ed25519
type $env:USERPROFILE\.ssh\id_ed25519.pub | ssh root@<SERVER_IP> "mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"
```

This asks for the root password one last time. Then
`ssh root@<SERVER_IP>` should log you in without a password.

## 4. Run the server setup script

```powershell
# laptop, from the repo folder
scp deploy\server-setup.sh root@<SERVER_IP>:/root/
ssh root@<SERVER_IP>
```

```bash
# server (as root)
bash /root/server-setup.sh <you>
```

It asks you to set a password for `<you>`. That password is only used for
`sudo`, so save it in your password manager.

The script installs Docker, Nginx and certbot. It sets up a firewall that
allows only SSH and web traffic, fail2ban, automatic security updates and
swap, and creates `/opt/cafe-pos` and `/var/backups/cafe-pos`.

**Don't close the root window yet.** Open a *second* PowerShell window:

```powershell
# laptop, new window
ssh <you>@<SERVER_IP>
```

If that logs you in:

```bash
# server (as <you>)
sudo systemctl reload ssh
```

From now on, only key logins as `<you>` work: root login and password login
are both turned off. Now you can close the root window. Everything below
runs as `<you>`.

## 5. Let the server read the GitHub repo

The repo is private, so give the server its own read-only key:

```bash
# server
ssh-keygen -t ed25519 -f ~/.ssh/github_deploy -N "" -C "cafe-pos VPS"
cat >> ~/.ssh/config <<'EOF'
Host github.com
  IdentityFile ~/.ssh/github_deploy
  IdentitiesOnly yes
EOF
cat ~/.ssh/github_deploy.pub
```

On GitHub: **repo → Settings → Deploy keys → Add deploy key**. Paste the
printed line, name it "cafe-pos VPS", and leave **Allow write access
unticked**.

```bash
# server
git clone git@github.com:dennypratama194/cafe-pos.git /opt/cafe-pos
cd /opt/cafe-pos
```

(Answer `yes` to the GitHub fingerprint question.)

## 6. Create the production `.env`

Every secret is generated on the server and is new. None of them is reused
from local dev, Supabase or Vercel, which also covers the rotation part of
[the incident doc](security-incident-backup-in-git.md).

Replace `POS_DOMAIN` on the `APP_URL` line before running this:

```bash
# server, in /opt/cafe-pos
cat > .env <<EOF
POSTGRES_PASSWORD=$(openssl rand -hex 24)
APP_DB_ROLE=cafe_pos_app
APP_DB_PASSWORD=$(openssl rand -hex 24)
AUTH_SECRET=$(openssl rand -base64 32)
APP_URL=https://POS_DOMAIN
NEXT_PUBLIC_BUSINESS_TIMEZONE=Asia/Jakarta
MAX_BUSINESSES=3
PRINT_PROVIDER=device
TRUSTED_PROXY_COUNT=1
RCLONE_REMOTE=
EOF
chmod 600 .env
cat .env
```

Copy the whole output into your password manager as "CaféOps VPS .env".
If the server is ever lost, you'll want these values. Never commit this
file or paste it in chat.

- `MAX_BUSINESSES` is how many cafés this install may hold. Raise it if the
  client has more than 3, then run `docker compose up -d app`.
- `PRINT_PROVIDER=device` is the Bluetooth printer on the tablet. Use
  `browser` for now if the printer isn't in hand yet.

## 7. Build and start

```bash
# server, in /opt/cafe-pos
docker compose build                 # 5–15 minutes the first time
docker compose up -d db
docker compose run --rm migrate      # creates tables + the app's restricted DB user
docker compose up -d app
docker compose ps                    # db and app should both say "healthy" within a minute
curl -s http://127.0.0.1:3000/api/health
```

The last line must print `{"status":"ok","database":"connected"}`.

If the app keeps restarting, run `docker compose logs app --tail 50`. On
startup it names any setting that's missing or wrong (see
[deployment.md § What refuses to start](deployment.md#what-refuses-to-start)).

## 8. Nginx and HTTPS

Only continue once step 2's `nslookup` prints the server IP.

```bash
# server, in /opt/cafe-pos — replace POS_DOMAIN in the first line
DOMAIN=POS_DOMAIN
sudo cp deploy/nginx/cafe-pos-proxy.conf /etc/nginx/cafe-pos-proxy.conf
sed "s/POS_DOMAIN/$DOMAIN/" deploy/nginx/cafe-pos.conf | sudo tee /etc/nginx/conf.d/cafe-pos.conf >/dev/null
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d "$DOMAIN" --redirect --agree-tos -m <your-email>
sudo certbot renew --dry-run         # confirms automatic renewal will work
```

On your laptop, open `https://POS_DOMAIN/api/health`. It should show
the padlock and `{"status":"ok",...}`. Also check that `http://POS_DOMAIN`
redirects to `https://`.

## 9. Create the cafés, owners and menu

Create each café with its owner. The script asks questions and hides the
password as you type.

```bash
# server, in /opt/cafe-pos
docker compose run --rm app npm run db:create-owner
```

- Use a **new password** (12+ characters) that has never been used on the
  staging setup. The old ones were in the leaked dump.
- **Order number prefix:** a short code per café, e.g. `MTS`.
- **For the next café:** run the same command again. If you give the same
  owner email, the script adds the new café to that owner's existing login
  instead of creating a second account.

Import the Matsudon menu (categories, items, variants, photos):

```bash
# server — the ID is printed by db:create-owner ("Created business ... (<id>)").
# With only one café, you can leave MENU_SEED_BUSINESS_ID off.
docker compose run --rm -e MENU_SEED_BUSINESS_ID=<business-id> app npm run db:seed:matsudon-menu
```

Then log in at `https://POS_DOMAIN` as the owner and, in the app:

1. **Settings → Staff:** create the cashier, manager and inventory accounts,
   each with a new password.
2. **Ingredients**, then **Recipes** for every menu item. The POS shows
   which items still have no recipe.
3. An **opening stock count**, so inventory starts from real numbers.
4. Tax and service-charge settings, and receipt details.

## 10. Backups

A backup you've never restored is only a guess, so this step includes a
restore test.

```bash
# server, in /opt/cafe-pos
bash deploy/backup.sh                                   # run once by hand
ls -lh /var/backups/cafe-pos/
bash scripts/verify-backup.sh --docker /var/backups/cafe-pos/db-*.dump   # restore drill: must end with exit 0
```

(With more than one dump, pass the newest filename instead of the `*`.)

Schedule it nightly at 03:00 Jakarta time:

```bash
# server
( crontab -l 2>/dev/null; echo '0 3 * * * bash /opt/cafe-pos/deploy/backup.sh >> /var/backups/cafe-pos/backup.log 2>&1' ) | crontab -
crontab -l
```

**Off-server copy (strongly recommended).** Backups on the same disk don't
survive losing the server. Both IDCloudHost and Biznet Gio sell
S3-compatible object storage. Once you have a bucket and access keys:

```bash
# server
rclone config
#  n) new remote → name: cafepos-s3 → type: s3 → provider: Other
#     → paste access key, secret key, and the provider's endpoint URL
#  n) new remote → name: cafepos-crypt → type: crypt
#     → remote: cafepos-s3:<bucket-name>/backups → set two passwords
```

**Save the two crypt passwords in your password manager.** Without them the
backups can't be read, not even by you. Then set
`RCLONE_REMOTE=cafepos-crypt:` in `/opt/cafe-pos/.env`, run
`bash deploy/backup.sh` once more and confirm it prints
`copied off-server`.

## 11. Monitoring

Create a free monitor at [UptimeRobot](https://uptimerobot.com) (or any
uptime service):

- **Type:** HTTP(s), **URL:** `https://POS_DOMAIN/api/health`, every 5
  minutes.
- Alert to your email/phone, and the client's.

It also warns you if the HTTPS certificate ever fails to renew.

## 12. Tablet and printer acceptance

On the real Galaxy Tab A 8.0, on the café's own Wi-Fi:

1. Open `https://POS_DOMAIN` in **Chrome** and log in as a cashier.
2. Chrome menu → **Add to Home screen**, so it opens like an app.
3. Pair the iWare printer from the POS and print a test receipt.
4. Work through the "Before client handover" list in
   [release-review-2026-09-24.md](release-review-2026-09-24.md): receipts
   with inclusive and exclusive tax, discounts, service charge, cash change,
   reprint, and cancel/refund.
5. Close Chrome, reopen it and check you're still logged in.
6. Refund the test orders afterwards, so they don't count in day-one reports.
   Or, if you want a completely clean start before real trading, wipe the
   database and uploaded photos, then redo steps 7, 9 and 10:
   ```bash
   # server, in /opt/cafe-pos — deletes ALL data. Never run this after go-live.
   docker compose down -v
   ```

## 13. Close out the old setup

Once the café has traded for a day or two on the VPS without problems:

- **Delete the Supabase project "POS"** (Supabase → Project Settings →
  General → Delete project). It holds the staging data and test accounts
  from the leak period.
- **Remove the Vercel project** (or at least its environment variables).
- **Delete `.env.prod.local`** on your laptop. It holds the Supabase
  password and test-account passwords.
- Update [security-incident-backup-in-git.md](security-incident-backup-in-git.md)
  to mark steps 2–4 done: new database credentials, new `AUTH_SECRET`, and
  fresh accounts and passwords on a fresh database.

---

## Everyday operations

**Deploying an update:**

```bash
# server
cd /opt/cafe-pos
bash deploy/backup.sh                # always back up first
git pull
docker compose build
docker compose run --rm migrate
docker compose up -d app
curl -s http://127.0.0.1:3000/api/health
```

Deploy outside service hours. The app is down for a few seconds while the
new container starts.

**Rolling back:** if the update had no database migration,
`git checkout <previous-commit>` then run the `build` / `up -d app` lines
again. If it did have a migration, restore the backup you just took, as
described in
[backup-restore.md § Restore for real](backup-restore.md#restore-for-real-fresh-environment).

**Useful commands:**

| Task | Command (in `/opt/cafe-pos`) |
|---|---|
| Live app logs | `docker compose logs -f app --tail 100` |
| Restart the app | `docker compose restart app` |
| Status | `docker compose ps` |
| Disk space | `df -h` and `docker system df` |
| Clear old build layers | `docker image prune -f` |
| Database shell | `docker compose exec db psql -U postgres -d cafe_pos` |
| Last backup run | `tail -20 /var/backups/cafe-pos/backup.log` |

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| App container keeps restarting | A missing or wrong `.env` value. `docker compose logs app` names it. |
| Login appears to work, then you're back on the login page | Not on HTTPS, or `APP_URL` doesn't match the address in the browser. |
| `502 Bad Gateway` | The app isn't running. Check `docker compose ps` and the logs. |
| certbot: "Timeout during connect" or "NXDOMAIN" | DNS hasn't updated yet (step 2), or port 80 is blocked in the provider firewall. |
| `docker compose build` is killed or freezes | Out of memory. Check `free -h`: the swap from step 4 should show 2G. |
| `Permission denied (publickey)` on SSH | Wrong key or wrong user. Log in as `<you>`, not root. The provider's web console still works if you're locked out. |
| Printer won't pair | Web Bluetooth needs Chrome, HTTPS and Bluetooth turned on for the tablet. It doesn't work in Samsung Internet. |
