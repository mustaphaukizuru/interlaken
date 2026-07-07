# Prompt 08 — Cafeteria Foundation (Phase A)

**Run in:** fresh session at `D:\Github\interlaken`. **Prereqs:** 02. **Reference:** `CAFETERIA_WALLET_SPEC.md` §7 (R1–R6), `DEPLOYMENT.md` §3. **Size:** M.

## Context
See `prompts/README.md`. The cafeteria wallet needs a runnable foundation before pipelines. The host has **no Celery/Redis** — background work runs via **cron + management commands**. Email is console-only. The Loyverse client freezes its token at import and does a non-atomic points update.

## Goal
Stand up the scheduling/notification/Loyverse foundation and validate the one blocking risk (R1) before building payments.

## Tasks
1. **⚠️ Validate R1 first.** Confirm whether the Loyverse API allows **writing** `total_points` via `PATCH /customers/<id>` (some plans make points read-only). Write findings to `CAFETERIA_WALLET_SPEC.md` (a "R1 result" note). If writes are unsupported, propose the alternative (local ledger + reconcile) and STOP before Prompt 10.
2. **Refactor the Loyverse client** (`apps/cafeteria/services.py`): stop reading token/HEADERS at import; build a `requests.Session` per call (or lazily) from `settings.LOYVERSE_API_TOKEN`. Add timeouts/retries. Make `add_points_to_customer` **atomic + idempotent** (wrap the balance row in `select_for_update`; guard against double-apply).
3. **Real email backend.** Ensure `base.py` reads `EMAIL_*` from env (it does) and add prod SMTP values to `.env.example` (`mail.interlaken.edu.mx:587` TLS). Keep console backend in dev.
4. **Notification helper.** Add `apps/portal/services.py` with `notify(user, notif_type, title, message, email=True, whatsapp=False)` that creates a `Notification` and (optionally) sends email; single place both cafeteria and bookings will use.
5. **Management-command scaffolding** (cron targets):
   - `python manage.py sync_balances` → calls `sync_all_balances()`.
   - `python manage.py low_balance_alerts` → notifies parents of students under threshold (dedup so it doesn't spam daily).
   - (Placeholder) `python manage.py sync_purchases` → implemented in Prompt 09.
   Document the exact cPanel cron lines in `DEPLOYMENT.md` §3.

## Constraints
- No Celery/Redis. Keep local dev on SQLite + console email.
- Don't change the cafeteria API surface yet (that's 09–11).

## Acceptance / verify
- `python manage.py check` passes; `python manage.py sync_balances` runs without import-time token errors (mock/skip network if no creds).
- `python manage.py low_balance_alerts` creates a `Notification` for a seeded low-balance student and prints a summary.
- R1 outcome recorded in the spec.

## Do NOT
- Wire payment gateways here. Send real emails in dev.
