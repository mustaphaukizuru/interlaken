# Colegio Interlaken — Design System (DESIGN.md)

Single reference for the design standard enforced across the platform (public
marketing site, family/staff portals, auth, system pages, transactional email).
Produced by the UI/UX enforcement suite (core Run 1; extended by the public and
admin overlays). **Tokens are the source of truth** — components consume tokens,
never raw values. Brand rationale lives in `frontend/BRAND.md` and
`BRAND_LOGO_GUIDE.md`.

---

## 1. Design tokens

All tokens are declared once in `frontend/src/index.css` (`:root`, as CSS custom
properties) and mirrored as Tailwind theme values in `frontend/tailwind.config.js`.
Components reference them via Tailwind utilities (`bg-purple`, `text-muted`,
`border-line`, …) or, for genuinely dynamic per-item values, via `var(--token)`
in inline styles. Alpha compositing of a token uses `color-mix(in srgb, <token>
N%, transparent)` — never a hex+alpha suffix.

### 1.1 Color — brand (sampled from the official logo)

| Role | Token / utility | Value |
|---|---|---|
| Primary / anchor (green) | `green` / `--green` | `#47a028` |
| green scale | `green-50…900`, `green-mid/dark/bright/light` | ramp |
| Warm accent (coral) | `coral` / `--coral` | `#dd2622` |
| coral scale | `coral-50…900`, `coral-dark/light` | ramp |
| Structural (purple) | `purple` / `brand-*` / `--purple` | `#401a8e` |
| purple family | `purple-mid/dark/light/xlight` | `#5e3aad`,`#4d22a8`,`#ede8f7`,`#e7e2f7` |
| Energetic (pink) | `pink` / `--pink` | `#ef2558` |
| pink family | `pink-dark/hot/light/soft/pale` | ramp |
| Warn/attention (amber) | `amber` / `--amber` | `#d97706` |

`brand-*` is remapped to the purple scale so legacy `brand-*` utilities rebrand
automatically. **Teal (`#1da2ab`) is banned** — retired from the palette; it must
stay at 0 occurrences, including disguised as `rgb(29,162,171)` (a hidden instance
in the login glow was removed in this run).

### 1.2 Color — neutrals & surfaces

| Role | Token | Value |
|---|---|---|
| Ink / body text | `ink` / `--text-main` | `#1A1130` |
| Muted text | `muted` / `--text-muted` | `#6E6885` |
| Subtle text | `subtle` / `--text-light` | `#9A93AE` |
| Hairline border | `line` / `--border` | `#ECEAF3` |
| Border (alt) | `line-2` / `--border-2` | `#EEEBF5` |
| Page bg (cream) | `cream` / `cream-2` | `#F5F4FA` / `#FAF9FD` |
| Dark surfaces | `dark`, `dark-2`, `dark-3`, `dark-card` | `#080516`→`#2a2342` |

### 1.3 Semantic state colors

- **Success** → green family (`green-dark` `#316f1c` for text on light = AA).
- **Warning/attention** → amber.
- **Error/danger** → coral family; form validation text uses `red-600` (Tailwind
  default) as the conventional error signal.
- **Info** → purple/brand.

### 1.4 Dark surfaces (not a toggle theme)

The app has no user-facing light/dark toggle. "Dark" is a set of surface tokens
(`dark*`) used for hero bands, the login left panel, the public footer, and the
portal sidebar/topbar. On dark surfaces, text uses `white` with opacity steps
(`text-white/70`, `/60`, `/45`) rather than the ink neutrals.

### 1.5 Gradients (token layer only)

`--grad-bar` (logo sweep: purple→magenta→pink→green, e.g. `.accent-bar`),
`--grad-cta` (pink→purple, primary CTA / `Section bg="gradient"`),
`--grad-purple` (portal active-nav). Raw magenta stops live only inside these
token definitions, never in components.

### 1.6 Typography

- **Display:** Poppins (`font-head`). **Body:** Inter (`font-body`/`font-sans`).
  Loaded once via `<link>` in `index.html`. Max two typefaces.
- **Fluid scale** (`clamp()`): `text-fluid-sm … text-fluid-5xl` in
  `tailwind.config.js` — shrinks desktop→~360px with no media queries. Prefer
  these for headings/hero.

### 1.7 Spacing, radii, elevation

- Spacing: default Tailwind 4/8px scale; vertical rhythm via `<Section>` (`sm
  48px` / `md 72px` / `lg 96px`) and `<Container>`.
- Radii: `xl2 18px`, `xl3 24px`, `xl4 32px` (+ Tailwind defaults); `--radius 18px`.
- Elevation: `shadow-card/purple/pink/green/coral` (`--shadow-*`).

### 1.8 Motion

- Easing token `--ease: cubic-bezier(0.4, 0, 0.2, 1)`.
- Duration scale: `--transition-fast 150ms` / `--transition 200ms` /
  `--transition-slow 300ms` (300ms is the ceiling).
- **`prefers-reduced-motion: reduce`** is honored globally (`index.css` neutralizes
  animations/transitions/smooth-scroll) and per-component (`Reveal`, `.hover-lift`).

---

## 2. Component inventory (`frontend/src/components/`)

Primitives (`ui/`) — centralized, token-consuming, variant-driven:

