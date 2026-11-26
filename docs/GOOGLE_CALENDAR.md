# Google Calendar for visits

Every visit a family books (web form, «Puertas Abiertas» signup, WhatsApp bot)
becomes an event in a school Google Calendar, and a cancelled visit leaves it.
Bookings never depend on it: if Google is down or the setup is wrong, the visit
is still booked, the school still gets its email and bell notice, and the daily
`sync_calendar` job adds the missing events later.

Families are **not** invited by Google: they already get the school's
confirmation email with an `.ics` file. (`GOOGLE_CALENDAR_INVITE_FAMILY=true`
changes that, but a service account can only invite people with Google
Workspace domain-wide delegation.)

## Why it never worked (until 2026-11-26)

Production's `GOOGLE_CALENDAR_ID` held the **Google sign-in client's id** and
`GOOGLE_CALENDAR_SA_KEY` held the **sign-in client's secret**. Those two values
belong to «Continuar con Google» and cannot write to a calendar. The daily log
said only «not configured». Replace both calendar values as below.

> Do not touch the sign-in client itself (its id and secret in their own
> variables). Only the two `GOOGLE_CALENDAR_…` lines change.

## Part 1: the school's Google admin (about 15 minutes)

Use the school's Google account that manages the website's Google sign-in.

1. **Open the project.** Go to <https://console.cloud.google.com>, sign in, and
   pick the project the website's Google sign-in uses (top bar). Any project
   works; that one keeps everything in one place.
2. **Turn on the Calendar API.** Menu → *APIs & Services* → *Library* → search
   «Google Calendar API» → *Enable*.
3. **Create the service account** (a robot account that writes the events):
   Menu → *IAM & Admin* → *Service Accounts* → *Create service account*.
   Name: `visitas-interlaken`. Skip the optional roles and users → *Done*.
4. **Create its key.** Open the new account → *Keys* → *Add key* → *Create new
   key* → *JSON* → *Create*. A `.json` file downloads.
   - **This file is a password.** Do not email it and do not paste it into a
     chat or WhatsApp. Hand it over on a USB stick or copy it straight to the
     server (Part 2).
   - Write down the account's email, shown on its page:
     `visitas-interlaken@<project>.iam.gserviceaccount.com`.
   - If Google says key creation is disabled by an organization policy
     (`iam.disableServiceAccountKeyCreation`), a Google Workspace super admin
     must allow it for this project first.
5. **Create the calendar.** Go to <https://calendar.google.com> → *Otros
   calendarios* (Other calendars) → **+** → *Crear calendario*. Name: «Visitas
   Interlaken» → *Crear calendario*. (An existing school calendar also works.)
6. **Share it with the robot.** Hover the calendar → ⋮ → *Configuración y uso
   compartido* (Settings and sharing) → *Compartir con personas y grupos
   específicos* (Share with specific people) → *Agregar personas* → paste the
   service account email from step 4 → permission **«Hacer cambios en los
   eventos»** (Make changes to events) → *Enviar*.
7. **Copy the calendar id.** Same page → *Integrar el calendario* (Integrate
   calendar) → *ID de calendario*: it ends in `@group.calendar.google.com`.
8. **Share it with the people** who handle visits (admissions, reception):
   same *Compartir con personas* section, permission «Ver todos los detalles de
   los eventos» or more. The events carry the family's name, phone and email,
   like the console's Visitas list: share it only with staff who need it.

Send the person who deploys: the calendar id (step 7, not secret) and the key
file (step 4, by hand).

## Part 2: on the VPS (the person who deploys)

1. Deploy the version that includes this change. `deploy.sh` creates
   `/opt/interlaken/deploy/secrets/` (owner uid 10001, the app's user, mode 700),
   mounted read-only in the app at `/run/secrets/interlaken/`.
2. Copy the key from your computer to the server's `/tmp` (renamed on the way):

   ```bash
   scp ~/Downloads/<the-downloaded-key>.json interlaken:/tmp/google-calendar.json
   ```

3. On the server, move it into place for the app user, readable by nobody else
   (`secrets/` belongs to uid 10001, so this needs root or sudo):

   ```bash
   cd /opt/interlaken/deploy
   sudo mv /tmp/google-calendar.json secrets/google-calendar.json
   sudo chown 10001:10001 secrets/google-calendar.json && sudo chmod 600 secrets/google-calendar.json
   ```

   Then delete the downloaded copy from your computer.

4. Back up `.env`, then set the two lines (replace the old values):

   ```bash
   cp .env .env.bak-$(date +%Y%m%d)-calendar
   nano .env
   ```

   ```env
   GOOGLE_CALENDAR_ID=<the id from step 7>@group.calendar.google.com
   GOOGLE_CALENDAR_SA_KEY=/run/secrets/interlaken/google-calendar.json
   ```

5. Recreate the app so it reads the new values: `docker compose up -d app`.
6. **Check the connection** (writes nothing):

   ```bash
   docker compose exec -T app python manage.py sync_calendar --check
   ```

   Expected: «Conexión correcta: la cuenta de servicio puede crear eventos en el
   calendario «Visitas Interlaken».» Anything else says what to fix and which
   email to share the calendar with (Part 1, step 6). It never prints the key or
   the old secret.
7. **Add the visits already booked** (from today on; past visits are left out):

   ```bash
   docker compose exec -T app python manage.py sync_calendar
   ```

   The daily 06:15 job does the same, so missing this step only delays them.
8. **Verify:** the upcoming visits appear in «Visitas Interlaken». Book a test
   slot only if the school agrees to cancel it right after: cancelling it from the
   console removes the event.

From then on, `/var/log/interlaken/daily.log` says «Calendario sincronizado: …»
every morning instead of «Google Calendar no está configurado …».

## Rollback

Restore the backup (`cp .env.bak-<date>-calendar .env`) or empty the two
`GOOGLE_CALENDAR_…` lines, then `docker compose up -d app`. Bookings, emails and
the console are unaffected; events already created stay in the calendar until
someone deletes them.

## Rotating the key

Create a new key (Part 1, step 4), replace `secrets/google-calendar.json`
(Part 2, steps 2 and 3), `docker compose restart app`, run the check, then delete
the old key in Google Cloud (*Keys* tab).
