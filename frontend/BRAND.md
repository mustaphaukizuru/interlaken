# Colegio Interlaken — Frontend Brand Tokens

Single source of truth for color, type, and elevation tokens. Values are **sampled
from the official logo** (`public/assets/logo-vertical.png`) — never recolor the logo
artwork; drive the UI from these tokens instead.

## Colors (official logo)

| Role | Token | Hex | Sampled from |
|---|---|---|---|
| **Primary / anchor** | `green-500` / `green` (DEFAULT) | `#47a028` | wordmark "INTERLAKEN / COLEGIO" |
| **Warm accent** | `coral-500` / `coral` (DEFAULT) | `#dd2622` | clock hands + tagline rule |
| Energetic secondary | `purple` (DEFAULT) | `#401a8e` | clock 12 o'clock tick |
| Energetic secondary | `pink` (DEFAULT) | `#e01a4e` | clock right ticks (darkened from sampled `#ef2558` so white button labels pass WCAG AA) |
| (clock family, gradients only) | — | `#9a1185`, `#d30a70` | clock left / bottom ticks |

`green` and `coral` each ship a full **50–900 scale** plus named aliases
(`green-mid/dark/bright/light`, `coral-dark/light`) in `tailwind.config.js`, mirrored as
CSS variables (`--green*`, `--coral*`) in `src/index.css`.

### Usage
- **green** — primary buttons/anchors, positive stats (balances, revenue), "Publicado"/
  "Completado" badges (`badge-green`, `btn-green`, `section-label-green`), success states.
  Use `green-dark` (`#316f1c`) for green **text on light** surfaces (AA contrast).
  Use `green-strong` (`#38801e`) for **solid interactive faces under white labels**
  (buttons, active chips, numbered step circles): wordmark green is 3.32:1 with white
  and is decorative-only.
- **coral** — warm accent, admissions CTA (`nav-admisiones`), `badge-coral`,
  `section-label-coral`, `<Blob tone="coral">`. Use `coral-dark` for coral text on light.
- **purple** — brand/`brand-*` scale: portal chrome, primary CTA gradient, default anchor.
- **pink** — high-energy CTA gradient partner, alerts/notification dot, danger accents.

### ❌ Retired
`teal #1da2ab` (and `shadow.teal`, `--teal*`, `.btn-teal`, `.badge-teal`,
`.section-label-teal`) — **not in the logo**, fully removed. `grep -riE "1da2ab|teal" src
tailwind.config.js` → 0.

## Surfaces / neutrals
`ink #1A1130` (text) · `muted #6E6885` · `subtle #726B89` (darkened from `#9A93AE` for AA
captions) · `cream #F5F4FA` / `cream-2 #FAF9FD` (page bg) · `dark #080516` →
`dark-card #2a2342` (hero + portal sidebar). Warning text uses `amber #b45309`
(darkened from `#d97706` for AA; `amber-bright #f5b300` stays decorative).

## Gradients (`:root` in index.css)
- `--grad-bar` — top accent rule: purple → magenta → pink → **green** (logo sweep).
- `--grad-cta` — pink → purple (primary CTA).
- `--grad-purple` — portal active-nav fill.

## Elevation (`boxShadow` / `--shadow-*`)
`card`, `purple`, `pink`, `green`, `coral`. (teal shadow removed.)

## Typography
- **Display:** Poppins (`font-head`). **Body:** Inter (`font-body` / `font-sans`).
- **Fluid scale** (`clamp()`): `text-fluid-sm … text-fluid-5xl` — shrink gracefully from
  desktop to ~360px without media queries. Prefer these for headings/hero over fixed sizes.

## Radius / spacing
Radii: `rounded-xl2 18px`, `xl3 24px`, `xl4 32px` (+ Tailwind defaults). Spacing uses the
default Tailwind scale; keep vertical rhythm through the `<Section>` / `<Container>` primitives.
