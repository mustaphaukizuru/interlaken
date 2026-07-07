# Prompt 17 — Recurring Tuition (Colegiatura) Billing

**Run in:** fresh session at `D:\Github\interlaken`. **Prereqs:** 02, 10 (gateway abstraction). **Reference:** `ROADMAP.md` §E. **Size:** L.

## Context
See `prompts/README.md`. Today only a one-off `Payment(type=tuition)` exists — **no monthly invoices, due dates, late fees, or payment plans**. This is the school's core revenue flow.

## Goal
Model and operate recurring monthly tuition: generate invoices, let parents pay online, apply late fees, and give admins a finance view — reusing the payment gateways from Prompt 10.

## Tasks
1. **Models** (`apps/finance/` or extend `payments`): `FeeSchedule` (per grade/level: monthly amount, due day, late-fee rule, discounts), `Invoice` (student FK, period, amount, due_date, status pending/paid/overdue/cancelled, line items), `InvoicePayment` linking to `Payment`. Support siblings/family discounts and scholarships (becas) as adjustments.
2. **Invoice generation:** `python manage.py generate_invoices` (cron, monthly) creates the period's invoices from `FeeSchedule`. Idempotent per (student, period).
3. **Late fees & reminders:** `python manage.py apply_late_fees` and `python manage.py send_payment_reminders` (cron) — remind before due + after overdue via email/WhatsApp; apply late fee per rule.
4. **Parent flow:** portal "Colegiaturas" page — list invoices, pay online (reuse gateway HPP), download receipt/CFDI (link to Prompt 16/B6). Webhook marks the invoice paid (signed, idempotent).
5. **Admin finance dashboard:** revenue, outstanding, collection rate, per-student ledger; manual mark-paid/adjust (audited); bulk actions.

## Constraints
- Idempotent generation; audited manual changes; reuse the signed webhook + gateway layer (no new trust holes).
- Money handling atomic; Decimal everywhere; MXN.

## Acceptance / verify
- `python manage.py check` + migrations apply.
- `generate_invoices` for a period creates one invoice per active student (re-run = no dupes); overdue invoices get a late fee and a reminder; a parent pays via sandbox and the invoice flips to paid on the signed webhook.
- Admin dashboard shows outstanding vs collected. `npx tsc --noEmit && npm run build` clean.

## Do NOT
- Bypass the gateway/webhook security. Double-charge or double-generate. Hardcode fee amounts (use `FeeSchedule`).
