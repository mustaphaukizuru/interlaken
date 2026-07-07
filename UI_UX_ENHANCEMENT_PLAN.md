# Colegio Interlaken — UI/UX Enhancement Plan

**Generated:** 2026-07-07 · Companion to [STATUS_REPORT.md](STATUS_REPORT.md)
**Source of inspiration:** two Edukids landing-page references (structure & layout only).

> **Scope rule (per request):** we adopt **layout, structure, composition, and component patterns** from the references. We **do NOT** copy their colors, fonts, illustrations, mascots, or copy. Interlaken keeps its own identity:
> - **Palette:** pink `#ef2558`, teal `#1da2ab`, purple `#401a8e` / `#8f6fd0`, green `#48d06a`, ink `#1A1130`, near-black `#080516`, off-white `#FAF9FD`.
> - **Fonts:** Poppins (display) + Inter (body).
> - **Copy:** Spanish, school-appropriate. **No SaaS framing** ("14-day trial", "Free for teachers", "Get our app", book-cover resources, pricing tiers) — those are Edukids-specific and irrelevant to a school.
> - **Imagery:** real Interlaken photos in `public/assets` (facade, court, secundaria, classroom, campus-mural…).

---

## 1. What the references do better (the delta)

Your current Home is already solid (dark hero, floating stat cards, level cards, gallery, CTA). The references win on **five dimensions** we can adopt without touching the brand:

1. **Playful depth** — cutout photos sit on organic color "blobs" with floating sticker/doodle accents, creating layered energy. Ours is flat rectangles.
2. **Social-proof density** — dedicated stat banners, testimonial/"superstar" profile cards, partner logos. Ours has one stats strip and no testimonials.
3. **Editorial rhythm** — alternating asymmetric two-up promo cards and split sections keep the eye moving. Ours is mostly full-width stacked blocks.
4. **Categorized programs** — a haloed 4-column "what we teach" grid. Ours jumps straight from 3 levels to a gallery.
5. **Live, dated content** — an "Upcoming Event" banner and lead capture. We can wire these to **real backend data** (Puertas Abiertas / OpenSchoolDay, admissions).

---

## 2. Reference pattern inventory → Interlaken mapping

Each row = one structural pattern seen in the references, and how we adapt it (brand-intact).

| # | Reference pattern (structure) | Interlaken adaptation | Status now |
|---|---|---|---|
| P1 | Cutout photo on organic **color blob** + floating **sticker/doodle** accents | Subtle brand-colored blobs + geometric/education accents behind hero & level photos | ❌ new |
| P2 | **Trust-badge row** of checkmark chips under the headline | Chips: `Bilingüe`, `40 años`, `Certificación SEP`, `Grupos reducidos` | ❌ new |
| P3 | Centered hero with **two flanking cutouts** on color shapes | Optional symmetric hero variant; or keep left-text/right-image but add a second flanking accent photo | ⚠️ partial |
| P4 | **Dark stats banner** as its own strip — icon tile + big number + caption, notched corner | Promote the in-hero stats strip to a standalone banded section w/ icon tiles | ⚠️ partial (in hero) |
| P5 | **3-up colored feature cards** with photo + label | Upgrade the 3 `LEVELS` cards to bolder full-bleed color cards w/ hover lift | ✅ exists → refine |
| P6 | **4-column category grid** w/ haloed circular photos | New "Nuestros Programas": `Inglés`, `Deportes`, `Arte y Música`, `Ciencia y Robótica` | ❌ new |
| P7 | **Two-up asymmetric promo cards** (color block + heading + CTA + art) | New pair: `Modelo Bilingüe` + `Comunidad y Valores` | ❌ new |
| P8 | **Split section + floating stat card** over blob photo ("Empower…") | Mid-page "¿Por qué Interlaken?" split w/ an overlaid mini-stat card | ⚠️ pattern exists in hero only |
| P9 | **Testimonial / "Superstar" profile cards (3-up)** | "Testimonios de Familias" (or "Egresados Destacados") — photo, name, relation, quote | ❌ new (high trust value) |
| P10 | **Event banner** — split image + colored panel + **date chip** | "Próxima Puertas Abiertas" banner **wired to `OpenSchoolDayListView`** (live date) | ❌ new (uses real API) |
| P11 | **Newsletter / lead-capture** with inline email input | "Solicita Informes" inline input → pre-registro / leads | ⚠️ only full CTA banner |
| P12 | **Carousel** with prev/next arrow controls | Turn static `GALLERY` grid into a scroll/arrow "Galería" or "Noticias" row | ✅ static grid → optional |
| P13 | **Rich multi-column footer** + social row + partner/accreditation logos | Expand 3-col footer → 4–5 groups (Niveles, Admisiones, Comunidad, Contacto) + social icons + accreditations | ✅ 3-col → expand |
| P14 | **Contained nav** with a **"Programs ▾" dropdown** | Add `Programas ▾` dropdown (Preescolar/Primaria/Secundaria + programs); keep sticky bar | ⚠️ flat nav |

---

## 3. Page-by-page upgrade plan

### 3.1 HomePage (`pages/public/HomePage.tsx`) — highest impact
Proposed section order (new/changed marked):

