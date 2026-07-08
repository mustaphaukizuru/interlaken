# Django Admin (Jazzmin) — Brand Identity + Mobile-First Responsive Refinement

**Run in:** a fresh Claude Code session at `D:\Github\interlaken`.
**Scope:** the **Django admin panel only** (`/admin/`, powered by **Jazzmin** = AdminLTE 3 / Bootstrap 4). Do **not** touch the React frontend, the REST API, models, or admin registration/permission logic.
**Reference:** `BRAND_LOGO_GUIDE.md`, `frontend/BRAND.md` (if present after the frontend refinement — reuse the exact same hex), `prompts/README.md` (PROJECT CONTEXT).

---

## 0. Grounded current state (verified 2026-07-07)
- Jazzmin is configured in `backend/config/settings/base.py`: **`JAZZMIN_SETTINGS`** (site_title/header/brand, icons, `topmenu_links`, `changeform_format: 'horizontal_tabs'`, `custom_css: 'admin/interlaken_admin.css'`, `custom_js: None`, `use_google_fonts_cdn: True`) and **`JAZZMIN_UI_TWEAKS`** (theme/navbar/sidebar/button classes). **Read both fully before editing.**
- Custom stylesheet: **`backend/static/admin/interlaken_admin.css`** (~56 lines). It has a `@import` Google-Fonts line and `:root { --color-primary:#401a8e; --color-secondary:#ef2558; --color-teal:#1da2ab }`.
- **8 admin apps registered:** `accounts, admissions, bookings, cafeteria, core, finance, payments, portal`.
- Official logo assets exist in `frontend/public/assets/` (`logo-isotipo`, `logo-horizontal(-white)`, `logo-vertical(-white)`, `logo-seal-40`, `favicon.ico`) — but the Django admin serves from **`backend/static/`**, so they must be **copied into `backend/static/admin/`** to be usable here.

### The three concrete problems to fix
1. **Off-brand color:** `.btn-success { background:#1da2ab }` (+ `--color-teal`) → those are the **teal "Agregar" buttons** in the dashboard. **Teal is NOT a brand color.** The logo's **green** (wordmark) and **coral** (tagline/hands) aren't used.
2. **Not responsive:** the custom CSS has **zero `@media` queries** — the sidebar, dashboard cards, change-list tables, and `horizontal_tabs` change-forms are not tuned for phones.
3. **Weak brand presence:** no `site_logo` / `login_logo` / `site_icon` set in `JAZZMIN_SETTINGS` → the admin shows a text brand, not the clock logo.

## Goal
Make the Django admin **100% on-brand** (official green/coral + logo, matching the React app) and **fully mobile-first responsive** — polished, accessible, and usable on a phone — **without changing any admin functionality, models, permissions, or the API.**

## Hard guardrails
- Only edit: `JAZZMIN_SETTINGS` / `JAZZMIN_UI_TWEAKS` in `base.py`, `backend/static/admin/interlaken_admin.css`, an optional `backend/static/admin/interlaken_admin.js`, optional template overrides under `backend/templates/admin/` and `backend/templates/registration/`, and **copied logo/static assets** in `backend/static/admin/`.
- Do **not** change `apps/*/admin.py` registration logic, list_display/permissions, models, or anything under the API. Keep all labels **Spanish**. Must remain fully functional on **desktop and mobile**.
- Use the **exact same brand hex** as the React app (green primary/anchor, coral accent, purple + pink from the clock). If `frontend/BRAND.md` exists, copy its values; else sample from `frontend/public/assets/logo-vertical.png` and follow `BRAND_LOGO_GUIDE.md`.
- Work **phase by phase**; after each phase run the verify gate and **commit** (`git add -A && git commit -m "admin-ui: <phase>"`).

---

## Phase 1 — Brand assets & Jazzmin settings
1. **Copy logos into `backend/static/admin/`:** the **isotipo** (favicon/small), a **white/knockout** logo for the dark sidebar+navbar, and the colored logo for the (light) login page. Add a favicon.
2. **`JAZZMIN_SETTINGS`:** set `site_logo` (white/knockout, shown in the dark brand area), `login_logo` + `login_logo_dark`, `site_icon` (favicon), and `site_logo_classes` (e.g. no forced circle if the mark is wide). Keep the Spanish titles.
3. **`JAZZMIN_UI_TWEAKS`:** set the brand/accent so **success = green, not teal**; tune `navbar`, `sidebar`, `sidebar_fixed`, `navbar_fixed`, `footer_fixed`, `theme`, and `button_classes` for a clean, brand-aligned, mobile-friendly shell. (`navbar_fixed` + `sidebar_fixed` improve the mobile scroll experience.)
4. **Fonts:** avoid the render-blocking `@import`; prefer Jazzmin's `use_google_fonts_cdn` with a `preconnect`, or self-host Poppins/Inter into `backend/static/admin/fonts/` (better for the offline cPanel host).

