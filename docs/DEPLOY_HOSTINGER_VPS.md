# Deploying the parent portal to a Hostinger VPS

The portal runs as Docker containers on one box: Django + gunicorn serving the
built React SPA, behind Caddy for HTTPS. The database is external — the managed
Postgres named by `DB_HOST` in `deploy/.env`.

```
interlaken.edu.mx
        |
   Caddy  :80 :443        automatic Let's Encrypt certificate, auto-renewing
        |
   app    :8000           gunicorn, not reachable from the internet
        |
   managed Postgres       external, named by DB_HOST
```

Running Postgres on this box instead is supported and one line away — see
[Running the database on this box](#running-the-database-on-this-box) — but it
is not the default, and nothing in day-to-day operation requires it.

Everything below assumes a Hostinger **KVM 2** running **Ubuntu 22.04 or 24.04**
with Docker. Allow about 45 minutes for a first deployment.

> **Order matters in one place:** DNS must point at the VPS *before* the first
> deploy, because Caddy proves domain ownership over port 80 to obtain the
> certificate. Deploying first just means waiting and retrying.

---

## Before you start

Collect these. Steps stall without them.

| Item | Where it comes from |
|---|---|
| VPS IP address | hPanel → VPS → Overview |
| Root SSH access | hPanel → VPS → SSH access (or the password emailed at setup) |
| Current Render environment variables | Render dashboard → Environment (copy the values) |
| DNS access for `interlaken.edu.mx` | Akky (`ns1.akkyservicios.mx`) - this domain is NOT on Hostinger nameservers |

Two Render values must be copied **verbatim**, not regenerated:

- `SECRET_KEY` — a new one logs everybody out and invalidates password-reset
  links already sitting in parents' inboxes.
- `FIELD_ENCRYPTION_KEY` — a new one does not error, it silently makes
  already-encrypted database fields unreadable. Permanently.

---

## Step 0 — Clear the preinstalled web server

Hostinger's **"OpenLiteSpeed and Django"** template ships a running LiteSpeed
server holding ports 80 and 443. Caddy cannot bind them while it is there, and
the failure is confusing: Caddy exits, the app container looks healthy, and the
site is simply unreachable.

Confirm what is listening:

```bash
sudo ss -tulpn | grep -E ':(80|443)'
```

Then stop it permanently. `mask` is deliberate: `disable` alone lets a package
update or a dependency start it again, and it would then fight Caddy for the
port on a reboot.

```bash
sudo systemctl disable --now lshttpd 2>/dev/null || sudo /usr/local/lsws/bin/lswsctrl stop
sudo systemctl mask lshttpd 2>/dev/null || true
```

Verify both ports are free before going further. This must print nothing:

```bash
sudo ss -tulpn | grep -E ':(80|443)'
```

The template's sample Django app is unrelated to ours and can be left alone;
nothing references it once LiteSpeed is stopped.

> Alternative, and slightly cleaner if the server is brand new: reinstall the OS
> from hPanel with a **plain Ubuntu 24.04** template. That removes the unused
> LiteSpeed stack entirely rather than leaving it dormant. It also resets root
> access, so redo Step 1 afterwards.

## Step 1 — Secure the server

Log in as root the first time:

```bash
ssh root@YOUR_VPS_IP
```

Create a non-root user, since running the deployment as root is unnecessary risk:

```bash
adduser interlaken
usermod -aG sudo interlaken
rsync --archive --chown=interlaken:interlaken ~/.ssh /home/interlaken
```

Turn on the firewall. Only SSH and web traffic should be reachable:

```bash
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
```

Enable automatic security updates, so the machine patches itself:

```bash
apt update && apt install -y unattended-upgrades
dpkg-reconfigure -plow unattended-upgrades
```

If you signed in with a password, switch to SSH keys and disable password
login (`PasswordAuthentication no` in `/etc/ssh/sshd_config`, then
`systemctl restart ssh`). Password logins on a public IP get brute forced
continuously.

## Step 2 — Install Docker

```bash
curl -fsSL https://get.docker.com | sh
usermod -aG docker interlaken
```

Log out and back in as `interlaken` so the group membership applies, then check:

```bash
docker run --rm hello-world
```

## Step 3 — Get the code

```bash
sudo mkdir -p /opt/interlaken /var/log/interlaken
sudo chown interlaken:interlaken /opt/interlaken /var/log/interlaken
git clone https://github.com/mustaphaukizuru/interlaken.git /opt/interlaken
```

For a private repository, use a deploy key or a personal access token.

## Step 4 — Configure

```bash
cd /opt/interlaken/deploy
cp env.example .env
chmod 600 .env
nano .env
```

Fill in every value. The file documents which ones matter and why. The block
labelled "Public address" is the one that changes because of the move; the rest
are copied from Render as they are.

Leave `AWS_STORAGE_BUCKET_NAME` empty unless object storage is set up.
Uploads then land on the `media` Docker volume, which survives deploys. Switching
to object storage later is just filling in those four lines and redeploying.

## Step 5 — Confirm the DNS

Already done: both names point at the VPS.

```bash
dig +short interlaken.edu.mx        # expect 93.188.162.163
dig +short www.interlaken.edu.mx    # expect 93.188.162.163
```

The domain is delegated to **Akky** (`ns1.akkyservicios.mx`), not Hostinger, so
any future record change happens there rather than in hPanel.

Because these are the live school addresses rather than a spare subdomain, the
old site is already gone from them: until this deploy succeeds, visitors get the
VPS's default page. That makes the deploy time-sensitive in a way a subdomain
would not have been.

## Step 6 — Deploy

```bash
cd /opt/interlaken/deploy
chmod +x deploy.sh
./deploy.sh
```

The first run takes several minutes: it builds the React bundle and installs
Python dependencies. Caddy requests the certificate as soon as it starts.

The container runs database migrations automatically at boot, so there is no
separate migrate step.

## Step 7 — Verify

```bash
curl -I https://interlaken.edu.mx/healthz
```

You want `HTTP/2 200`. Then open the site in a browser and confirm the padlock.

Check that HTTP is redirected rather than served:

```bash
curl -sI http://interlaken.edu.mx | head -1     # expect 308
```

Then sign in as a parent and confirm the cafeteria balance loads. That single
check exercises the database, authentication and the API together.

## Step 8 — Re-register the address with external services

The portal's URL changed, so every service that calls back into it needs
updating. Skipping any one of these breaks that feature silently.

| Service | What to change | Where |
|---|---|---|
| **Google sign-in** | Add `https://interlaken.edu.mx/auth/google/callback/` as an authorised redirect URI | Google Cloud console → Credentials |
| **Loyverse** | Point the receipts webhook at `https://interlaken.edu.mx/api/v1/cafeteria/loyverse/webhook/<SECRET>/` | Loyverse → Integrations → Webhooks |
| **Banorte** | Nothing to point: the lightbox needs no webhook or return URL. Put the merchant credentials and the current certificate in `.env` and run `check_banorte` (see `docs/BANORTE-INTEGRATION.md`) | VPS `deploy/.env` |

Test the Loyverse webhook with a real purchase at the till. The parent's balance
should move within seconds.

## Step 9 — Install the scheduled jobs

Cron on this box is the only scheduler: the GitHub workflows that used to run
the cafeteria sync, the daily reminders and the database backup were deleted
when the database moved here (Actions cannot reach a database that listens only
on the private network — and Actions fired the "every five minutes" sync
roughly hourly anyway).

```bash
sudo timedatectl set-timezone America/Mexico_City && sudo systemctl restart cron  # cron reads the HOST clock
sudo mkdir -p /var/log/interlaken /var/backups/interlaken
crontab /opt/interlaken/deploy/crontab.example   # the file IS the crontab: install it whole
crontab -l | grep -c manage.py                   # sanity: the number of app jobs installed
```

`deploy/crontab.example` is the crontab, not a template: never edit the live
crontab by hand, and **re-run that `crontab` line after every deploy that
changes the file** (`deploy.sh` does not touch cron). Release note 2026-09-24:
the live crontab must be reinstalled with this deploy; the nightly Loyverse
jobs moved from 05:40/06:05 to 05:42/06:07 and from `flock -n` to
`flock -w 900` (they shared the poll's lock, lost the race every morning and
`sync_roster` had never run).

That installs five things: the cafeteria sync every five minutes, the nightly
Loyverse convergence (receipt re-read at 05:42, roster sync at 06:07), the
daily reminder/notification batch, the nightly database backup at 02:30, and
two watchdogs that email if the sync, the roster sync or the backup stops
producing output.

Confirm after ten minutes:

```bash
tail -n 30 /var/log/interlaken/loyverse.log
cd /opt/interlaken/deploy && ./backup-db.sh     # prove the backup path works now
ls -lh /var/backups/interlaken/
```

## Running the database on this box

Optional. The default is an external managed Postgres, and it is a perfectly
good place for it to stay. Move it here only if you want one less external
dependency (or one less bill).

Two lines in `deploy/.env` switch the stack over — the overlay adds the Postgres
container, and removing `DB_HOST` points the app at it:

```
COMPOSE_FILE=docker-compose.yml:docker-compose.localdb.yml
# DB_HOST=…  ← delete this line
```

`deploy.sh` refuses if neither is configured, and prints which database each run
is using either way. If there is existing data to bring across, the section
below does it for you; on a fresh install there is nothing to move.

## Moving the data off Supabase (one time)

Skip this on a fresh install — `migrate` creates an empty schema at first boot
and there is nothing to move. Do it if the school's live data is still on
Supabase.

The cutover is a dump and a restore. It takes minutes at this data size, and the
old database keeps working until you point the app away from it, so a failed
attempt costs nothing but a retry.

**The short version — one command:**

```bash
cd /opt/interlaken/deploy && ./migrate-from-external-db.sh
```

It refuses unless `.env` still names an external host, refuses if the local
database already holds data, stops the app so nothing is written mid-copy,
records the source row counts *before* dumping, restores, and compares the
counts afterwards — restarting the app against the external database and
keeping the dump if they do not match. It never writes to the external
database. When it finishes it prints the single line to delete to make the
switch.

The manual steps below are what it does, kept for when you want to run them
yourself or something needs unpicking.

**1. Take the site down for the few minutes of the copy** — otherwise a payment
or a cafeteria sync lands in Supabase after the dump and is lost:

```bash
cd /opt/interlaken/deploy
crontab -l > /tmp/cron.bak && crontab -r        # stop the sync/reminder jobs
docker compose stop app                          # stop writes; Caddy still answers
```

**2. Dump Supabase** (from this box, using the pooler host that is still in the
old `.env`; the client must be Postgres 17 to match the server):

```bash
docker run --rm -e PGPASSWORD='<old DB_PASSWORD>' postgres:17-alpine   pg_dump --no-owner --no-privileges           -h '<old DB_HOST>' -p 5432 -U '<old DB_USER>' -d '<old DB_NAME>'   | gzip > /root/supabase-final.sql.gz
gunzip -t /root/supabase-final.sql.gz && echo "dump is a valid gzip"
```

**3. Set the local credentials, but do NOT flip the switch yet** — set
`DB_NAME`, `DB_USER` and a fresh `DB_PASSWORD` (`openssl rand -base64 32`).
Leave `DB_HOST` alone for the moment: while it still names the Supabase host,
every deploy keeps reading Supabase, which is what makes this reversible.

`deploy.sh` prints which database it is about to use on every run, so there is
no guessing:

```
  database: EXTERNAL (aws-0-….pooler.supabase.com) - the local db container will run but go unused.
  database: local db container (pgdata volume on this box).
```

**4. Start the database and restore into it** (still pointing at Supabase, so
the site keeps serving while this runs):

```bash
docker compose up -d db
docker compose exec db pg_isready -U <DB_USER> -d <DB_NAME>      # wait for ready
gunzip -c /root/supabase-final.sql.gz | docker compose exec -T db psql -q -U <DB_USER> -d <DB_NAME>
```

**5. Verify before trusting it.** Compare against the numbers you know:

```bash
docker compose exec db psql -U <DB_USER> -d <DB_NAME> -c   "SELECT (SELECT count(*) FROM accounts_user) AS users,
          (SELECT count(*) FROM accounts_studentprofile) AS students,
          (SELECT count(*) FROM cafeteria_cafeteriatransaction) AS ledger,
          (SELECT count(*) FROM payments_payment) AS payments;"
```

**6. Flip the switch and bring it back up.** Delete the `DB_HOST` line from
`.env` (and `DB_PORT`/`DB_SSLMODE` if present) — that, and only that, is what
moves production onto the local database:

```bash
sed -i '/^DB_HOST=/d;/^DB_PORT=/d;/^DB_SSLMODE=/d' .env
./deploy.sh                                      # prints "database: local db container"; migrate is a no-op
crontab /tmp/cron.bak                            # restore the scheduled jobs
./backup-db.sh                                   # first local backup, immediately
```

Then log in, open the cafeteria page for a student with a balance, and check the
figure matches what it was before the move.

**Keep the Supabase project for a week**, paused but not deleted: it is the only
rollback that still holds the data. To roll back, put the old `DB_*` values back
in `.env`, remove the `DB_HOST`/`DB_PORT`/`DB_SSLMODE` overrides from
`docker-compose.yml`, and redeploy. Delete the project once the local backups
have run for several nights and been restored once as a test.

---

## Step 10 — Render is retired

Render is gone: the service, its blueprint (`render.yaml`) and its deploy doc were
removed once the VPS had served a full school day. Nothing in this repository
targets Render any more.

Rollback is now local to this box and faster than the old DNS swap: the
previous image is kept as `interlaken-app:previous`, and the three commands in
[Rolling back](#rolling-back) put it back in seconds without a build. (Resetting
the checkout to an older commit and running `./deploy.sh` does NOT roll back:
the script resets to `origin/master` first. To pin older code, revert the
commit on master and deploy that.) The database is unaffected by an
application rollback.

---

## Observability, push, and hardening

All optional — every item below is inert until its variable is set in
`deploy/.env` (see `deploy/env.example`).

**Sentry (backend)**

| Var | Meaning |
|---|---|
| `SENTRY_DSN` | Enables the SDK. Unset (default) → Sentry is never even imported. |
| `SENTRY_ENVIRONMENT` | Event environment tag. Defaults to `production`. |
| `SENTRY_RELEASE` | Release tag; falls back to `GIT_SHA`, the commit `deploy.sh` bakes into the image as a build arg (so a rolled-back image reports its own commit). |
| `SENTRY_TRACES_SAMPLE_RATE` | Tracing sample rate `0`–`1`. Default `0` (errors only). |

No personal data leaves (`apps/core/sentry.py`): `send_default_pii=False`, no
request bodies (`max_request_body_size="never"`), no local variables, no
cookies, query strings or client IP; the user is reduced to its id, secret
route segments (the Loyverse webhook key) are replaced by their parameter name,
and emails and CURPs are masked in every string. Activation guide in Spanish:
[docs/SENTRY.md](SENTRY.md).

**Sentry (frontend)** — *build-time* Vite vars, baked into the bundle when the
image is built: `VITE_SENTRY_DSN`, `VITE_SENTRY_ENVIRONMENT`,
`VITE_SENTRY_TRACES_SAMPLE_RATE`, `VITE_GIT_SHA`. `docker-compose.yml` passes
`VITE_SENTRY_DSN` through as a build arg, so setting it in `deploy/.env` and
running `./deploy.sh` is enough. Without it the bundle never initialises Sentry.
`deploy.sh` sets `VITE_GIT_SHA` (the release) only when `VITE_SENTRY_DSN` is
set, since a value that changes every commit rebuilds the SPA on every deploy.
The same scrubbing rules apply in the browser (`src/services/sentryScrub.ts`).
Source-map upload (`SENTRY_AUTH_TOKEN` + `@sentry/vite-plugin`) is deliberately
not wired in, so events arrive minified until you add it.

**Logs** — JSON lines on stdout, one object per record with `ts`, `level`,
`logger`, `message` and `request_id`; every response carries `X-Request-ID`
(inbound ids from Caddy are propagated) so a request can be traced end to end.
`LOG_LEVEL` (default `INFO`) adjusts verbosity. The app container logs to the
host journal (journald driver), which survives deploys: a json-file log is
deleted with its container, and every deploy recreates the container. The
journal is persistent and capped by `SystemMaxUse` in
`/etc/systemd/journald.conf` (1 GB on this box), so logs cannot fill the disk.
`docker compose logs -f app` shows the current container; earlier ones:
`journalctl -t interlaken-app --since "2026-11-24 06:00"` (add `| grep ERROR`).

**Error alert emails**: with `ERROR_ALERT_EMAILS` set in `.env` (comma
separated), every unhandled exception and every ERROR from the project's own
code (cron jobs, webhooks) also sends a short email: exception type, masked
message, method and path without query string, request id and code locations.
At most one email per distinct error per hour and 10 per hour in total, per
worker. It needs no third-party account; Sentry stays the better tool once a
DSN exists (`apps/core/error_alerts.py`).

**Database** — `CONN_MAX_AGE` (default `60`) keeps connections warm. With the
database container on the same private network there is no pooler and no TLS
handshake per request, so this is purely a latency win.

**Rate limiting** — abuse-prone endpoints are throttled (login 10/min/IP, reset
5/h/IP, public forms 5/min/IP, booking 10/min/IP, payment initiation
10/min/user). Counters live in a file cache shared across gunicorn workers;
`RATELIMIT_CACHE_DIR` overrides its location. Payment/Loyverse webhooks are
signature-verified and not throttled beyond a generous per-IP ceiling, so a
provider burst is never dropped. Caddy is trusted for the real client IP
(`TRUST_PROXY_IP_HEADER`), which is what makes these limits per-visitor rather
than one global bucket.

**Web push (VAPID)** — inert until the keys exist. Generate a pair once:

```
npx web-push generate-vapid-keys          # Node
vapid --gen                               # py-vapid (pip install py-vapid)
```

Set in `deploy/.env`:

| Var | Meaning |
|---|---|
| `VAPID_PUBLIC_KEY` | base64url public key — sent to browsers on subscribe. |
| `VAPID_PRIVATE_KEY` | private key — signs every push. Keep secret. |
| `VAPID_ADMIN_EMAIL` | `mailto:` contact required by push services. |
| `VITE_VAPID_PUBLIC_KEY` | the **same public key**, build-time: it is baked into the SPA. |

`VITE_VAPID_PUBLIC_KEY` is a Docker build arg, so it only takes effect on the
next `./deploy.sh`. Without it the opt-in card never renders.

Flow once configured: parents opt in on the portal dashboard (subscription
stored per user + device) → publishing a comunicado with **“Enviar notificación
push”** sends the first 20 inline and the `dispatch_notifications` cron on
this box (every 5 minutes) drains the rest → taps open the notification
(`/portal/notificaciones/<id>`) →
expired subscriptions (HTTP 404/410) are pruned automatically on send.

---

## Routine operations

**Deploy a new version**

```bash
cd /opt/interlaken/deploy && ./deploy.sh
```

**Watch the logs**

```bash
docker compose logs -f app
```

**Open a Django shell**

```bash
docker compose exec app python manage.py shell
```

**Create or repair the admin user**

```bash
docker compose exec app python manage.py ensure_superuser
```

**Restart without rebuilding**

```bash
docker compose restart app
```

---

## Backups

Three separate things need backing up, and only one of them is handled for you.

| What | Where it lives | Who backs it up |
|---|---|---|
| School data (parents, payments, ledger) | the external database (or `pgdata` here, if you moved it) | `deploy/backup-db.sh` on this box, nightly, plus its **encrypted** off-site copy to a private bucket once `BACKUP_S3_*` is set (below) |
| Uploaded documents | the `media` Docker volume on this VPS | **nobody, until you set this up** |
| TLS certificate | the `caddy_data` volume | re-issued automatically if lost |

**The backup that runs from this box.** `backup-db.sh` (installed by the
crontab in Step 9) dumps whichever database the app is actually using: it reads
`DB_HOST` the same way the app does, so it cannot end up backing up the wrong,
empty one. It always runs pg_dump from a Postgres 17 image so client and server
versions match (a mismatch is what silently broke the previous GitHub Actions
backup for five nights), refuses to rotate old copies away behind a
suspiciously small dump, keeps 30 days in `/var/backups/interlaken` (readable
only by the backup user), and a second cron entry emails you if a night passes
with no backup at all. An on-box backup does not survive the failure it exists
for, so set up the off-site copy below.

The `db-backup` GitHub workflow is a second, independent copy (GPG-encrypted
too, as a 30-day artifact). It is **disabled**; turning it on is the owner's
decision. It only works while the database is reachable from the internet: if
the database ever moves onto this box, delete that workflow.

Restore one (test first, then for real; details in docs/OPS-RUNBOOK.md §3):

```bash
cd /opt/interlaken/deploy
./restore-db.sh /var/backups/interlaken/db-<date>.sql.gz              # drill: scratch database, counts, dropped
./restore-db.sh /var/backups/interlaken/db-<date>.sql.gz --into-live  # asks you to type RESTAURAR
```

### Off-site copy (encrypted, private bucket)

Every night, right after the dump, `backup-db.sh`:

1. encrypts the dump to `deploy/backup-public-key.asc` (the school's public
   key; the private key is not needed on this path and must never be in the
   repository);
2. checks the result is not readable gzip and is a GPG message for that key;
3. hands **only that encrypted file** to `manage.py offsite_backup`, which
   uploads it to a bucket used for nothing else, checks the copy is there with
   the right size, keeps the newest 30, and reports to the console.

The plaintext dump never leaves the box. The app refuses to upload a plain
gzip, a file encrypted to another key, or anything under another name, and it
never uses the media bucket (`AWS_*`): if `BACKUP_S3_BUCKET` is the media
bucket's name it refuses. If `gpg` or the key file is missing, nothing is
uploaded and the console says why.

Until this is set up, Administración → Cafetería → *Estado de la
sincronización* shows the amber light «Sin copia externa».

**1. Create a private bucket.** Cloudflare R2 is the recommendation (10 GB
free, no fees to download a copy back); Backblaze B2 works the same way.

- R2: Cloudflare dashboard → *R2 Object Storage* → *Create bucket*, any name
  (for example `colegio-respaldos`). Leave it private: do not enable the public
  `r2.dev` URL and do not connect a custom domain. The account's S3 endpoint is
  shown on the R2 overview page: `https://<account id>.r2.cloudflarestorage.com`.
- B2: *Buckets* → *Create a Bucket*, *Files in Bucket are*: **Private**. The
  endpoint is shown on the bucket (`https://s3.<region>.backblazeb2.com`).

Use this bucket for backups only. The CMS media library must get its own.

**2. Create an access key limited to that bucket.** It needs to read, write and
delete objects in that one bucket (delete is for keeping only the newest 30).

- R2: *R2 Object Storage* → *Manage API tokens* → *Create API token*,
  permission **Object Read & Write**, *Apply to specific buckets only* → the
  backup bucket. Copy the *Access Key ID* and *Secret Access Key* (shown once).
- B2: *Application Keys* → *Add a New Application Key*, *Allow access to
  Bucket(s)*: only the backup bucket, *Type of Access*: Read and Write. The
  *keyID* is the access key id, the *applicationKey* is the secret.

**3. Paste the five lines into `/opt/interlaken/deploy/.env`** (`nano .env`,
or build it on your computer and `scp` it, as in Step 4):

```bash
BACKUP_S3_BUCKET=colegio-respaldos
BACKUP_S3_ENDPOINT_URL=https://<account id>.r2.cloudflarestorage.com
BACKUP_S3_ACCESS_KEY_ID=<access key id>
BACKUP_S3_SECRET_ACCESS_KEY=<secret access key>
BACKUP_S3_REGION=auto
```

`BACKUP_S3_REGION` is `auto` for R2; for B2 it is the region inside the
endpoint (for example `us-west-004`). Then recreate the app container so it
reads the new lines (a few seconds):

```bash
cd /opt/interlaken/deploy && docker compose up -d app
```

**4. Run the backup once and watch the light turn green.**

```bash
cd /opt/interlaken/deploy && ./backup-db.sh; echo "exit $?"
```

It should end with `offsite upload verified: db-<date>.sql.gz.gpg`, then
`offsite backup ok: colegio-respaldos/interlaken-db/db-<date>.sql.gz.gpg` and
`exit 0`. Reload the console: the light reads «Copia externa hace menos de un
minuto» in green. If it reads «La copia externa falló», its text says why
(`AccessDenied`: the key or its bucket permission; `Could not connect`: the
endpoint). Fix `.env`, run `docker compose up -d app` and the backup again.

From then on the 07:45 check (`check_backup_fresh`) emails the admins when the
off-site copy is more than a day old or the last attempt failed (once per
problem, then weekly while it lasts).

**Restore from an off-site copy** (the server or its disk is gone). Do this
on the computer that holds the school's PRIVATE key, never on a shared one:

```bash
gpg --import interlaken-backup-PRIVATE-key.asc                  # once per computer
# download the newest db-<date>.sql.gz.gpg from the bucket (dashboard → bucket → Download)
gpg --decrypt db-<date>.sql.gz.gpg > db-<date>.sql.gz
scp db-<date>.sql.gz <user>@<server>:/var/backups/interlaken/  # the rebuilt server
```

Then on the server, drill first and restore for real only after the counts
look right:

```bash
cd /opt/interlaken/deploy
./restore-db.sh /var/backups/interlaken/db-<date>.sql.gz
./restore-db.sh /var/backups/interlaken/db-<date>.sql.gz --into-live
```

Delete the decrypted `db-<date>.sql.gz` from your computer afterwards: it is
every family's data in the clear. (`restore-db.sh` refuses a `.gpg` file and
prints the `gpg --decrypt` line to run first.)

