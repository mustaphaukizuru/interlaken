# Prompt 07 — UI Polish + Other Public Pages

**Run in:** fresh session at `D:\Github\interlaken`. **Prereqs:** 06. **Reference:** `UI_UX_ENHANCEMENT_PLAN.md` §3.2, §3.1 (Phase 3). **Size:** M–L.

## Context
See `prompts/README.md`. Reuse the primitives from Prompt 06 (`Section`, `Container`, `Reveal`) and the official `Logo`.

## Goal
Extend the modernization to navigation, footer, and the remaining public pages.

## Tasks
1. **Nav dropdown** (`PublicLayout.tsx`): add a `Programas ▾` dropdown (Preescolar / Primaria / Secundaria + the program categories). Accessible (keyboard + `aria-expanded`), mobile-friendly.
2. **Footer expansion**: from 3 columns to 4–5 grouped columns (Niveles, Admisiones, Comunidad, Contacto) + social icon row + accreditation/`SEP` line. Keep the WhatsApp button.
3. **Decorative accents**: subtle brand-colored organic "blob" shapes behind hero/level imagery (restrained, no literal reference doodles). Add a `<Blob>`/`<Accent>` helper.
4. **Nosotros** (`AboutPage.tsx`): split sections + a values row + a floating mini-stat card over an image; add testimonials.
5. **Admisiones** (`AdmissionsPage.tsx`): render the steps as a horizontal **timeline** instead of a plain list; keep the document checklist.
6. **Contacto** (`ContactPage.tsx`): a proper contact split layout (form + info/map placeholder); ensure it submits to the contact endpoint (Prompt 04).
7. **Accessibility pass**: `aria-label` on icon-only buttons (TopBar bell, Sidebar logout, sync buttons), real `<label>`s on inputs, visible focus rings, `role="dialog"` + focus trap + Escape on the top-up/payment modals.

## Constraints
- Brand-intact (purple/pink + green/coral, Poppins/Inter, Spanish). No reference colors/fonts/copy.
- Keep routes and data-fetching behavior unchanged.

## Acceptance / verify
- `npx tsc --noEmit && npm run build` clean.
- Dev server: dropdown works (mouse + keyboard); footer shows the new groups; Nosotros/Admisiones/Contacto are restyled; modals trap focus and close on Escape; no console errors.
- Quick a11y check: keyboard-only navigation reaches all interactive elements with visible focus.

## Do NOT
- Rebuild HomePage (done in 06). Introduce a component library dependency.