## Phase 2 — Brand tokens in `interlaken_admin.css`
1. Replace the `:root` block with the **official token set**: `--brand-green` (primary/anchor), `--brand-coral` (accent), `--brand-purple`, `--brand-pink`, neutrals (`--ink`, `--cream`, `--muted`, `--border`).
2. **Retire teal:** delete `--color-teal`; change `.btn-success` and every `#1da2ab` to **green**; introduce coral where an accent helps (links/active states). Target: `grep -rniE "1da2ab|teal" backend/static/admin` → **0**.
3. Re-skin with tokens: buttons (primary/success/danger/warning), links, **active sidebar item**, navbar, cards, card-headers, table headers, **status badges** (map admin state colors — pending/paid/overdue/success/failed — to brand tokens), form focus rings.

## Phase 3 — Mobile-first responsive (the core work)
Add **mobile-first `@media` rules** so `/admin/` works cleanly from 360px up:
- **Sidebar:** off-canvas **drawer + overlay** on mobile (AdminLTE `push-menu`), closes on nav-select; hamburger reachable; nav items ≥44px tall.
- **Dashboard app cards** (the `Agregar/Modificar` grid): **1 column on mobile**, 2 on tablet, 3 on desktop; the button rows **wrap** and stay tappable (fix the cramped teal buttons).
- **Change-list tables:** wrap in a contained `overflow-x:auto` scroller (**no page-level horizontal scroll**) with a sticky header — or, on very narrow screens, stack rows as **label:value cards**; the object-tools/action bar and **filters collapse into a drawer/accordion**; pagination wraps.
- **Change forms:** `horizontal_tabs` must **not overflow** on mobile — make the tab strip horizontally scrollable (or collapse to stacked sections < md); inputs **full-width**, `font-size:16px` (no iOS zoom); inline formsets scroll within a container.
- **Top navbar:** search field collapses/toggles; breadcrumbs wrap; user menu reachable.
- **Global:** zero horizontal page scroll at 360–390px; readable base font; 44px tap targets; respect safe-area insets.

## Phase 4 — UX polish & accessibility
- Consistent spacing/radius/shadow; hover/active + **`:focus-visible`** rings in brand green; polished dark sidebar; branded **login page** (logo, green/coral, clean card).
- Status **badges** colored by meaning via tokens; better readonly/empty states.
- **Accessibility:** verify **AA contrast** for green/coral on the light content area and on the dark sidebar/navbar (adjust shades if any fail); visible focus; keyboard operable menus/tabs; `alt` on the logo.
- Optional **`interlaken_admin.js`** (wired via `custom_js`) for small mobile niceties (e.g., collapse filter panel, responsive-table toggle). Keep it tiny, vanilla, no framework.

## Phase 5 — Verify
- `cd backend && DJANGO_SETTINGS_MODULE=config.settings.development SQLITE_LOCAL=1 python manage.py check` → **0 issues**; `python manage.py collectstatic --noinput` succeeds.
- `grep -rniE "1da2ab|teal" backend/static/admin backend/config/settings/base.py` → **0**.
- Load `http://localhost:8000/admin/` and test at **360 / 390 / 768 / 1024 / 1440** (DevTools device mode + a real phone if possible):
  - no horizontal page scroll anywhere;
  - sidebar drawer opens/closes; dashboard cards stack; **"Agregar" buttons are green**, wrap, ≥44px;
  - a change-list (e.g. Reservas / Pagos / Inscripciones) is usable — table scrolls or stacks, filters reachable;
  - a change-form (e.g. a Registration) — tabs don't overflow, inputs full-width;
  - the **logo** shows in the sidebar and on the **login** page.
- Confirm every admin action still works (add/edit/delete/search/filter) — **no functional regressions**.

## Do NOT
- Change models, `admin.py` logic, permissions, or the API. Break the desktop layout. Use teal anywhere. Remove or hide any admin feature. Recolor/re-typeset the logo artwork.

## Execution note (for the agent)
Jazzmin ships templates you can override under `backend/templates/admin/` for deep control, but prefer **settings + CSS/JS first** (lower risk). Do the phases in order, verify + commit after each, and if context runs low, stop at a committed phase boundary and report exactly where you stopped so the next run resumes there.