Good to know:

- The access key on this server can delete objects in the backup bucket (it
  has to, to keep only 30). If you want copies that even a compromised server
  cannot delete, turn on Object Lock (B2) or a bucket lock rule (R2) for, say,
  30 days. Rotation then only logs `rotation skipped` until a copy ages out.
- An extra copy made by the host itself is still possible with
  `BACKUP_REMOTE` (an rclone remote or an scp target); it also receives only
  the `.gpg` file, and its result shows in the same console light.
- Rotating the GPG key means replacing `deploy/backup-public-key.asc`, the
  fingerprint in `deploy/backup-encrypt.sh` and `BACKUP_KEY_IDS` in
  `backend/apps/core/backups.py` together; a test fails if they disagree.

**Uploaded documents are the gap.** Admission documents are legally retained,
and a Docker volume on a single VPS is one failed disk away from gone. Back the
volume up nightly and copy the archives off the box:

```bash
sudo tee /etc/cron.daily/interlaken-media >/dev/null <<'SH'
#!/bin/sh
docker run --rm -v interlaken_media:/src:ro -v /var/backups/interlaken:/dst alpine   tar czf /dst/media-$(date +%F).tar.gz -C /src .
find /var/backups/interlaken -name 'media-*.tar.gz' -mtime +30 -delete
SH
sudo chmod +x /etc/cron.daily/interlaken-media
```

