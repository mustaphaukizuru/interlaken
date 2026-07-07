# Prompt 05 — Official Logos, Favicon & Brand Assets

**Run in:** fresh session at `D:\Github\interlaken`. **Prereqs:** 01. **Reference:** `BRAND_LOGO_GUIDE.md`. **Size:** M.

## Context
See `prompts/README.md`. Official logos live in `frontend/assets/` (`logo-horizontal.png`, `logo-vertical.png`, `logo-40 anos.png`) but that folder is **git-ignored, so they don't deploy**. `src/components/ui/Logo.tsx` re-typesets the wordmark in Poppins and **drops the tagline** instead of using the real artwork. The favicon is a generic `/favicon.svg`.

## Goal
Use the official logo artwork professionally everywhere, and ship it (committed + optimized), including favicon/PWA/social.

## Tasks
1. **Ship the assets.** Optimize the official logos into `frontend/public/assets/` as web-ready files (webp + png fallback): `logo-horizontal`, `logo-vertical`, `logo-seal-40` (the 40-años), and a standalone **clock isotipo** (crop from the vertical). Also export a **white/knockout** wordmark version for dark backgrounds. Commit these (they're under `public/`, which is tracked). Keep the source PNGs as the source of truth (optionally un-ignore `frontend/assets/`).
2. **Rewrite `src/components/ui/Logo.tsx`** to render the real files — no re-typesetting:
   - `variant="horizontal"` → official horizontal artwork (icon + wordmark + tagline).
   - `variant="stacked"` → official vertical artwork.
   - `variant="icon"` → clock isotipo only.
   - `variant="seal"` (new) → 40-años seal.
   - `theme="dark"` → use the knockout version.
   - Explicit `width/height`, `alt="Colegio Interlaken"`, eager-load the nav logo.
3. **Update usages** in `PublicLayout.tsx` (nav = horizontal, footer = horizontal knockout), `LoginPage.tsx` (stacked), `Sidebar.tsx` (stacked or icon when collapsed, knockout).
4. **Favicon / PWA / social:** replace `/favicon.svg` with the **isotipo** favicon set (`favicon.ico` 32², `favicon.svg`, `apple-touch-icon.png` 180²). Add `site.webmanifest` with 192²/512² isotipo-on-white (installable). Add an Open Graph image (1200×630, horizontal logo on brand background) and `<meta property="og:*">` + Twitter card tags in `frontend/index.html`. Also remove the duplicate Inter font load (`index.html` + `index.css` both load it) and load Poppins properly.
5. **Clear-space & sizing:** enforce the guide's minimums; never stretch/skew/recolor.

## Constraints
- Do not recolor or re-typeset the logo. Keep the multicolor clock intact.
- Keep everything Spanish; don't change layout beyond swapping the logo component.

## Acceptance / verify
- `npx tsc --noEmit && npm run build` clean; `git ls-files frontend/public/assets | grep logo` shows the committed logos.
- Run the dev server: nav/footer/login/sidebar all show the **official** mark (with tagline where horizontal), correct on light and dark.
- Browser tab shows the clock isotipo; `site.webmanifest` validates; sharing the URL shows the OG image.

## Do NOT
- Touch the color palette here (that's Prompt 06's optional step). Commit the multi-hundred-KB source PNGs unoptimized into `public/`.
