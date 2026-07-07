# Prompt 09 — Cafeteria Purchases → Balance, History & Notifications (Phase B)

**Run in:** fresh session at `D:\Github\interlaken`. **Prereqs:** 08. **Reference:** `CAFETERIA_WALLET_SPEC.md` §2.1, §3 (F1–F3). **Size:** M.

## Context
See `prompts/README.md`. Purchase history never populates: `get_recent_transactions()` exists but is never called; nothing creates `CafeteriaTransaction`s or notifies parents. `CafeteriaTransaction.loyverse_receipt_id` is `unique` → sync can be idempotent. `StudentProfile.parents` is M2M → fan out to all guardians.

## Goal
Turn on real balances, purchase history, and parent purchase/low-balance notifications via cron.

## Tasks
1. **Implement `sync_purchases`** (management command + service): poll Loyverse `/receipts` for customers matching `StudentProfile.loyverse_id` since the last sync. For each new receipt:
   - idempotent `get_or_create` a `CafeteriaTransaction(type=purchase, amount, date, loyverse_receipt_id, description=item summary)`;
   - update the student's `CafeteriaBalance` (+ `last_synced`);
   - for each parent in `student.parents.all()`, call `portal.services.notify(...)` (type `cafeteria`, in-app + email) — e.g. "Compra en cafetería: $X — <items>";
   - if the new balance is below `low_balance_threshold`, send a deduped low-balance alert.
2. **Store item detail (F2).** Add an `items` JSON field (and optional `balance_after`) to `CafeteriaTransaction`; populate from receipt line items. Migration.
3. **History endpoint polish** (`MyTransactionsView`): pagination + filters `?type=&from=&to=&student=`; ensure parent scoping to their children only.
4. **Frontend** (`CafeteriaPage.tsx`, `StudentCafeteria.tsx`): show item detail, running balance, filters; "last updated" timestamp; keep the manual "Actualizar" (sync) button.
5. **Cron:** document `sync_purchases` (every ~5 min) and `sync_balances` (every ~10 min) in `DEPLOYMENT.md`.

## Constraints
- Idempotent — re-running a sync must not duplicate transactions or re-notify.
- Respect R1 outcome from Prompt 08 (if points are read-only, balances still sync read-only; top-ups are Prompt 10).

## Acceptance / verify
- `python manage.py check` + migrations apply.
- Seed a fake receipt (or mock the Loyverse call): running `sync_purchases` creates one transaction, updates the balance, and creates a `Notification` for each parent; running it again changes nothing.
- Parent `/api/v1/cafeteria/transactions/` returns the purchase with items; a low balance triggers exactly one alert.
- `npx tsc --noEmit && npm run build` clean.

## Do NOT
- Add payment gateways (Prompt 10). Notify students for purchases unless desired (parents are the target).
