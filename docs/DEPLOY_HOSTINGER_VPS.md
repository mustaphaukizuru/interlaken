# Deploying the parent portal to a Hostinger VPS

The portal runs as a single Docker container (Django + gunicorn, serving the
built React SPA), behind Caddy which handles HTTPS. The database is **not** on
this server: it stays on Supabase. This box only serves the application.

```
interlaken.edu.mx
        |
   Caddy  :80 :443        automatic Let's Encrypt certificate, auto-renewing
        |
   app    :8000           gunicorn, not reachable from the internet
        |
   Supabase Postgres      external, unchanged
```

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

Leave `AWS_STORAGE_BUCKET_NAME` empty for now if Supabase Storage is not set up.
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
| **Global Payments** | Update the webhook and return URLs | Merchant dashboard |
| **Banorte** | Update the webhook and return URLs | Merchant dashboard |

Test the Loyverse webhook with a real purchase at the till. The parent's balance
should move within seconds.

## Step 9 — Move the scheduled jobs

The cafeteria sync and the daily reminders currently run on GitHub Actions.
Move them here, where cron actually honours a five minute interval (Actions was
scheduled every five minutes but fired roughly hourly).

```bash
crontab -e            # paste the contents of deploy/crontab.example
```

Then **disable the GitHub workflows**, or both will run against the same
database. The work itself is idempotent so nothing is double charged, but the
Actions runs also execute `migrate`, which can collide with a container restart.

In the repository, go to Actions and disable **Loyverse cafeteria sync** and
**scheduled-tasks**. Keep **db-backup** running unless you replace it here.

Confirm cron is working after ten minutes:

```bash
tail -n 30 /var/log/interlaken/loyverse.log
```

## Step 10 — Retire Render

Leave the Render service running for a few days as a fallback. Once the VPS has
handled a full school day, including a cafeteria purchase and a parent login,
suspend it.

Do not delete the Render service until you are certain, since it is the fastest
rollback available: point DNS back and it serves again.

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
| School data (parents, payments, ledger) | Supabase | Supabase, plus the `db-backup` GitHub workflow |
| Uploaded documents | the `media` Docker volume on this VPS | **nobody, until you set this up** |
| TLS certificate | the `caddy_data` volume | re-issued automatically if lost |

**Leave the `db-backup` GitHub workflow enabled.** It is the only thing taking
database backups, it does not conflict with the VPS cron jobs, and nothing here
replaces it.

**Uploaded documents are the gap.** Admission documents are legally retained,
and a Docker volume on a single VPS is one failed disk away from gone. Either
switch on Supabase Storage (below), which is the better answer, or back the
volume up nightly:

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

### Moving documents to Supabase Storage later

Filling in the `AWS_*` values switches new uploads to object storage, but it
does **not** move the files already on the volume, and Django will keep looking
for them in the new place. They become broken links.

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
build, and exits non-zero if the new one never becomes healthy. To go back:

```bash
docker tag interlaken-app:previous interlaken-app:current
docker compose up -d --force-recreate app
```

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

**The database is not backed up by this server.** Supabase holds the data and
its own backups. If you disable the `db-backup` GitHub workflow, arrange a
replacement before you do.

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
`docker compose logs app` will show it. Check the `DB_*` values, and that
Supabase is reachable from this server.

**Permission denied writing an upload, after switching to the non-root image.**
A named volume created earlier is owned by root, while the container now runs as
uid 10001. Fix it once:
`docker run --rm -v interlaken_media:/d alpine chown -R 10001:10001 /d`

**Uploads disappear after a deploy.** `MEDIA_ROOT` is not pointing at the mounted
volume. Compose sets it to `/data/media`; confirm nothing in `.env` overrides it.
