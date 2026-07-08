# Frontend Engineering — Mobile-First Responsiveness + Brand Identity + UX Polish

**Run in:** a fresh Claude Code session at `D:\Github\interlaken`.
**Scope:** the whole React frontend (`frontend/`). **Do not** change backend, API contracts, routes, data-fetching, or auth.
**Reference:** `UI_UX_ENHANCEMENT_PLAN.md`, `BRAND_LOGO_GUIDE.md`, `prompts/README.md` (PROJECT CONTEXT).

---

## 0. Grounded current state (verified 2026-07-07)
- Stack: React 18 + TS + Vite 5, Tailwind, @tanstack/react-query, zustand, react-router. Routes are **code-split** (`React.lazy`). Vitest tests exist.
- **Primitives already exist** and must be reused/extended: `components/ui/Section`, `Container`, `Reveal`, `Blob`, `Modal`, `Card`, `Button`, `Input`, `Badge`, `StatCard`, `EmptyState`, `LoadingSpinner`, `Logo`.
- **Logos already shipped** in `public/assets/`: `logo-horizontal(.webp/.png)`, `logo-horizontal-white`, `logo-vertical`, `logo-vertical-white`, `logo-isotipo`, `logo-seal-40`; plus `favicon.ico`, `site.webmanifest`. **Use these — never recolor the logo.**
- Surfaces: public (`Home, About/Nosotros, Admisiones, PreRegister, Register, OpenSchool, BookVisit, Contact`), auth (`Login`), parent (`Dashboard, Cafeteria, Colegiaturas, Payments` + return pages), student (`Dashboard, Cafeteria`), admin (`Dashboard, Admisiones, Bookings/Visitas, Cafeteria (+student), Students, Finance`).
- **Two problems this prompt fixes:**
  1. **Off-brand color:** `teal #1da2ab` appears ~52× (and in `tailwind.config.js` + `nav-admisiones` + `shadow.teal`) — **teal is NOT in the logo.** The logo's **green** (wordmark) and **coral** (tagline/clock hands) are not first-class tokens.
  2. **Not responsive:** ~373 inline `style={{…}}` blocks across pages/components. Inline styles can't express breakpoints, so the app can't be mobile-first until these move to Tailwind utilities.

## Goal
Make the entire frontend **mobile-first responsive** and **fully on-brand** (official logo + official colors) with a **consistent design system** and polished UX/accessibility — with **zero change** to routing, data, API, or auth behavior, and tests/build staying green.

## Hard guardrails
- Do **not** modify: `services/api.ts` request logic, react-query keys/queries, route paths, `authStore`, `ProtectedRoute` gating, or anything under `backend/`.
- Keep **all copy Spanish**. Keep the **official logo artwork** intact (no recolor/re-typeset).
- Don't add a component library (Material/Chakra/etc.). Build on the existing primitives + Tailwind.
- Work **phase by phase**; after each phase run the verify gate (§Verify) and **commit** (`git add -A && git commit -m "ui: <phase>"`).

---