| Component | Notes / variants |
|---|---|
| `Section` | `bg`: white·cream·dark·gradient·none; `spacing`: sm·md·lg |
| `Container` | width `md·lg·xl` |
| `Button` | primary/secondary/danger + `btn`,`btn-pink`,`btn-outline`,`btn-ghost`,`btn-green`,`btn-lg`; `loading` state; ≥44px |
| `Input` | label + inline error; ≥16px (no iOS zoom), ≥44px, brand focus ring |
| `Card` | `.card` token border (`line`) + `shadow-card` |
| `Badge`, `StatCard` | tone: purple·pink·coral·green·amber (token-driven) |
| `Blob` / `Accent` | decorative SVG; brand tone tokens; `aria-hidden` |
| `Reveal` | scroll-in animation; respects reduced-motion |
| `Modal` | bottom-sheet on mobile |
| `LoadingSpinner`, `EmptyState`, `ErrorState` | async view states (token-driven) |
| `PrivacyNote` | **new** — LFPDPPP reassurance line + link to `/aviso-de-privacidad`, for every public data-collecting form |
| `Logo` | official artwork variants (stacked/horizontal, light/dark); never re-typeset/recolor |

Layout: `PublicLayout` (nav + footer + `RouteSeo`), `PortalLayout`, `Sidebar`,
`TopBar` (`.accent-bar`), `ProtectedRoute`.
SEO: `seo/Seo` + `RouteSeo` (react-helmet-async), `lib/siteMeta.ts`.
Analytics (consent-gated): `AnalyticsListener` + `CookieConsent` + `services/analytics`.

Icons: **lucide-react only**, sizes 16/20/24/32, `currentColor` so they theme via
tokens. The multicolor Google logo in the login button keeps Google's official
brand hex (sanctioned third-party exception).

---

## 3. Layout & responsive

- Mobile-first. Test breakpoints: **320 / 375 / 768 / 1024 / 1440 px**.
- Container max widths via `<Container>`; page rhythm via `<Section>`.
- Photography: campus `.webp` in `public/assets`, explicit `width`/`height`
  (zero CLS), `loading="lazy"` below the fold, `fetchPriority="high"` on the hero,
  `alt` mandatory (empty if decorative).

---

## 4. Localization

es-MX only (single language today); strings kept layout-tolerant (+30%). MXN
currency, DD/MM/YYYY dates. Register standard: **usted**, held site-wide
(marketing pages were converted from earlier tú drift). Domain terms allowed:
colegiatura, inscripción, preescolar/primaria/secundaria, CURP, SEP, LFPDPPP.

---

## 5. Verification results (this run)

Run from `frontend/`:

| Check | Result |
|---|---|
| `npx tsc --noEmit` | ✅ clean |
| `npm run build` | ✅ built (PWA precache generated) |
| `npx vitest run` | ✅ 13/13 passing |
| `grep -riE "1da2ab\|teal" src tailwind.config.js` | ✅ 0 |
| Hex literals in `src/**/*.{ts,tsx}` (excl. token layer) | ✅ 4 — all official Google-logo fills (sanctioned) |
| `prefers-reduced-motion` | ✅ global + per-component |

Not yet run in this environment (recommended before release): Lighthouse mobile
(Performance ≥95 / Accessibility ≥95 on `/`, `/admisiones`, `/pre-registro`) and
an axe-core pass. See §7.

---

## 6. Changelog — what this run established/enhanced

**Established**
- `DESIGN.md` (this file).
- Motion scale tokens (`--ease`, `--transition-fast/slow`).
- Semantic `line`/`line-2` border tokens (alias `--border`).
- `PrivacyNote` primitive; public `/aviso-de-privacidad` page rendering the
  existing `apps/legal` notice API.

**Enhanced (migrated to tokens)**
- Shared primitives (`StatCard`, `Blob`, `Section`, `EmptyState`), layout
  (`TopBar`, `Sidebar`), and every public page + `/login`: hardcoded hex →
  tokens; off-brand `slate-*`/`blue-*` and non-existent `purple-*`/`amber-*`
  numeric utilities → brand scales.
- Removed a hidden **teal** glow (`rgba(29,162,171)`) on `/login`.

**Copy / trust (public overlay)**
- Removed fabricated testimonials from `/` and `/nosotros` → defensible
  institutional credibility (SEP incorporation, certifications, 40-year history).
- Dropped the unverifiable "Top 5 Colegios" superlative.
- Standardized the primary CTA to **"Inicie su pre-registro"** site-wide.
- Added a visible FAQ + `FAQPage` JSON-LD on `/admisiones`, and `Event` JSON-LD
  on `/puertas-abiertas`.
- Removed out-of-contract academics copy (calificaciones/asistencia) on `/login`.

---

## 7. Open follow-ups (product decisions / out of scope)

1. **Preparatoria vs. canonical offer.** The pre-registro grade picker and
   `/nosotros` include *Preparatoria*, but `siteMeta.ts` / home describe only
   "preescolar, primaria y secundaria." About was aligned to include prepa (to
   match the functional form). **Confirm the real offering**; if prepa exists,
   add it to `siteMeta` descriptions + the home levels.
2. **Defensible stats.** `1,200+ alumnos`, `80+ maestros`, `95% aprovechamiento`,
   `Promedio 9.2` are presented as fact — verify with the school before release.
3. **Lighthouse / axe** not runnable here — run against a served build.
4. **Consent capture at pre-registro.** Public forms show the LFPDPPP privacy
   line; granular consent is captured in the authenticated guardian flow. If a
   blocking pre-registro consent checkbox is required, it needs backend support.
