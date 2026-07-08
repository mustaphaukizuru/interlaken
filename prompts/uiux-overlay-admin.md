# UI/UX Overlay B — Admin & Back-Office (Run 3 of 3)

**Run in:** a fresh Claude Code session at `D:\Github\interlaken`, branch `admin-refinement`.
**PREREQ:** Runs 1–2 completed and committed — `DESIGN.md` exists.
**FIRST ACTION:** read `prompts/uiux-core-enforcement.md` (binding), `DESIGN.md`, `frontend/BRAND.md`. This overlay ADDS admin-specific rules — it never relaxes the core.

<overlay_admin_backoffice>

SCOPE OF THIS OVERLAY
Applies to: the React admin portal (`/admin` dashboard, `/admin/admisiones`, `/admin/visitas`, `/admin/cafeteria` + `/admin/cafeteria/:studentId`, `/admin/finanzas`, `/admin/alumnos`), the admin/portal chrome (`PortalLayout`, `Sidebar`, `TopBar`), the legal staff console from `apps/legal` (ARCO requests — recently landed; bring to standard, don't recreate), and the **classification** of Django admin. Public surfaces (Run 2) and parent/student portals inherit the core — touch them only where shared chrome requires it.

DJANGO ADMIN DECISION RULE (binding — do not deliberate per feature)
Classify every admin-facing workflow into exactly one tier:

TIER 1 — DEVELOPER/SUPERUSER BACK OFFICE → **Django admin (`/admin/` on :8000, Jazzmin)**.
  Audience: developers and the owner. Raw data inspection, one-off corrections, debugging.
  **Current state is GRANDFATHERED:** it is already token-themed (brand green/coral, official logos, `static/admin/interlaken_admin.css` with responsive rules, branded login). That investment is DONE — cap it there. Going forward: **zero NEW template overrides, no per-model CSS battles, no further mobile-first work** in Django admin. Desktop-usable + not-broken-on-tablet is the accepted bar. Django admin is never handed to non-technical staff as a daily tool.

TIER 2 — OPERATIONAL WORKFLOWS (staff use weekly) → the **React admin portal**, built with the core component library. Full core standards apply: mobile-first, tokens, states, accessibility.
  If you catch yourself overriding a Django admin template to serve a Tier-2 workflow, stop — that is the signal the workflow belongs in the React admin. **Audit task: list any weekly staff workflow that today lives ONLY in Django admin (e.g., announcements/comunicados, open-day management, legal/ARCO handling) and flag it for migration as a follow-up — do not polish it in place.**

Misclassification check: if a workflow is used by anyone who cannot read a stack trace, it is Tier 2. "Temporary" admin screens become permanent — no exceptions.

ADMIN UI STANDARDS (Tier 2 surfaces)
- Density: admin screens use a DENSE spacing variant defined ONCE in the token scale (compact row heights, tighter card padding) — never ad-hoc compressed spacing.
- **Data tables are the core admin primitive.** Every admin table (alumnos, reservas, solicitudes, facturas, transacciones) requires: sticky header · column sorting · server-side pagination (respect existing DRF pagination — presentational wiring only) · per-column filtering where cardinality warrants · bulk selection with explicit action confirmation where bulk endpoints exist · **responsive strategy = priority columns + row expansion or card stacking on mobile (never horizontal scroll as the only strategy)** · CSV export surfaced where it already exists in the API (cafetería/finanzas exports) · designed loading/empty/error/zero-results states.
- Destructive actions: confirmation with a consequence statement in Spanish ("Esto cancelará 14 reservas confirmadas"), **type-to-confirm for irreversible operations** (refunds, cancelar factura, anular recarga). Destructive buttons use the error token, never the accent.
- Every mutation surfaces its result: success toast + updated view (react-query invalidation exists — verify coverage on every mutation; silent saves are defects).
- **Audit visibility is a UI feature:** `BalanceAdjustment` and `InvoiceAdjustment` trails exist in the DB — surface who/what/when/why on the cafetería student detail and finanzas screens wherever money changed.
- Long-running jobs (sync-all Loyverse, generación masiva de facturas): non-blocking (user can navigate away), progress/result indication, and per-row failure reporting with retry affordance **where the API already returns it** — if it doesn't, note the endpoint gap as a follow-up; do not build new endpoints.
- Search: consistent, prominent search on every list screen; add a global admin search (Ctrl/Cmd+K) ONLY if existing endpoints support it — otherwise record as follow-up.
- Role-based UI: hide actions the role lacks, don't disable-and-frustrate; disable only when *state* blocks the action, with a tooltip stating why. Verify parents/students can never see admin chrome.
- Multi-tenant safety: N/A (single school) — mark as such in the audit.

MOBILE POSTURE FOR ADMIN (calibrated, not dogmatic)
Tier 2 admin is mobile-RESPONSIVE with prioritized workflows: **mobile-priority = approving/confirming visitas, checking cafetería balances and low-balance alerts, marking payments, notifications, and search.** Dense data-entry/review grids (finanzas bulk, admissions review) may be desktop-optimized with a functional, simplified mobile fallback. State the mobile-priority list explicitly in your audit — "everything equally" is not a strategy.

VERIFICATION (added to core Phase 4)
[ ] Every admin workflow classified Tier 1 / Tier 2, with justification (table in the report)
[ ] Zero Django admin template overrides serving Tier-2 workflows (and zero NEW overrides at all)
[ ] Tables: pagination, sorting, bulk-action confirmation, explicit mobile strategy per table
[ ] Destructive actions gated with consequence statements; irreversible = type-to-confirm
[ ] Every mutation → toast + view update (no silent saves)
[ ] Adjustment/audit trails visible on money screens
[ ] Long-running jobs non-blocking with failure reporting
[ ] Mobile-priority workflows verified at 320/375px; dense screens have a working fallback
[ ] `npx tsc --noEmit && npm run build && npx vitest run` green · `python manage.py check` clean if backend static/templates touched

</overlay_admin_backoffice>

<repo_guardrails>
Same as core: no changes to API logic, endpoints, react-query keys, routes, auth, models, or gateway code — presentational wiring of EXISTING endpoints only; anything needing a new endpoint is recorded as a follow-up list in the final report. Spanish copy. Tokens only (zero new hex; teal stays banned). Commit per surface: `git add -A && git commit -m "uiux-admin: <surface>"`. If context runs low, stop at a committed boundary and report exactly where.
</repo_guardrails>
