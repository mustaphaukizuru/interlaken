# Prompt 11 — Cafeteria Admin Console (Phase D)

**Run in:** fresh session at `D:\Github\interlaken`. **Prereqs:** 09, 10. **Reference:** `CAFETERIA_WALLET_SPEC.md` §3 (F5), §5. **Size:** M.

## Context
See `prompts/README.md`. Admin has balances list + per-student sync + apply-topup, but no deposits log, adjustments, refunds, reconciliation, low-balance report, or exports.

## Goal
Give admins full visibility and control over cafeteria balances, deposits, and history.

## Tasks
1. **Deposits/top-up log:** `GET /api/v1/cafeteria/admin/topups/` (all `TopUpRequest` + cafeteria `Payment`s) with status/date filters.
2. **Manual adjustment (audited):** `POST /api/v1/cafeteria/admin/adjust/<student_pk>/` (+/- amount, reason). Add a `BalanceAdjustment` audit model (who/when/amount/reason) and apply to Loyverse (respecting R1) + local balance. Notify the parent.
3. **Refund:** `POST /api/v1/cafeteria/admin/refund/<tx_pk>/` → reverse a transaction (Loyverse debit + `Payment` refunded + parent notification).
4. **Reconciliation:** `GET /api/v1/cafeteria/admin/reconcile/` → compare DB balances vs Loyverse and flag drift.
5. **Low-balance report:** `GET /api/v1/cafeteria/admin/low-balance/` → students under threshold.
6. **Exports:** CSV/PDF per-student statement and whole-school (reuse a PDF helper; CSV via `csv`).
7. **Admin frontend** (`AdminCafeteria.tsx` + a per-student detail view): roster with balance/low flag/last-synced, deposits log, adjustment & refund actions, reconciliation view, export buttons.

## Constraints
- All financial mutations audited (`BalanceAdjustment` / existing records). Admin-only (`IsAdmin`).
- Idempotent, atomic balance operations (reuse Prompt 08 helpers).

## Acceptance / verify
- `python manage.py check` + migrations apply.
- Admin can: view the deposits log; apply a +$50 adjustment (audited, parent notified, balance changes); refund a transaction; see a reconciliation drift row when DB≠Loyverse; download a CSV statement.
- `npx tsc --noEmit && npm run build` clean.

## Do NOT
- Allow non-admins near these endpoints. Skip the audit trail.
