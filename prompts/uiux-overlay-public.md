# UI/UX Overlay A — Public Front-End: Marketing + Copy (Run 2 of 3)

**Run in:** a fresh Claude Code session at `D:\Github\interlaken`, branch `admin-refinement`.
**PREREQ:** Run 1 (`prompts/uiux-core-enforcement.md`) completed and committed — `DESIGN.md` exists at repo root.
**FIRST ACTION:** read `prompts/uiux-core-enforcement.md` in full (every rule there remains binding here) and `DESIGN.md` + `frontend/BRAND.md`. This overlay ADDS to the core — it never relaxes it.

<overlay_public_frontend>

SCOPE OF THIS OVERLAY
Public/persuasion surfaces only: `/` (home), `/nosotros`, `/admisiones`, `/pre-registro`, `/inscripcion`, `/puertas-abiertas`, `/agendar-visita`, `/contacto`, the `/login` + `/auth/callback` screens, the 404/system pages, the SEO/OG layer (`Seo.tsx`, `siteMeta.ts`, `index.html`), the legal public pages from `apps/legal` (aviso de privacidad / términos — recently landed; bring them up to standard, do NOT recreate them), and public-facing transactional email templates. Do not touch portal/admin surfaces (Run 3).

MARKETING PERFORMANCE (stricter than core)
- Lighthouse mobile Performance ≥ 95 on marketing pages; LCP ≤ 2.0s on 4G.
- Hero imagery is never the reason a headline paints late — headline text renders first, media enhances after (no layout shift; the campus `.webp` photos load with explicit dimensions and priority hints only where above the fold).
- Complete meta layer per page: title ≤ 60 chars keyword-leading, description 140–160 chars benefit + CTA, canonical URL, OG + Twitter card with the designed 1200×630 share image (exists — verify wired per page), JSON-LD (`EducationalOrganization`/`School` sitewide; `FAQPage` on `/admisiones`; `Event` on `/puertas-abiertas`).

PAGE ANATOMY (marketing pages — each section earns its place or is cut)
1. Hero: one headline, one subheadline, ONE primary CTA, one supporting visual. Never two competing CTAs above the fold.
2. Social proof within one scroll of hero (stats strip: 40 años, alumnos, aprovechamiento — only claims the school can defend).
3. Problem → solution narrative: max 3 benefit blocks (benefit headline + 2-sentence proof + visual).
4. Objection handling: FAQ, SEP incorporation / certifications, seguridad del campus, LFPDPPP posture.
5. Final CTA restating the value proposition.
One primary conversion goal per page — for this site the funnel is **Pre-registro** (primary) and **Agendar Visita** (secondary on visit-oriented pages). Secondary CTAs are visually subordinate (ghost/link), never the same weight as the primary.

COPYWRITING STANDARDS (es-MX)
- Headlines benefit-first, specific, ≤ 10 words; outcome over feature. Never clever at the cost of clear.
- Body: 7th–9th grade reading level, active voice, second person; sentences ≤ 20 words average.
- Register: the existing copy uses **"usted"** — hold it consistently site-wide; flag and fix any "tú" drift.
- Domain terms the audience lives in are ALLOWED: colegiatura, inscripción, preescolar/primaria/secundaria, CURP, SEP, LFPDPPP. Write to the parent's vocabulary, not below it.
- CTAs: verb + outcome ("Inicia tu pre-registro", "Agenda tu visita") — never bare "Enviar"/"Más información" as a primary. One CTA phrasing per action, repeated consistently — no synonym cycling.
- Numbers beat adjectives ("40 años formando familias" over "gran experiencia"). Every quantified claim must be true and defensible; unverifiable superlatives are banned unless third-party sourced. **Audit the current stats/testimonials: any placeholder or unverifiable testimonial is removed or replaced with school credibility (history, certifications, program specificity) — fabricated social proof is forbidden.**
- Microcopy is designed: form labels, inline errors (state what happened + how to fix, never blame), empty states, button loading text — all in the same voice.

LOCALIZATION & MARKET FIT
- Native es-MX register throughout (not translated English). MXN currency, DD/MM/YYYY dates.
- LFPDPPP: every data-collecting form (pre-registro, inscripción, contacto, agendar-visita, puertas-abiertas signup) carries a privacy reassurance line at the point of collection linking to the aviso de privacidad page from `apps/legal`, plus the consent checkbox where that app requires it. Verify the link targets resolve.
- Single language today; keep strings layout-tolerant (+30%) per core i18n readiness.

CONVERSION & TRUST STRATEGY
- Forms: minimum viable fields (every extra field costs conversion — challenge each), inline validation (zod already present — verify coverage), privacy line at point of collection.
- Trust signals near the ask: SEP/certifications, seguridad, LFPDPPP compliance, real photos of the campus (already in `public/assets`).
- Analytics instrumentation on every CTA and funnel step via the existing consent-gated layer (`AnalyticsListener` + `CookieConsent`) — events must NOT fire pre-consent.

COPY REVIEW GATE (added to core Phase 4 checklist)
[ ] One primary CTA per page, verb+outcome phrased
[ ] Headline states a benefit in ≤ 10 words
[ ] All quantified claims verifiable; zero placeholder testimonials
[ ] Meta/OG/JSON-LD layer complete per page; share image wired
[ ] es-MX native register, "usted" consistent site-wide
[ ] Forms: minimum fields, inline validation, LFPDPPP privacy line + working aviso link
[ ] Lighthouse mobile ≥95 Performance / ≥95 Accessibility on `/`, `/admisiones`, `/pre-registro` (run it, report numbers)

</overlay_public_frontend>

<repo_guardrails>
Same as core: no API/route/auth/backend changes (wiring an existing analytics event or an existing legal link is presentational and allowed); Spanish only; tokens only (zero new hex); never touch logo artwork or reintroduce teal; verify gate `npx tsc --noEmit && npm run build && npx vitest run` green before finishing; commit per page/surface: `git add -A && git commit -m "uiux-public: <surface>"`. If context runs low, stop at a committed boundary and report where.
</repo_guardrails>