Copy those archives off the machine as well. A backup that only exists on the
server it protects is not a backup.

### Moving documents to object storage later (optional)

The app speaks S3, so any S3-compatible bucket works if you later decide the
media volume should not live on this box. Filling in the `AWS_*` values switches
new uploads to object storage, but it does **not** move the files already on the
volume, and Django will keep looking for them in the new place. They become
broken links.

Copy them across before switching:

```bash
docker compose exec app python manage.py shell -c "
from django.core.files.storage import storages
print(storages['default'])"     # confirm which backend is active first
```

Then sync the volume's contents into the bucket with any S3 client, keeping the
same key paths, before you redeploy with the new settings.

---

## Rolling back

`deploy.sh` tags the running image as `interlaken-app:previous` before each
build, and exits non-zero (printing this command) if the new one never becomes
healthy, or if `check_money_queries` finds a row-locked payment, cafetería or
bulk-action query that fails on the production database (it runs right after
the live check, read-only, inside a transaction that is always rolled back).
To go back, from `/opt/interlaken/deploy`:

```bash
docker tag interlaken-app:previous interlaken-app:latest
docker tag interlaken-app:previous interlaken-app:current
docker compose up -d --no-build --force-recreate app
```

Compose runs the image it builds, `interlaken-app:latest`; `:current` and
`:previous` are only bookmarks. Re-tagging `:current` alone (what this section
and `deploy.sh` said until 2026-11-18) recreates the container from the NEW
image again: checked with a throwaway compose project. Re-tagging `:current`
as well keeps the next deploy's rollback point on the good image. Afterwards,
revert or fix the commit on master before the next `./deploy.sh`, which would
otherwise rebuild the same code. Migrations the new version applied stay
applied; the previous image runs on them as long as they were additive.

