# VPS upgrade plan: Ubuntu 24.04 LTS to 26.04 LTS

Step-by-step plan for upgrading the production VPS in a school holiday window.
It complements docs/DEPLOY_HOSTINGER_VPS.md (how the server is built) and
docs/OPS-RUNBOOK.md (day-to-day operation). No IP addresses or secrets belong
in this file: use the names from your own notes.

**Why a plan at all.** On 2026-11-18 a routine `apt upgrade` plus reboot took
the site down for about 25 minutes. This server started from Hostinger's
"OpenLiteSpeed and Django" image; the openlitespeed package upgrade replaced
`/etc/systemd/system/lshttpd.service` with a real file (destroying the mask),
LiteSpeed started at boot, grabbed ports 80 and 443, and Caddy could not start.
A release upgrade touches far more packages than that, so every step below
either prevents that trap or checks for it.

What does NOT change: the database is the external managed Postgres, so the
school's data is not on the disk being upgraded. The OS upgrade can take the
site down; it cannot lose data, as long as the snapshot below exists.

---

## 1. When

- A holiday window (winter break or Semana Santa), on a weekday morning when
  someone from the school can confirm the site works afterwards. Not a Sunday
  morning before 05:00 (the monthly restore drill runs then) and not 02:00 to
  03:00 (the nightly backup).
- Budget: 2 hours, of which about 45 minutes are the upgrade itself. Decide in
  advance the rollback deadline (for example: not fixed 60 minutes after the
  reboot → restore the snapshot).
- Tell the office the portal may be unavailable for up to two hours. The
  cafetería is closed in a holiday, so no POS sync is lost (the 7-day nightly
  re-read covers any gap anyway).

## 2. One week before

Run these on the server (`ssh` as the deploy user; on login, the Hostinger
wizard that ends in «Your domain:» must be cancelled with **Ctrl+C**, never
answered: answering makes LiteSpeed configure itself for the domain).

```bash
lsb_release -d; uname -r
docker --version; docker compose version
systemctl is-enabled lshttpd        # must print: masked
apt-mark showhold                   # must list: openlitespeed
timedatectl | grep 'Time zone'      # must be America/Mexico_City
crontab -l | grep -c manage.py      # write the number down
df -h /                             # at least 10 GB free
command -v gpg && gpg --version | head -1
```

- If `lshttpd` is not `masked` or openlitespeed is not held, fix it now, not on
  the day (docs/DEPLOY_HOSTINGER_VPS.md, Step 0, and the 2026-11-18 fix):
  `sudo systemctl disable --now lshttpd`, move a real
  `/etc/systemd/system/lshttpd.service` file aside, `sudo systemctl daemon-reload`,
  `sudo systemctl mask lshttpd`, `sudo apt-mark hold openlitespeed`.
- Check that the release upgrade is offered: `/etc/update-manager/release-upgrades`
  has `Prompt=lts`, and `sudo do-release-upgrade -c` reports 26.04. (LTS to LTS
  upgrades open with the first point release, 26.04.1.)
- Docker: check where it comes from with `apt-cache policy docker-ce`. If it is
  Docker's own repository (download.docker.com), confirm that repository
  already publishes packages for the 26.04 release before the window. The
  upgrader disables third-party repositories; you will point Docker's at the
  new release afterwards (section 5).
- Backups: the console's three lights (*Respaldo nocturno*, *Copia externa*,
  *Prueba de restauración*) should be green. Run a restore drill by hand if
  the last one is old:
  `cd /opt/interlaken/deploy && ./restore-db.sh "$(ls -t /var/backups/interlaken/db-*.sql.gz | head -1)"`.
- Make sure two ways in work: SSH with a key from your computer, and the hPanel
  browser terminal as the fallback (it truncates long pastes: type short
  commands there).
- Make sure the person who holds the backup PRIVATE key is reachable that day.

## 3. On the day, before upgrading

1. **Fresh backup**, and confirm it ends with exit status 0:

   ```bash
   cd /opt/interlaken/deploy && ./backup-db.sh; echo "exit $?"
   ```

2. **Hostinger snapshot.** hPanel → VPS → *Snapshots & Backups* → *Create
   snapshot*. Wait until it says it is complete (several minutes). A new
   snapshot replaces the previous one, which is fine. Do not continue without it.

