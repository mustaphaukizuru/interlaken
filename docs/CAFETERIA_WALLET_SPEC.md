# Colegio Interlaken — Cafeteria Wallet & Notifications Spec

**Generated:** 2026-07-07 · Companion to [STATUS_REPORT.md](STATUS_REPORT.md) & [DESIGN.md](DESIGN.md)

**Goal:** A prepaid cafeteria "wallet" for each student, powered by **Loyverse**, where:
- a **parent** is **notified (in-app + email/WhatsApp)** the moment their child buys something,
- the **parent** sees **live balance + full purchase history**, and can **add money** via **Global Payments** or **Banorte**,
- the **school admin** sees **every student's balance, history, and deposits**, can **top up / adjust / refund**, and can **reconcile against Loyverse**.

> **Design note (1 point = 1 MXN):** the app treats Loyverse loyalty **points** as pesos. This is a workaround — see **§7 Risk R1** before building the money-in flow; it's the one thing to validate first.

---

## 1. Current state — you're ~60% there in the schema, ~15% in the pipelines

| Requested capability | What already exists (real code) | What's missing |
|---|---|---|
| **1. Parent notified/emailed on purchase** | `Notification` model **with `CAFETERIA` + `PAYMENT` types** (`portal/models.py:38-40`); `StudentProfile.parents` M2M (fan-out to all guardians) | Nothing detects purchases; no `Notification` is created; email backend is **console-only**; no WhatsApp |
| **2. Parent sees purchase history** | `GET /api/v1/cafeteria/transactions/` role-scoped to their children (`cafeteria/views.py:54-81`); `CafeteriaTransaction` model | **Table is never populated** — `get_recent_transactions()` exists but is **never called** (`services.py:58`); no item-level detail |
| **3. Parent sees balance** | `GET /api/v1/cafeteria/balance/` returns all children's balances (`views.py:26-51`); `CafeteriaBalance` w/ `is_low_balance` | Balance **never auto-refreshes** — `sync_all_balances()` exists but **nothing schedules it** |
| **4. Parent adds money (Global Payments / Banorte)** | `TopUpRequest(method=online\|office)`; `Payment(type='cafeteria')`; `PaymentInitiateView`; webhook; `add_points_to_customer()` | Global Payments is a **stub** (`payments/views.py:36` `pass`); **Banorte absent**; webhook **doesn't** credit Loyverse; webhook **unauthenticated**; no invoice/factura |
| **5. Admin: history / balance / deposits / add / more** | `admin/balances/`, `transactions/` (all), `admin/topup/<pk>/apply/`, `admin/sync/<pk>/`, `admin/sync-all/` (`urls.py:8-11`) | No **deposits/top-up log** view, no **manual adjustment/refund**, no **reconciliation**, no **export**, no **low-balance report** |

**Bottom line:** the models and most endpoints are in place. What's missing is the **two pipelines** (purchases-in → notify, money-in → credit) and the **notification channels**.

---

## 2. Target architecture — two pipelines

### 2.1 Purchase → notification pipeline (Feature 1, 2, 3)

```
Loyverse (child taps card at POS, buys items)
        │
        ├─ (preferred) Loyverse WEBHOOK  receipts.created ─┐
        └─ (fallback)  Celery Beat poll /receipts every ~2–5 min ─┐
                                                                   ▼
                              sync_purchases task:
   1. for each new receipt where customer_id == StudentProfile.loyverse_id
   2. idempotent create CafeteriaTransaction(type=purchase, amount, items,
        loyverse_receipt_id)   ← unique receipt_id makes this safe to re-run
   3. update CafeteriaBalance.balance (+ last_synced)
   4. for each parent in student.parents.all():
        → Notification(type=cafeteria, "Compra en cafetería: $X")
        → email (real SMTP)  [+ optional WhatsApp]
   5. if balance < low_balance_threshold → low-balance alert (deduped)
```

- **Idempotency** is free: `CafeteriaTransaction.loyverse_receipt_id` is `unique` (`models.py:48`) — re-processing a receipt is a no-op.
- **Real-time vs. polling:** use Loyverse **webhooks** if the store's plan supports them; otherwise a **Celery Beat** poll (celery + redis + django-celery-beat are already in `requirements.txt`). Ship polling first (simplest), add webhook later.

### 2.2 Money-in (top-up) pipeline (Feature 4)

