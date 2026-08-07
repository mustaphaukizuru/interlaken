# UIUX-AUDIT — verification log

Running audit trail for the UI/UX enforcement suite. Each run appends its
verification results here. Tokens are defined in `frontend/src/index.css` +
`frontend/tailwind.config.js` and documented in [DESIGN.md](DESIGN.md);
deferred decisions live in [UIUX-DECISIONS.md](UIUX-DECISIONS.md).

---

## Run: IK-ADMIN — Django admin theming + staff analytics dashboard (2026-07-08)

Nine conventional commits, one per numbered item (`605dd2f…1814375` on
`admin-refinement`), plus this log.

### Part 1 — Django admin (django-unfold 0.89, config-only)

| Check | Result |
|---|---|
| Skin | ✅ jazzmin fully retired (settings, 2 template overrides, AdminLTE assets); unfold configured via `UNFOLD` in `base.py` |
| Branding | ✅ `--color-primary-600` renders `rgb(64,26,142)` (= brand purple token), `--color-base-900` = `rgb(15,10,36)` (= dark-2); official isotipo as icon/favicon; **no stock Django green** (`--primary` unset) |
| Login | ✅ unfold login, branded title, es-MX form labels; Poppins/Inter via `UNFOLD.STYLES` static asset. Known gap: unfold's "Welcome back to" string has no es locale (UIUX-DECISIONS §2) |
| Dark/light | ✅ unfold theme toggle present; base/primary ramps supplied for both modes from tokens |
| Sidebar | ✅ 7 domain groups (Admisiones incl. visitas, Familias, Cafetería, Pagos, Comunicaciones, Legal y consentimientos, Sistema), Material icons, es-MX labels; all 28 links reverse-checked; plumbing models (JWT blacklist, sessions, social-auth) hidden (`show_all_applications=False`) |
| List/detail quality | ✅ date_hierarchy + richer search/filters + `list_select_related` per model; money/gateway/token/sync fields readonly; `AuditLog`, `ConsentRecord`, `BalanceAdjustment`, `InvoicePayment`, `InvoiceAdjustment` strictly read-only (no add/change/delete — verified in UI: no add button on AuditLog changelist) |
| Dashboard index | ✅ `DASHBOARD_CALLBACK` + component-only `admin/index.html` (documented unfold pattern — UIUX-DECISIONS §1): 5 KPI counts with filtered-changelist deep links + recent audit table. Numbers and links only, no charts |
| 768 px | ✅ login, index (all KPI cards), pre-registration/payment/audit changelists render with zero horizontal overflow; sidebar collapses behind unfold's mobile toggle |

### Part 2 — Staff analytics dashboard (`/staff`)

| Check | Result |
|---|---|
| Route + guards | ✅ `/staff` gated `roles={['staff','admin']}`; staff logins land there; vitest pins staff/admin in, parent → portal, anon → /login |
| Endpoint | ✅ `GET /api/v1/portal/analytics/` — `IsStaffOrAdmin`; pytest: anon **401**, parent/student **403**, staff/admin **200** |
| No N+1 | ✅ pure DB aggregation (~12 queries regardless of rows); `django_assert_max_num_queries(14)` with 25 pre-registrations + 25 transactions seeded |
| Cache | ✅ 60 s LocMem micro-cache; second request asserted at **0 queries** (explicit `CACHES` added) |
| Empty-safe | ✅ zero-filled funnels, full 30-day zero series ×3, `read_rate: null` (no announcement read-tracking model exists — endpoint says so honestly); dashboard renders meaningfully with zero data (tested) |
| Audit exemption | ✅ test asserts a read creates no `AuditLog` rows |
| Charts | ✅ recharts 2.15 (single lib); central token theme read from CSS vars at runtime; ≤6 categorical colors; bars start at zero; **no pies**; direct labels (LabelList / inline color-matched series names) instead of legends; es-MX MXN/dates; every chart titled with its computed takeaway |
| KPI cards | ✅ value + delta vs previous period + sparkline; deep links to `/admin/finanzas`, `/admin/admisiones`, Django-admin documentos/ARCO changelists |
| States | ✅ per-card skeletons (4+3, no global spinner), es-MX empty states with guidance, error state with working retry — all three covered by vitest |
| Performance | ✅ charts lazy: `KpiRow` (5.2 kB) / `ChartsSection` (12.6 kB) / `StaffDashboard` (3.8 kB) split chunks; entry bundle contains no recharts (verified against `dist/`) |
| Motion | ✅ entry animations off by design (rAF-dependent animation renders blank in throttled/background tabs); tooltip motion honors `prefers-reduced-motion` |
| Dark/light | ✅ page-scoped dark variant driven by `prefers-color-scheme`; verified live: dark → shell `rgb(15,10,36)` (dark-2) / cards `rgb(42,35,66)` (dark-card) / white ink; light → cream/white/ink. Shared portals stay light |
| Responsive | ✅ 320 / 375 / 768 / 1024 / 1440: KPI grid 1→1→2→2→4 columns, charts 1→2, sidebar drawer (hamburger) < 1024, static ≥ 1024, **zero horizontal overflow at every width** |

### Global gates

| Gate | Result |
|---|---|
| Hardcoded design values | ✅ hex grep over `frontend/src/**/*.{ts,tsx}`: only the 4 sanctioned Google-logo fills (DESIGN.md §5). Chart colors resolve from CSS variables at runtime; unfold `COLORS` stops each annotated with their source token |
| `npx tsc --noEmit` | ✅ clean |
| `npm run build` | ✅ exit 0 (PWA precache generated) |
| `npx vitest run` | ✅ 20/20 |
| Backend `pytest` | ✅ 174/174 (incl. 10 new analytics tests) |
| `manage.py check` | ✅ 0 issues |

### Notes / follow-ups

- django-unfold pinned at **0.89.0** — the last release resolving against
  Django 4.2 (0.90+ needs Django ≥ 5.1). Revisit with a Django upgrade.
- Deep links from `/staff` KPI cards to the **Django admin** resolve
  same-origin in production (SPA served by Django); on the Vite dev server
  they fall into the SPA router — dev-only quirk, documented in `KpiRow.tsx`.
- Circular read-rate intentionally `null`: no read-tracking model exists.
  If the metric is wanted, an `AnnouncementRead` model is a future feature
  (out of scope here — new business feature).
