# UI/UX Standards Enforcement — CORE (Run 1 of 3)

**Run in:** a fresh Claude Code session at `D:\Github\interlaken`, branch `admin-refinement`.
**Order:** this is Run 1. Runs 2 (public overlay) and 3 (admin overlay) depend on the `DESIGN.md` this run produces. Do not skip phases.

---

<role>
You are a senior product designer and front-end architect. Your mandate is to enforce a fixed, non-negotiable design standard across this project. You do not ask whether to apply these standards — you apply them. You only ask questions when a product decision (not a design decision) is ambiguous.
</role>

<project_context>
Project name: **Colegio Interlaken** — school web platform (public marketing site + family portals + staff back office), Tlalnepantla, Mexico.
Stack: Django 4.2 + DRF (SimpleJWT) on GoDaddy cPanel/Passenger (MySQL prod; SQLite dev via `SQLITE_LOCAL=1`) · React 18.3 + TypeScript 5.4 + Vite 5 + Tailwind 3.4 · @tanstack/react-query 5, zustand, react-router 6, react-hook-form + zod, lucide-react, react-hot-toast · Vitest + pytest + GitHub Actions CI.
Repository state: **EXISTING CODEBASE** with substantial design work already landed (see <current_state>). Your job is audit → close gaps, NOT re-establish what exists.
Target users & primary devices: Mexican parents/prospects (**es-MX, mobile-heavy**), students (mobile), school staff/admin (desktop-heavy, mobile-responsive required).
Brand system: **Interlaken official** — documented in `frontend/BRAND.md` and `BRAND_LOGO_GUIDE.md`. Green `#47a028` = primary/action anchor; coral `#dd2622` = warm accent; purple `#401a8e` + pink `#ef2558` = clock secondary family; neutrals ink/cream/dark. **Teal is BANNED** (retired; grep must stay 0). Fonts: Poppins (display) + Inter (body). Logos: official clock isotipo + wordmark artwork in `frontend/public/assets/` — never re-typeset, recolor, or stretch. Map 60-30-10 to: surfaces cream/white/dark (60), structural purple/ink (30), green/coral action-accent (10) — **via the existing token layer**, never new raw hex.
</project_context>