```
Parent → CafeteriaPage "Recargar" → POST /cafeteria/topup/ {student, amount, method=online, gateway}
   → create TopUpRequest(pending) + Payment(type=cafeteria, pending)
   → return gateway redirect/HPP URL  (Global Payments HPP  OR  Banorte Pago en Línea)
Parent pays on gateway ──────────────► gateway server-to-server WEBHOOK
   → VERIFY SIGNATURE (per gateway)            ← closes the current auth hole
   → Payment.mark_success()
   → add_points_to_customer(Loyverse)          ← atomic + idempotent (see R2)
   → CafeteriaTransaction(type=topup)
   → TopUpRequest.status = completed
   → sync balance
   → Notification(type=payment) + email receipt  [+ optional CFDI/factura]
```

- **Gateway abstraction:** introduce a small `payments/gateways/` layer with a common interface (`create_checkout(payment) -> redirect_url`, `verify_webhook(request) -> event`) and two implementations: `GlobalPaymentsGateway`, `BanorteGateway`. `Payment` already has `gateway_tx_id / gateway_ref / gateway_raw` to store provider data.
- This reuses the **existing** `TopUpRequest` and `Payment` models — no schema change needed for the happy path.

---

## 3. Feature specifications & acceptance criteria

### F1 — Parent purchase notifications
- **Given** a child buys items at the cafeteria, **when** the sync runs, **then** every linked parent gets an in-app `Notification` and an email within the polling window (≤5 min, or instant via webhook).
- Notification shows amount, date, and (if available) item summary; links to history.
- Channels: **in-app** (exists) → **email** (needs real SMTP) → **WhatsApp** (recommended, §6).

### F2 — Parent purchase history
- Parent sees a per-child, paginated, filterable (date range, type) list at `/portal/cafeteria`.
- Each row: date, type (Compra/Recarga/Devolución), amount, running balance, **item detail** where Loyverse provides line items.
- Export to CSV/PDF (recommended).

### F3 — Parent balance
- Live balance per child + low-balance flag; "last updated" timestamp; manual "Actualizar" (already calls sync).
- Auto-refresh via scheduled `sync_all_balances` (needs Celery Beat schedule).

### F4 — Parent add money (Global Payments **or** Banorte)
- Parent picks a child, amount, and gateway; completes payment on the hosted page; balance reflects the top-up after webhook confirmation.
- **Failure handling:** declined/failed → `Payment=failed`, `TopUpRequest=failed`, parent notified, **no** Loyverse credit.
- **Security:** webhook must verify the gateway signature before trusting status (see R3).
- **Payment methods are fixed by contract: Global Payments and Banorte only.** Whatever each gateway's hosted page natively offers is fine, but the platform integrates no third method (no OXXO, SPEI-standalone, Stripe, PayPal, etc.).

### F5 — Admin cafeteria console ("…and many more")
- Roster with every student's **balance**, low-balance flag, last-synced, and Loyverse-linked state.
- **Deposits/top-up log** (all `TopUpRequest` + cafeteria `Payment`s) with status filters.
- Per-student **detail**: full transaction history + balance + linked parents.
- Actions: **apply office/cash top-up** (exists), **manual adjustment/credit**, **refund**, **sync one / sync all** (exists), **resend receipt**.
- **Low-balance report** (all students under threshold) for proactive outreach.
- **Reconciliation**: compare DB balances vs Loyverse, flag drift.
- **Export** monthly statement per student / whole school (CSV/PDF).

---

## 4. Data model changes needed (small)

Most is reuse. Additions:
- `CafeteriaTransaction`: add `items` (JSON) or a related `line_items` for itemized receipts (F2); add `balance_after` (Decimal) for running balance display.
- `Payment`: add `gateway` (choice: global_payments/banorte) and `related_topup` FK (link a payment to its `TopUpRequest`).
- `CafeteriaBalance`: add `auto_recharge_enabled`, `auto_recharge_threshold`, `auto_recharge_amount` (for recommended auto-recharge, §6).
- New `BalanceAdjustment` (audit): who/when/amount/reason for every manual admin change (F5 + audit).
- New `NotificationPreference` (per user: email/WhatsApp/in-app toggles, digest opt-in).

---

## 5. New / changed endpoints

