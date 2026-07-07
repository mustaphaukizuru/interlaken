# Prompt 06 — UI Foundation + HomePage Modernization

**Run in:** fresh session at `D:\Github\interlaken`. **Prereqs:** 05. **Reference:** `UI_UX_ENHANCEMENT_PLAN.md` §3–5, §7 (Phases 1–2). **Size:** L.

## Context
See `prompts/README.md`. The public site is solid but flat. We're adopting **layout/structure** patterns (not colors/fonts) from reference designs, keeping Interlaken's brand, Spanish copy, and real photos in `public/assets`.

## Goal
Build reusable layout primitives, then modernize `HomePage.tsx` with higher-impact sections — brand-intact.

## Tasks
1. **Primitives** (`src/components/ui/`): `<Section>` (vertical rhythm + bg variants), `<Container>` (max-width), and `<Reveal>` (scroll-triggered fade/slide via IntersectionObserver — no heavy deps). Migrate HomePage's repeated inline `style` padding/margins onto these.
2. **HomePage sections** (`src/pages/public/HomePage.tsx`), keep the dark hero + gradient headline; add/upgrade:
   - **Trust badges** row under the hero headline: chips `Bilingüe`, `40 años`, `Certificación SEP`, `Grupos reducidos`.
   - **Stat banner**: promote the 4 hero stats into a dedicated banded strip with icon tiles.
   - **Programas** grid (new): 4 haloed circular category tiles — `Inglés`, `Deportes`, `Arte y Música`, `Ciencia y Robótica`.
   - **Promo pair** (new): two asymmetric color cards — `Modelo Bilingüe` + `Comunidad y Valores`.
   - **Testimonios** (new): 3 family/graduate cards (photo, name, relation, quote).
   - **Event banner** (new): "Próxima Puertas Abiertas" with a date chip — statically for now, wired to live data in Prompt 14.
   - **Newsletter/lead capture** (new): inline "Solicita Informes" email input → posts to the contact endpoint (Prompt 04) or `/pre-registro`.
3. **Motion & polish:** wrap sections in `<Reveal>`; add hover-lift on cards; `loading="lazy"` on below-fold images; keep responsive (grids collapse 4→2→1).
4. **(Optional) Palette reconciliation** (from `BRAND_LOGO_GUIDE.md` §7): if approved, retire `teal #1da2ab`, wire official **green** + **coral** tokens into `tailwind.config.js` + `index.css`, and replace teal usages. Ask before doing this if unsure — it's layout-neutral but changes accent colors.

## Constraints
- Keep purple/pink accents and the official green/coral; **do not** import reference colors, fonts, or copy.
- Spanish only; reuse existing `public/assets` imagery; keep the `onError` image fallbacks.

## Acceptance / verify
- `npx tsc --noEmit && npm run build` clean.
- Dev server: HomePage shows trust badges, stat banner, program grid, promo pair, testimonials, event banner, and newsletter; sections reveal on scroll; layout holds at 375 / 768 / 1280 px.

## Do NOT
- Convert the whole app's inline styles in this prompt (Home only). Add a UI kit dependency (build primitives in-repo).