3. **Write down the "before" state** (kept in the deploy user's home):

   ```bash
   crontab -l > ~/crontab.before
   apt-mark showhold > ~/holds.before
   systemctl list-unit-files --state=enabled > ~/units.before
   docker compose -f /opt/interlaken/deploy/docker-compose.yml ps > ~/compose.before
   ```

4. **Bring 24.04 fully up to date and reboot once**, so the release upgrade
   starts from a clean state:

   ```bash
   sudo apt update && sudo apt full-upgrade
   systemctl is-enabled lshttpd   # still: masked
   apt-mark showhold              # still: openlitespeed
   sudo reboot
   ```

   After the reboot (Ctrl+C the «Your domain:» wizard), check the site and
   who holds the web ports. Only Docker may be listening on 80 and 443:

   ```bash
   sudo ss -tlpn | grep -E ':(80|443) '     # docker-proxy only, never lshttpd/litespeed
   curl -fsS https://interlaken.edu.mx/healthz
   ```

5. **Pause scheduled jobs** for the duration (they would only fail into the
   logs while Docker restarts). The reboot at the end starts cron again.

   ```bash
   sudo systemctl stop cron
   ```

## 4. The upgrade

```bash
sudo do-release-upgrade
```

- Over SSH it offers a second SSH daemon on port 1022 as a fallback. The
  firewall (firewalld on this image) does not open it; the hPanel browser
  terminal is the fallback instead. Do not open extra ports.
- *Third-party sources disabled* (Docker, LiteSpeed): expected. Continue.
- *Configuration file changed* prompts (for example `sshd_config`): keep the
  currently installed version unless you know why the new one is needed.
- **openlitespeed must stay held and masked.** If the upgrader stops because of
  held packages, or lists openlitespeed among packages to remove or upgrade,
  stop and decide deliberately; do not unhold it to make the upgrader happy.
  At the *Remove obsolete packages?* prompt answer **N** if openlitespeed is in
  the list (obsolete packages can be removed later, on purpose).
- Let it reboot at the end. Log in again and cancel the «Your domain:» wizard
  with Ctrl+C.

## 5. After the upgrade: verify everything

Work down the list; stop at the first failure and fix it before going on.

**The LiteSpeed trap, first:**

```bash
lsb_release -d                         # 26.04
systemctl is-enabled lshttpd           # masked
systemctl is-active lshttpd            # inactive
apt-mark showhold                      # openlitespeed
sudo ss -tlpn | grep -E ':(80|443) '   # docker-proxy only
sudo firewall-cmd --list-all           # ssh, http, https as before
```

If LiteSpeed holds 80/443: `sudo systemctl disable --now lshttpd`, wait until
the ports are free, mask it again (section 2), then
`cd /opt/interlaken/deploy && docker compose up -d caddy`.

**Docker and the stack:**

```bash
docker --version && docker compose version
cd /opt/interlaken/deploy && docker compose ps     # app healthy, caddy up
```

If Docker came from download.docker.com, point its source at the new release
(the codename `lsb_release -cs` prints) in `/etc/apt/sources.list.d/`, then
`sudo apt update && sudo apt install --only-upgrade docker-ce docker-ce-cli containerd.io docker-compose-plugin docker-buildx-plugin`.
If the stack is not up: `docker compose up -d` (never `down -v`).

**The site:**

```bash
curl -fsS https://interlaken.edu.mx/healthz   # {"status":"ok","db":true,"cache":true}
```

Then open the site and `/login` in a browser, sign in to the console, and
check the TLS certificate is valid. The external uptime check (GitHub,
every 10 minutes) should stay green.

**Time zone and cron** (Ubuntu's cron ignores `CRON_TZ`: the host clock must be
Mexico City, or every job fires six hours early):

```bash
timedatectl | grep 'Time zone'        # America/Mexico_City
systemctl is-active cron              # active
crontab -l | diff - ~/crontab.before  # no output
```

If the zone changed: `sudo timedatectl set-timezone America/Mexico_City && sudo systemctl restart cron`.

**Backups, end to end:**

```bash
command -v gpg && gpg --version | head -1
cd /opt/interlaken/deploy && ./backup-db.sh; echo "exit $?"    # exit 0
./restore-db.sh "$(ls -t /var/backups/interlaken/db-*.sql.gz | head -1)"
```

The drill must print the counts and «Base de prueba eliminada.». In the console,
*Respaldo nocturno*, *Copia externa* and *Prueba de restauración* are green.

**Cafetería (Loyverse) and email:**

```bash
docker compose exec -T app python manage.py sync_purchases
docker compose exec -T app python manage.py check_loyverse_webhook
tail -n 20 /var/log/interlaken/loyverse.log
docker compose exec -T app python manage.py send_test_email <an admin address>
```

In the console, *Estado de la sincronización* shows «Loyverse responde» and
«Sondeo al día» within five minutes.

**Housekeeping:** confirm automatic security updates are still on
(`systemctl is-enabled unattended-upgrades`), and remove the `~/*.before`
files once everything is green.

**The next morning:** `/var/log/interlaken/backup.log` shows the 02:30 backup
and the 07:45 check; `/var/log/interlaken/loyverse.log` shows the 06:07 roster
sync. If any of them is missing, cron or the time zone is wrong.

## 6. Rollback

If the site is not healthy by the deadline you set in section 1:

1. hPanel → VPS → *Snapshots & Backups* → *Restore* the snapshot from
   section 3. The disk returns to its state before the upgrade (10 to 20
   minutes).
2. Log in (Ctrl+C the wizard) and run the LiteSpeed checks from section 5:
   `masked`, held, only Docker on 80/443.
3. `curl -fsS https://interlaken.edu.mx/healthz`, `timedatectl`,
   `crontab -l | grep -c manage.py`.

The database is external, so a rollback loses no school data. It only loses
what changed on the VPS disk after the snapshot: log lines, the backup dump
taken after it (run `./backup-db.sh` again), and files uploaded to the `media`
volume during the window (few or none in a holiday).

Then write down what failed, and plan the next attempt with that fixed first.

## 7. Sign-off

- [ ] 26.04 running; `lshttpd` masked; openlitespeed held; only Docker on 80/443
- [ ] `/healthz` ok; login works; certificate valid
- [ ] Time zone America/Mexico_City; crontab unchanged
- [ ] `./backup-db.sh` exit 0; restore drill passed; three backup lights green
- [ ] Loyverse sync and webhook check ok; test email received
- [ ] Next morning: 02:30 backup, 06:07 roster sync and 07:45 check in the logs