| Method + path | Purpose | State |
|---|---|---|
| `POST /cafeteria/topup/` | now returns a **gateway redirect URL** for `method=online` | change |
| `POST /payments/webhook/global-payments/` | verify signature → credit Loyverse → notify | new (replaces generic) |
| `POST /payments/webhook/banorte/` | Banorte notification handler | new |
| `POST /loyverse/webhook/receipts/` | real-time purchase ingestion (if enabled) | new |
| `GET /cafeteria/transactions/?student=&type=&from=&to=` | filters + pagination | extend |
| `GET /cafeteria/admin/topups/` | deposits/top-up log | new |
| `POST /cafeteria/admin/adjust/<student_pk>/` | manual credit/debit (audited) | new |
| `POST /cafeteria/admin/refund/<tx_pk>/` | refund a transaction | new |
| `GET /cafeteria/admin/reconcile/` | DB vs Loyverse drift report | new |
| `GET /cafeteria/admin/low-balance/` | students under threshold | new |
| `GET /cafeteria/export/…` | CSV/PDF statements | new |

---

## 6. Recommended additional features (prioritized)

**High value / low effort (schema already supports):**
1. **Low-balance auto-alerts** — `CafeteriaBalance.is_low_balance` already exists; email/notify a parent when a purchase pushes balance under threshold. *(Directly reuses existing field.)*
2. **WhatsApp notifications** — `WHATSAPP_NUMBER` is already in settings; in Mexico WhatsApp beats email for immediacy. Purchase + low-balance alerts via WhatsApp Business API / Twilio.
3. **Family wallet view** — a parent with multiple children (M2M already there) sees all balances + combined history on one screen; one top-up flow, pick the child.
4. **Itemized receipts** — show *what* the child bought, not just the total (parents love this; Loyverse receipts carry line items).

**High value / medium effort:**
5. **Auto-recharge** — parent opts in ("keep ≥ $Y, top up $Z"), card-on-file via the gateway; removes the #1 support burden (empty cards at lunch).
6. **Spending controls** — daily/weekly spend cap per child; optional **allergen/category blocks** (e.g., no sugary drinks) if Loyverse item categories are available.
7. **CFDI / factura** — issue Mexican tax invoices for top-ups (parents will ask); integrate a PAC/facturación provider.
8. **Weekly/monthly digest email** — per-child spending summary; opt-in.
9. ~~SPEI / OXXO payment methods~~ — **descoped 2026-07-09: payment methods are contractually limited to Global Payments and Banorte only.**

**Operational / trust:**
10. **Reconciliation dashboard + audit log** — every balance change traceable; nightly DB↔Loyverse drift check.
11. **Refund flow** — admin refund → Loyverse debit + `Payment` refunded + parent notified.
12. **Cafeteria-staff role** — a limited role that can view balances/history but not touch financials.
13. **Retries & idempotency** — Celery retry on Loyverse/gateway failures; idempotency keys so no double-charge / double-credit.
14. **Statements/exports** — monthly PDF statement per family.

---

## 7. Technical prerequisites & risks (read before building)

