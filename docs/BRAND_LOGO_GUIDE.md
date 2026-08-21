# Colegio Interlaken — Brand & Logo Usage Guide

**Generated:** 2026-07-07 · Companion to [DESIGN.md](DESIGN.md)
Purpose: use the **official Interlaken logos professionally** and consistently across the app.

---

## 1. The official assets (what you provided)

Source files (high-res) are tracked in `frontend/assets/`. They are the master copies and are never served to browsers; the optimized exports in `frontend/public/assets/` are what ships:
| File | What it is | Use for |
|---|---|---|
| `logo-horizontal.png` | clock isotipo **+** wordmark **+** tagline, vertical red divider | nav bar, email signatures, wide headers |
| `logo-vertical.png` | clock isotipo above stacked wordmark, red rule | login screen, cards, square/portrait spaces |
| `logo-40 anos.png` | 40-años anniversary seal | anniversary / celebratory contexts |
| *(isotipo only)* | the multicolor clock mark alone | favicon, app icon, avatars, watermark |

The **clock isotipo** should also exist on its own (crop from the vertical logo) for favicon/PWA use.

---

## 2. Both original problems are fixed (kept for context)

1. ~~The real artwork isn't wired in.~~ **Done.** `Logo.tsx` renders the actual
   artwork for every variant (horizontal, stacked, icon, seal) and never
   re-typesets the wordmark.
2. ~~The official logos don't deploy.~~ **Done.** `frontend/public/assets/`
   ships `logo-horizontal`, `logo-vertical`, `logo-isotipo` and `logo-seal-40`
   as optimized `.webp` (what the app requests) with `.png` alongside as the
   source/fallback. `frontend/assets/` is tracked as the high-resolution
   source-of-truth folder and never shipped to browsers.

---

## 3. Logo component — target behavior

Rewrite `src/components/ui/Logo.tsx` to serve the **real files**, no re-typesetting:

| `variant` | Renders | Where it's used today |
|---|---|---|
| `horizontal` | official `logo-horizontal` (icon + wordmark + tagline) | `PublicLayout` nav + footer |
| `stacked` | official `logo-vertical` | `LoginPage`, `Sidebar` |
| `icon` | clock **isotipo** only | compact spaces, mobile nav |
| `seal` *(new)* | `logo-40 anos` | anniversary sections |

- Provide a **light** and **dark** treatment. The wordmark is green on white; on dark backgrounds (footer `#080516`, portal sidebar) use a **white/knockout** version of the full logo (export a white wordmark variant) rather than tinting the PNG.
- Keep `alt="Colegio Interlaken"`, set explicit `width/height` to avoid layout shift, and `loading="eager"` for the nav logo (above the fold).

---

## 4. Placement matrix

| Context | Variant | Notes |
|---|---|---|
| Public nav (`PublicLayout`) | horizontal | left-aligned, ~36–40px icon height; links to `/` |
| Public footer (dark) | horizontal (knockout) | white wordmark on `#080516` |
| Login (`LoginPage`) | stacked | centered above the form |
| Portal sidebar (`Sidebar`) | stacked or icon (collapsed) | knockout on dark sidebar |
| Favicon / browser tab | isotipo | replace the generic `/favicon.svg` (see §6) |
| PWA / app icon, WhatsApp/OG share | isotipo on white, 512² | social preview + installability |
| Anniversary / campaigns | seal (40 años) | temporary, not the default mark |

---

## 5. Clear-space, sizing & do/don'ts (professional rules)

- **Clear space:** keep a margin ≥ the height of the clock's center around the whole logo; never crowd it with text or other logos.
- **Minimum size:** horizontal logo not below ~120px wide (tagline stays legible); isotipo not below 24px.
- **Do:** use the official files; preserve aspect ratio; use the knockout version on dark; keep the multicolor clock intact.
- **Don't:** re-typeset the wordmark in another font (current bug); recolor the clock or wordmark; stretch/skew; add shadows/outlines; place the color logo on a busy photo without a plate; rotate the clock.

---

## 6. Favicon / PWA / social

Currently `index.html` points to a generic `/favicon.svg`. Replace with the **clock isotipo**:
- `favicon.ico` (32²) + `favicon.svg` (isotipo) + `apple-touch-icon.png` (180²)
- `site.webmanifest` with 192² & 512² isotipo-on-white → installable, correct home-screen icon
- Open Graph / Twitter card image (1200×630) using the horizontal logo on brand background → clean WhatsApp/Facebook link previews (relevant to the WhatsApp booking flow).

---

## 7. Brand colors — reconcile the palette with the real logo (recommendation)

The official logo defines the brand colors. Sampled approximately (⚠️ **sample exact hex from `logo-vertical.png`** before committing tokens):

| Role | From the logo | ≈ Hex | In the app today? |
|---|---|---|---|
| **Primary green** (wordmark "INTERLAKEN") | bold green | ~`#3AA935` | ❌ only inside the Logo text |
| Light green ("COLEGIO") | medium green | ~`#5FBE46` | ❌ |
| **Coral / red-orange** (tagline, clock hands, dividers) | coral | ~`#F0472F` | ❌ |
| Indigo/purple (clock 12 o'clock) | deep violet | ~`#3E1C7A` | ✅ ≈ app purple `#401a8e` |
| Magenta/violet (clock left) | | ~`#9C29A0` | ➖ |
| Pink-red (clock right/top) | | ~`#EF2C55` | ✅ ≈ app pink `#ef2558` |
| Magenta-pink (clock bottom) | | ~`#E51C82` | ➖ |

**Finding:** the app's **purple and pink already match the clock** — good. But the app also uses **teal `#1da2ab`, which is NOT in the logo**, while the logo's **green (the wordmark's own color) and coral (the tagline) are missing** from the UI. That's a brand-cohesion gap.

**Recommendation (optional, your call):** define the official tokens and **retire teal in favor of green + coral**:
- Keep **purple + pink** (clock-accurate) as the energetic accents.
- Promote **green** to the primary brand color (it *is* the wordmark) and add **coral** as the warm accent (it *is* the tagline/hands).
- Map `brand-*` tokens in `tailwind.config.js` + the `:root` variables in `index.css` to these exact values, and replace `#1da2ab` usages (e.g., HomePage `section-label-teal`, stat colors) with green/coral.
- This makes the whole UI feel like it belongs to the logo, without changing layout.

> If you'd rather not touch the palette now, the logo fixes (§2–§6) stand on their own — they're independent of the color decision.

---

## 8. Status

1. ~~Ship the assets~~ — done (webp + png in `public/assets/`, sources in
   `frontend/assets/`).
2. ~~Rewrite `Logo.tsx`~~ — done, including the `seal` variant and the knockout
   (dark) treatment used by the footer, login panel and sidebar.
3. ~~Favicon/PWA/OG~~ — done: isotipo favicon set, `site.webmanifest`, OG image.
4. ~~Palette reconciliation~~ — done: teal retired, the logo-sampled green,
   coral, purple and pink are the tokens in `tailwind.config.js` / `index.css`,
   and every token pair meets WCAG AA (see `docs/DESIGN.md`).

Nothing outstanding. Treat this file as the reference for *how* the mark is
used, not as a to-do list.
