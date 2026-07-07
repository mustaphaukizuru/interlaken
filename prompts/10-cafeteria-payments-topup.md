# Prompt 10 — Cafeteria Top-ups via Global Payments & Banorte (Phase C)

**Run in:** fresh session at `D:\Github\interlaken`. **Prereqs:** 08, 03. **Reference:** `CAFETERIA_WALLET_SPEC.md` §2.2, §3 (F4). **Size:** L.

## Context
See `prompts/README.md`. `PaymentInitiateView` is a stub (`pass`), Banorte isn't integrated, and the webhook doesn't credit Loyverse. Prompt 03 added webhook signature verification and idempotency. **Do this only if Prompt 08's R1 confirmed Loyverse points are writable** (else implement the local-ledger alternative agreed there).

## Goal
A parent can add money to a child's card via Global Payments or Banorte, and a confirmed payment credits Loyverse + notifies the parent.

## Tasks
1. **Gateway abstraction.** Create `apps/payments/gateways/` with a base interface `create_checkout(payment) -> redirect_url` and `verify_webhook(request) -> event`, plus `GlobalPaymentsGateway` (HPP) and `BanorteGateway` (Pago en Línea). Select via a `gateway` field on `Payment` and env config.
2. **Top-up initiation.** Extend `POST /api/v1/cafeteria/topup/` (or `payments/initiate/`) so `method=online` creates a `TopUpRequest(pending)` + `Payment(type=cafeteria, pending)` linked together, and returns the gateway **redirect/HPP URL**. Add `related_topup` FK on `Payment`.
3. **Webhook → credit.** In the signed, idempotent webhook (Prompt 03), on success: `Payment.mark_success()` → `add_points_to_customer(...)` (atomic, from Prompt 08) → create `CafeteriaTransaction(type=topup)` → `TopUpRequest.status=completed` → sync balance → notify parent (type `payment`, email receipt). On failure: mark both failed, notify, no credit.
4. **Frontend top-up UI** (`CafeteriaPage.tsx`): pick child + amount + gateway → redirect to hosted page → return page reads status; success/failed toasts; refresh balance/history.
5. **Env & docs:** add `GLOBAL_PAYMENTS_*`, `BANORTE_*`, and webhook secrets to `.env.example`; document the redirect/return URLs in `DEPLOYMENT.md`. Note sandbox vs live.

## Constraints
- Never credit Loyverse without a verified webhook. Keep the whole flow idempotent (no double-credit).
- Keep card data off our servers — use hosted pages (HPP) only (PCI scope minimization).

## Acceptance / verify
- `python manage.py check` + migrations apply.
- Sandbox happy path: initiate → (simulated) signed success webhook → `Payment=success`, `TopUpRequest=completed`, one `CafeteriaTransaction(topup)`, balance updated, one parent notification. Replaying the webhook does nothing.
- Failure path marks failed and does not credit.
- `npx tsc --noEmit && npm run build` clean.

## Do NOT
- Store PANs/card data. Trust unsigned webhooks. Hardcode gateway keys.