- **R1 — Loyverse points as a wallet (validate FIRST):** using loyalty `total_points` as prepaid balance is a workaround. Confirm the Loyverse API actually allows **writing** `total_points` via `PATCH /customers/<id>` (`services.py:124`) — several Loyverse plans treat points as **read-only**, updated only through sales/redemptions. If writes aren't supported, the top-up mechanism must change (e.g., record credit locally and reconcile, or use a proper prepaid/redemption flow). **This gates Feature 4.**

  > ### 🔴 R1 result (2026-07-07 — Prompt 08) — **writing `total_points` is NOT supported → STOP before Prompt 10**
  >
  > **Finding.** Loyverse's public API treats a customer's `total_points` as **read-only**. It is *returned* by `GET /customers/<id>` but is **computed and owned by the loyalty program** — points accrue on sales and are redeemed on receipts. The customer create/update endpoint is `POST /customers` (an **upsert keyed by `id`**, not `PATCH`), and its accepted body fields are the customer's *profile* only: `id, name, email, phone_number, address, city, region, postal_code, country_code, note, customer_code`. **`total_points` is not an accepted write field**, so there is no supported way to set/credit a balance directly. The current `add_points_to_customer()` is doubly wrong: it uses `PATCH` (unsupported verb) and sends `total_points` (read-only field) — it would fail even with valid credentials.
  >
  > **Live re-check.** An empirical write test could not be run this session: the `LOYVERSE_API_TOKEN` in `.env` returns `401 UNAUTHORIZED` (token rotated/expired per the go-live security notes). A read-only `GET /customers?limit=1` was attempted and rejected for the same reason. **Action:** once a valid token is provisioned, re-confirm by (a) `GET`ting a customer and checking the `total_points` field, then (b) attempting a *sandbox/test-customer* `POST /customers` with `total_points` — expect it to be silently ignored or rejected. Do **not** test writes against a real student's card.
  >
  > **Decision — adopt a local ledger + reconcile (do NOT credit Loyverse on top-up):**
  > 1. Treat the DB as the **source of truth** for prepaid balance. `CafeteriaBalance.balance` is credited on a confirmed top-up (Prompt 10) via a `CafeteriaTransaction(type=topup)`; **no** call to Loyverse to add points.
  > 2. Keep syncing **purchases** *out* of Loyverse (`sync_purchases`, Prompt 09) — each processed receipt **debits** the local balance. Reads from Loyverse stay authoritative for *spend*; the DB stays authoritative for *credit*.
  > 3. Add a **reconciliation** report (Prompt 11 / §5 `admin/reconcile`) to flag drift between the local ledger and Loyverse. If the store later enables a Loyverse plan/flow that supports crediting (e.g. a redemption/store-credit API), revisit crediting Loyverse directly.
  >
  > **Consequence for the roadmap.** Prompt 08 (this foundation) proceeds. **Prompt 10 (top-ups) must NOT wire `add_points_to_customer` into the payment-success path** — credit the local ledger instead. `add_points_to_customer()` is retained (refactored, atomic/idempotent) only as a best-effort no-op-safe helper for the day a write path exists; it is **not** on the money-in critical path.
- **R2 — Non-atomic top-up race** (`services.py:118-129`): `add_points_to_customer` does read-modify-write of the total; concurrent purchase + top-up can clobber. Wrap in `select_for_update`/idempotency and prefer a delta-based API if Loyverse offers one.
- **R3 — Unauthenticated payment webhook** (`payments/views.py:47-78`, `AllowAny` + `csrf_exempt`, no signature): anyone can POST `{"status":"SUCCESS"}` and credit a card for free. **Must verify each gateway's signature** before crediting Loyverse. *(Also in STATUS_REPORT §5.2.)*
- **R4 — Email backend is console** (`base.py:158` / dev): real notifications need SMTP or Anymail (already in `requirements.txt`) with a verified sender domain.
- **R5 — Loyverse client reads token at import** (`services.py:13-17`): freezes credentials at load; move to a per-call session so scheduled tasks and env changes work reliably.
- **R6 — Scheduling: use cron, NOT Celery.** The host is **GoDaddy cPanel shared hosting** — no Redis, no persistent workers, so Celery/Redis/django-celery-beat **won't run** (drop them from requirements). Instead, run the sync pipelines as Django **management commands invoked by cPanel cron** (`sync_balances`, `sync_purchases`, `low_balance_alerts`). Real-time paths (Loyverse/gateway webhooks) are plain HTTPS endpoints. *(2026-08: the host is now a Hostinger VPS running Docker; the conclusion stands — jobs run from the VPS crontab, see [DEPLOY_HOSTINGER_VPS.md](DEPLOY_HOSTINGER_VPS.md).)*
- **R7 — PII & compliance:** purchase data about minors → tighten notification targeting, retention, and access controls; keep the audit log.

---

## 8. Suggested delivery phases

- **Phase A — Foundation:** stand up Celery worker + Beat; switch email to real SMTP; refactor Loyverse client (R5); fix webhook auth + top-up race (R2/R3). *Validate R1.*
- **Phase B — Purchases-in (F1–F3):** polling `sync_purchases` task → transactions + balance + in-app/email notifications + low-balance alerts. *Delivers "parent sees history/balance and gets notified."*
- **Phase C — Money-in (F4):** gateway abstraction + Global Payments HPP, then Banorte; webhook credits Loyverse; parent top-up UI. *Delivers "add money."*
- **Phase D — Admin console (F5):** deposits log, adjustments, refunds, reconciliation, low-balance report, exports.
- **Phase E — Enhancements:** WhatsApp, auto-recharge, family wallet, itemized receipts, CFDI, digests, spending controls.

**Recommended start:** **Phase A + B** — they turn on real balances, history, and purchase notifications (Features 1–3) using code and models you already have, and they surface the R1 Loyverse question before you invest in the payment gateways.