<features>
All of these EXIST — enforce standards on them, do not rebuild:
- Public (PublicLayout): `/`, `/nosotros`, `/admisiones`, `/pre-registro`, `/inscripcion`, `/puertas-abiertas`, `/agendar-visita`, `/contacto` — Spanish marketing + admissions funnel. LFPDPPP applies (minors' data); `apps/legal` (consent, ARCO, aviso) recently landed — integrate, don't duplicate.
- Auth: `/login` (Google OAuth + email/password JWT), `/auth/callback`.
- Parent portal: dashboard, cafetería (Loyverse wallet: balance/history/top-up + gateway return pages), colegiaturas (invoices + pay + return), pagos.
- Student portal: dashboard, cafetería.
- Admin portal (React): dashboard, admisiones, visitas, cafetería (+ per-student), finanzas, alumnos.
- Django admin (Jazzmin): already brand-themed — Tier-1, out of this run's scope (Run 3 classifies it).
- System: SPA 404/catch-all, PWA (prod-only SW), consent-gated analytics, Sentry, SEO layer (react-helmet), transactional email templates.
Constraints: payment gateways are sandbox stubs (do not touch); host has no Node at runtime (frontend built via `scripts/build_frontend.py`, served by WhiteNoise); academics (attendance/grades/teacher portal) is OUT OF CONTRACT — never add it.
</features>

<current_state>
Audit hints verified 2026-07-08 — re-verify in Phase 1, mark ✅ quickly, and move on:
- ✅ Tokens: `tailwind.config.js` + `src/index.css` `:root` — green/coral 50–900 scales + purple/pink + neutrals; documented in `frontend/BRAND.md`; teal fully retired.
- ✅ Icons: lucide-react only (30 files, zero other icon libs). Toasts: react-hot-toast.
- ✅ Mobile-first conversion done: ~373 inline styles → Tailwind (~45 genuinely-dynamic remain); drawer nav, bottom-sheet Modal, table→card patterns, skip-link, focus-visible rings.
- ✅ Primitives: `Section, Container, Reveal, Blob, Modal, Card, Button, Input, Badge, StatCard, EmptyState, LoadingSpinner, Logo` (official artwork variants) in `src/components/ui/`.
- ✅ Perf posture: `React.lazy` route splitting, vite-plugin-pwa (SW prod-only), favicon set, OG image, `site.webmanifest`.
- ⚠️ **Token drift: ~90 hardcoded hex literals remain in `src/pages` + `src/components`** — migrate to tokens/utilities (this is the biggest known gap).
- ⚠️ Motion system: durations/easings not formalized as tokens; `prefers-reduced-motion` coverage must be re-verified (grep of `index.css` returned 0 — check where it actually lives).
- ⚠️ Fluid type scale: verify where `clamp()`/fluid sizes live and formalize in the token layer if scattered.
- ⚠️ i18n readiness: UI strings hardcoded in components (es-MX only today) — do NOT translate; assess and document readiness per the standard.
- ❌ `DESIGN.md`: absent — Phase 5 deliverable, REQUIRED (Runs 2–3 depend on it).
</current_state>

<scope>
These standards apply to EVERY rendered surface a human sees — public pages, portals, auth screens, system pages (404/500/offline), transactional emails, generated PDFs (receipts/statements), and admin (density may differ; tokens, states, accessibility, and asset standards apply identically). "Internal users deserve worse UI" is a rejected premise.
</scope>

<mandatory_workflow>
Execute in this exact order.

PHASE 1 — INFRASTRUCTURE AUDIT (report before touching code)
Inspect and report each item as ✅ EXISTS AND COMPLIANT · ⚠️ EXISTS BUT DEFICIENT · ❌ ABSENT, with a one-line evidence note (file path or absence) and severity: BLOCKER (breaks accessibility, theming, or responsive behavior) · MAJOR (inconsistency that compounds) · MINOR (cosmetic).
1. Design tokens (color roles, type scale, spacing, radii, shadows, motion durations — CSS vars/Tailwind theme, not scattered values).
2. Color architecture (60-30-10 semantic roles + success/warning/error/info states; light mode complete — dark mode exists on portal surfaces, verify token-driven).
3. Typography system (max 2 typefaces ✓ Poppins/Inter; modular scale; fluid via clamp(); line-heights per level).
4. Layout system (mobile-first breakpoints, 4/8px spacing grid, container widths).
5. Component library (centralized, token-consuming, variant-driven; no one-off duplicates).
6. Motion system (fast 150ms / base 200–250ms / slow 300ms max; standard easings; prefers-reduced-motion global).
7. Accessibility baseline (WCAG 2.1 AA contrast on all token pairs, visible focus, 44px touch targets, semantic HTML, keyboard nav).
8. Interaction states (default/hover/focus/active/disabled/loading on every interactive component).
9. Iconography (single set ✓ — verify sizing scale consistency).
10. Theming mechanism (token swap, zero hardcoded colors in components — the ~90 hex literals live here).
11. Performance posture (modern image formats, lazy loading, explicit dimensions, font strategy, no layout-shifting async content).
12. i18n readiness (strings, 25–30% text-expansion tolerance, locale date/number/currency — MXN, DD/MM/YYYY).
13. Visual asset governance (illustration/photo consistency, chart theming via tokens, logo rules per `BRAND_LOGO_GUIDE.md`).

PHASE 2 — ENHANCE OR ESTABLISH (no negotiation)
✅ items: leave alone. ⚠️ items: enhance IN PLACE, preserving existing tooling — migrate the ~90 hardcoded hex values into tokens incrementally; do not restructure the project. ❌ items: establish fully before any feature UI. Prefer the smallest intervention reaching full compliance; replacing an existing system requires stated justification of why enhancement is impossible — otherwise forbidden.

PHASE 3 — FEATURE-SURFACE REMEDIATION
Sweep every existing surface through the compliant infrastructure: every color/size/space/radius/shadow/duration from tokens; verified at 320/768/1024/1440px; every async view has designed loading/empty/error states; motion purposeful only (≤300ms); interaction states + accessibility on every interactive element.

PHASE 4 — COMPLIANCE VERIFICATION (evidence, not optimism)
Checklist: [ ] zero hardcoded design values outside the token layer (prove with a grep audit of `#[0-9a-fA-F]{3,6}` in `src/pages`+`src/components`, target ≈0 excluding the token layer) · [ ] AA contrast both modes · [ ] 320px renders with no horizontal scroll · [ ] touch targets ≥44px · [ ] focus visible everywhere · [ ] loading/empty/error present on all data views · [ ] prefers-reduced-motion honored · [ ] no duplicate components · [ ] layouts tolerate +30% text · [ ] images: dimensions, modern formats, lazy below fold, alt text · [ ] single icon set · [ ] text-over-imagery passes AA via scrim.
AUTOMATED (environment exists — run, don't self-attest): `cd frontend && npx tsc --noEmit && npm run build && npx vitest run` all green · `grep -riE "1da2ab|teal" src tailwind.config.js` → 0 · Lighthouse (mobile) on `/`, `/login`, one portal page: Performance ≥90, Accessibility ≥95, Best Practices ≥95 · axe-core scan: zero critical/serious. A fail means not done — fix and re-run.

PHASE 5 — DESIGN DOCUMENTATION (deliverable, not optional)
Produce **`DESIGN.md` at repo root**: token reference (roles + values, light/dark), component inventory with variants, breakpoint/spacing conventions, motion standards, verification results, changelog of what this run established/enhanced. Runs 2 and 3 depend on this file.
</mandatory_workflow>

<browser_device_matrix>
Last 2 versions of Chrome/Firefox/Safari/Edge; iOS Safari + Android Chrome. Test at 320, 375, 768, 1024, 1440px. Degrade gracefully (@supports guards); no blank screens.
</browser_device_matrix>

<visual_asset_standards>
- ICONS: lucide-react only, sizes from scale (16/20/24/32), currentColor so icons theme via tokens; assign outline/filled roles if both appear.
- ILLUSTRATION: one style; palette derived from tokens (Blob accents comply); decoration lives in the 60, never the 10.
- PHOTOGRAPHY: campus photos in `public/assets` — fixed aspect set (1:1, 4:3, 16:9, 3:4), radius from tokens, uniform treatment per screen; AVIF/WebP + fallback, srcset/sizes, explicit dimensions (zero CLS), lazy below fold, alt mandatory (empty alt if decorative).
- LOGOS: per `BRAND_LOGO_GUIDE.md` — clear space ≥ clock-center height, minimum sizes, white/knockout variants on dark; never stretch/recolor/re-typeset.
- DATA VIZ (admin/finance): chart colors from a categorical token ramp (max 6, aggregate "Other"); never meaning by color alone; bars start at zero; no 3D; no pies >3 slices; es-MX number/currency formatting; one charting approach, themed centrally; loading/empty/error like any data view.
- COMPOSITION: one focal element per screen; whitespace floor from the spacing scale; density varies only via defined variants; text over imagery needs a token scrim verified AA.
</visual_asset_standards>

<non_negotiables>
These are policy, not preferences. Do not ask permission to apply them, do not offer a skip-version, do not defer under time pressure. If a request conflicts with a standard, state the conflict, apply the standard, offer the closest compliant alternative.
</non_negotiables>

<repo_guardrails>
- Do NOT change: API request logic/endpoints, react-query keys, routes, auth flows, backend business logic, Django models, payment gateway code.
- All copy stays **Spanish (es-MX)**. Never reintroduce teal. Never alter logo artwork.
- Commit after each phase: `git add -A && git commit -m "uiux-core: <phase>"`. If context runs low, stop at a committed phase boundary and report exactly where you stopped.
</repo_guardrails>

<escalation_rule>
Ask only when a product-level ambiguity materially changes the outcome. Never ask about design standards, styling choices, or whether to build the foundation — those are decided.
</escalation_rule>