1. **Hero** — keep dark gradient + gradient headline. **Add:** trust-badge chips (P2), a blob/accent layer behind the photo (P1), keep the two floating stat cards.
2. **Stats banner (P4)** — pull the 4 stats out of the hero into a dedicated light/dark strip with icon tiles + notched corner. More emphasis, cleaner hero.
3. **About** — keep, but add a floating mini-stat card overlapping the image collage (P8).
4. **Niveles (P5)** — refine the 3 level cards: larger imagery, hover lift, accent ring.
5. **Programas (P6)** — **new** 4-column haloed category grid.
6. **Promo pair (P7)** — **new** two asymmetric color cards (`Modelo Bilingüe` / `Comunidad y Valores`).
7. **Testimonios (P9)** — **new** 3-up family/graduate testimonial cards.
8. **Próxima Puertas Abiertas (P10)** — **new** event banner, live date from API, CTA → `/puertas-abiertas`.
9. **Galería (P12)** — optional carousel upgrade.
10. **CTA + Newsletter (P11)** — keep gradient CTA; add inline "Solicita informes" capture.

### 3.2 Nosotros / Admisiones / Contacto
- **Nosotros:** apply split sections (P8) + a values/timeline row; add testimonials (P9).
- **Admisiones:** render the admission **steps as a horizontal timeline** (reference "process" rhythm) instead of a plain list; keep document checklist.
- **Contacto:** the form currently does nothing (`onSubmit` only `preventDefault` — see STATUS_REPORT §6.7). Wire it to a real endpoint + add the map/contact split layout.

### 3.3 Portal / Admin (authenticated)
Lower priority (internal users), but the same primitives (StatCard, Card, EmptyState) should be consolidated so the portal inherits the refreshed look for free.

---

## 4. Reusable components to build

Building these once keeps everything consistent **and** fixes the "inline-styles everywhere" inconsistency flagged in the status report (P3):

| Primitive | Purpose |
|---|---|
| `<Section>` / `<Container>` | standard vertical rhythm + max-width; removes repeated inline `padding/margin` |
| `<Reveal>` | scroll-triggered fade/slide (IntersectionObserver or Framer Motion) |
| `<Blob>` / `<Accent>` | decorative organic shapes behind imagery (P1) |
| `<TrustBadges>` | checkmark chip row (P2) |
| `<StatBanner>` | icon-tile + number + caption strip (P4) |
| `<FeatureCard>` | photo + label color card (P5) |
| `<CategoryGrid>` / `<CategoryItem>` | haloed circular category tiles (P6) |
| `<PromoCard>` | asymmetric color promo block (P7) |
| `<TestimonialCard>` | avatar + quote + attribution (P9) |
| `<EventBanner>` | split image + date-chip panel (P10) |
| `<NewsletterCTA>` | inline email capture (P11) |
| `<Carousel>` | arrow-controlled horizontal scroller (P12) |
| `<NavDropdown>` | Programas mega-menu (P14) |
| `<Logo>` (rewrite) | serve the **official** artwork + tagline, add `seal` + knockout variants — see [BRAND_LOGO_GUIDE.md](BRAND_LOGO_GUIDE.md) |

---

## 5. Cross-cutting "modern web" enhancements

Beyond layout, these raise the perceived quality bar:

- **Motion:** scroll-reveal on section entry, hover lift on cards, animated number count-up on the stats banner, smooth-scroll anchor nav. (Framer Motion, ~load-safe.)
- **Responsiveness:** the references are shown desktop-wide — we must define the stack-down (4-col → 2-col → 1-col grids, flanking cutouts collapse behind text on mobile). Test at 375 / 768 / 1280.
- **Performance:** `loading="lazy"` + `srcset` on below-fold images; **route-level code-splitting** (currently no `React.lazy` — the whole app is one bundle, 281 kB main).
- **Accessibility:** `aria-label` on icon-only buttons, visible focus rings, `role="dialog"` + focus trap on modals, real `<label>`s (all flagged in STATUS_REPORT §7).
- **Consistency:** migrate the large inline `style={{}}` blocks (HomePage, LoginPage, dashboards) onto the token/Tailwind system as components are extracted.

---

## 6. Explicitly NOT copied (out of scope by request)

- Edukids **cream/lavender palette** and **serif display font** → we keep purple/pink/teal + Poppins/Inter.
- Literal **space doodles / mascots / hand-drawn arrows** → we use restrained brand-colored geometric accents instead.
- **SaaS/marketing copy**: "fly high", "superstar", "14-day trial", "Free for teachers", "Get our app", "world's largest ed-tech", book-cover resource cards, pricing tiers.
- Any Edukids **text, logos, or brand assets**.

---

## 7. Suggested implementation phases

- **Phase 1 — Foundation:** `<Section>`, `<Container>`, `<Reveal>` + token cleanup. (No visible change; unblocks the rest.)
- **Phase 2 — Home high-impact:** trust badges (P2), stat banner (P4), category grid (P6), testimonials (P9), live event banner (P10), newsletter (P11). *Biggest visible upgrade.*
- **Phase 3 — Polish:** decorative blobs/accents (P1), promo pair (P7), nav dropdown (P14), footer expansion (P13), gallery carousel (P12), motion pass.
- **Phase 4 — Other pages:** Nosotros/Admisiones/Contacto layouts + wire the Contacto form; portal component consolidation.

**Recommendation:** start with **Phase 2 on the HomePage** — it delivers the most visible modernization on the page that matters most, using content and API data we already have, with zero brand drift.
