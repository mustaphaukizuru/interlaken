# Prompt 19 — SEO, Analytics & Installable PWA

**Run in:** fresh session at `D:\Github\interlaken`. **Prereqs:** 05 (brand assets), ideally 16 (cookie consent). **Reference:** `ROADMAP.md` §H, §G1. **Size:** M.

## Context
See `prompts/README.md`. The public site needs discoverability, measurement, and mobile installability. Analytics must respect the cookie consent from Prompt 16.

## Goal
Make the marketing site rank, measurable, and installable — without hurting performance or privacy.

## Tasks
1. **SEO basics:** per-page `<title>`/meta description (react-helmet-async or route-level), canonical URLs, `robots.txt`, `sitemap.xml` (build-time or Django-served), Open Graph/Twitter tags (reuse Prompt 05 OG image). Add JSON-LD structured data (`School`/`EducationalOrganization` + `LocalBusiness`: name, address in Tlalnepantla, phone, geo).
2. **Analytics (consent-gated):** integrate GA4 **or** privacy-first Plausible; only load after cookie consent (Prompt 16). Track the **admissions funnel** (home → admisiones → pre-registro submit → inscripción) and booking conversions. Keys via env; no-op if unset.
3. **Performance:** route-level `React.lazy` + `Suspense` (the app is currently one bundle ~281 kB); `loading="lazy"` + responsive `srcset` on images; preconnect fonts (already partly). Aim to improve Core Web Vitals.
4. **PWA / installable:** `site.webmanifest` (from Prompt 05) + a service worker (Workbox or Vite PWA plugin) for offline shell + installability; add web-push scaffolding (opt-in) for future portal notifications.
5. **Verify** with Lighthouse (SEO/Perf/PWA/A11y) and note scores.

## Constraints
- No analytics before consent. Keep bundle lean; lazy-load below-the-fold and routes.
- Don't regress accessibility (Prompt 07).

## Acceptance / verify
- `npm run build` shows code-split chunks (not one monolith); `robots.txt` + `sitemap.xml` served; JSON-LD validates (Rich Results test).
- Analytics fires only after consent; funnel events visible in the tool with keys set, silent without.
- Lighthouse: SEO ≥ 95, PWA installable, no major a11y regressions.

## Do NOT
- Load trackers pre-consent. Inflate the bundle. Break SSR-less routing.