If the whole VPS is in trouble, the fastest recovery is DNS: point the record
back at Render, which is why the runbook says not to delete that service
immediately.

---

## Things that will bite you

**Never run `docker compose down -v`.** The `-v` deletes the named volumes,
which means every uploaded document and the TLS certificate. Plain
`docker compose down` is safe.

**Do not prune volumes.** `docker volume prune` will happily delete `media` and
`caddy_data` if the stack is stopped. Losing `caddy_data` also burns Let's
Encrypt rate limits when the certificate has to be re-issued.

**Never `docker compose down -v`.** The `-v` deletes named volumes, and
`pgdata` is the school's entire database. `down` on its own is safe.

**Deleting the `DJANGO_SUPERUSER_*` lines is deliberate.** They exist so the
first boot can create an admin account. On a VPS you have `docker compose exec`,
so leaving an admin password sitting in a file on disk buys nothing.

---

## Troubleshooting

**The certificate is not issued.** Caddy needs port 80 reachable from the
internet and DNS already pointing here. Check `dig +short interlaken.edu.mx`
matches the VPS IP, that `ufw status` allows 80, and then
`docker compose logs caddy`.

**Every request redirects forever.** Django redirects to HTTPS unless the proxy
sends `X-Forwarded-Proto: https`. Confirm that line is still present in the
`Caddyfile`.

**`400 Bad Request` on every page.** The hostname is missing from
`ALLOWED_HOSTS` in `.env`. Add it and redeploy.

**The container keeps restarting.** Almost always a database connection problem.
`docker compose logs app` will show it, and `docker compose logs db` shows the
other side. Check `DB_NAME`/`DB_USER`/`DB_PASSWORD` in `.env` — remember the
password is baked into the volume at first boot, so editing it later in `.env`
authenticates against the old one until you `ALTER USER` inside the container.

**Permission denied writing an upload, after switching to the non-root image.**
A named volume created earlier is owned by root, while the container now runs as
uid 10001. Fix it once:
`docker run --rm -v interlaken_media:/d alpine chown -R 10001:10001 /d`

**Uploads disappear after a deploy.** `MEDIA_ROOT` is not pointing at the mounted
volume. Compose sets it to `/data/media`; confirm nothing in `.env` overrides it.