## Phase 1 — Brand token system (single source of truth)
1. **Sample exact hex** from `public/assets/logo-vertical.png`: the **green** wordmark, the **coral** tagline/clock-hands, and confirm the clock **purple** and **pink**. Record them.
2. In `tailwind.config.js` + `src/index.css` `:root`, define the **official tokens** with scales:
   - `green` — **primary/anchor** (it's the wordmark). `coral` — **warm accent** (tagline/hands). `purple` + `pink` — clock accents (keep). Neutrals: `ink`, `cream`, `muted`, `subtle`, `dark`.
   - Elevate **green** as the app's anchor color and **coral** as the accent; keep purple/pink as the energetic secondary family (all four live in the logo).
3. **Retire teal entirely:** remove the `teal` color + `shadow.teal`; replace every `#1da2ab`/`teal-*` usage (incl. `nav-admisiones`) with `green`/`coral` per context. Target: `grep -rniE "1da2ab|teal" src tailwind.config.js` → **0**.
4. **No hardcoded hex in components** — all colors via tokens/utilities.
5. **Typography & spacing scale:** Poppins (`font-head`) for display, Inter (`font-body`) for text; define a fluid type scale with `clamp()`; a consistent spacing/radius/shadow scale (radii/shadows already exist).
6. Write a short `frontend/BRAND.md`: the final hex values, token names, and where each is used (primary/accent/surfaces/states).

## Phase 2 — Mobile-first foundation
1. Breakpoints = Tailwind defaults (`sm 640 / md 768 / lg 1024 / xl 1280`). **Mobile-first:** base styles target ~360–390px; layer up with `sm:`/`md:`/`lg:`.
2. Global shell: `overflow-x-hidden` on the root layout; audit and fix any element wider than the viewport (no page-level horizontal scroll — ever).
3. Fluid typography via `clamp()`; **min tap target 44×44px**; inputs `font-size: 16px+` (prevents iOS zoom); respect safe-area insets on sticky bars.
4. **Convert inline `style={{}}` → Tailwind** wherever it controls layout/size/spacing/color, so breakpoints apply. Keep inline style only for truly dynamic values (e.g., a computed width from data). Prioritize in this order: `PublicLayout` (nav+footer) → `HomePage` → `LoginPage` → `PortalLayout`/`Sidebar`/`TopBar` → dashboards → admin tables → forms/modals. (This is the bulk of the work — the ~373 blocks.)

## Phase 3 — Responsive patterns per surface
- **Public nav (`PublicLayout`):** polished hamburger **drawer** on mobile (sticky, safe-area, focus-trapped); `Programas` dropdown works on **touch**; logo scales.
- **Footer:** multi-column on desktop → single column stacked on mobile.
- **Hero & sections:** single column on mobile; images fluid (`max-w-full h-auto`); `Blob` accents scale down / hide on small screens.
- **Portal shell (`PortalLayout`/`Sidebar`):** off-canvas **drawer + overlay** on mobile (or a bottom tab bar); `TopBar` condenses (icons + menu); content padding responsive.
- **Data tables** (`AdminStudents, AdminCafeteria, AdminBookings, AdminFinance, ColegiaturasPage`, transaction lists): on mobile, render as **stacked cards** (label:value) or a properly contained `overflow-x-auto` scroller with a sticky first column — never overflow the page.
- **Forms** (`PreRegister, Register, Contact, BookVisit`, top-up/payment): single column on mobile, full-width controls, real `<label>`s, large touch targets, inline validation.
- **Modals (`Modal.tsx`):** full-screen **bottom sheet** on mobile, centered dialog on desktop; focus trap, Escape, background scroll-lock.
- **Cards/grids:** responsive `grid` 1 → 2 → 3/4 across breakpoints.

## Phase 4 — UX polish & states
- Every data view has consistent **loading** (skeleton or `LoadingSpinner`), **empty** (`EmptyState`), and **error** states.
- Interactive elements: hover/active + **`focus-visible` ring** in brand color; disabled styles; button loading state.
- Motion: use `Reveal` on scroll; add subtle transitions; **honor `prefers-reduced-motion`**.
- Public pages: sticky **"Pre-inscripción"** CTA on mobile; optional back-to-top.
- Images: `loading="lazy"`, explicit `width/height` (avoid CLS), meaningful `alt`.

## Phase 5 — Accessibility (WCAG AA)
- Landmarks (`header/nav/main/footer`), correct heading order, skip-to-content link.
- `aria-label` on icon-only buttons (TopBar, Sidebar, sync/table actions); real labels on inputs.
- Verify **contrast AA** for green/coral/purple text on white and on the dark hero/portal surfaces (adjust token shades if any fail).
- Full keyboard operability; visible focus; `role="dialog"` + trap on modals; `aria-live` for toasts.

---

## Verify (run after each phase; all must pass at the end)
- `cd frontend && npx tsc --noEmit && npm run build` → clean (chunks still split).
- `npx vitest run` → green (update snapshots/tests you intentionally changed; don't delete coverage).
- `grep -rniE "1da2ab|teal" src tailwind.config.js` → **0**.
- Responsive QA at **360 / 390 / 768 / 1024 / 1440**: no horizontal scroll on any page; tap targets ≥44px; nav/drawer/tables/modals/forms behave per Phase 3.
- Lighthouse (mobile) on Home + Login + a portal page + an admin table: **A11y ≥ 95**, no major perf regressions.
- Spot-check both themes: light public site + dark portal/hero still legible and on-brand.

## Do NOT
- Change API calls, query keys, routes, auth, or backend. Recolor/re-typeset the logo. Translate copy out of Spanish. Add a UI framework. Introduce page-level horizontal scrolling.

---

## Suggested execution note (for the agent)
The 373 inline-style conversions are large — do them **surface by surface** in the Phase-2 priority order, verifying + committing after each surface so nothing regresses. If context runs low, stop at a clean, committed surface boundary and report exactly where you stopped so the next run resumes there.
