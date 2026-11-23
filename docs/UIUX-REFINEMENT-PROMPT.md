# Colegio Interlaken · UI/UX Refinement Programme (v2, 21 Nov 2026)

> **Run record (21 Nov 2026, owner):** run the whole programme in one overnight
> pass as **one PR** on `ux/refinement-programme` (local commits, never pushed
> or merged by the agent). Decisions taken before the run: **D1/D2** radius
> 8 px / 12 px, no pill buttons; **D13** amounts stay in receipt bodies, never
> in subjects; **D3 to D20** follow the recommendation column. The phase gates
> below collapse into the single PR review. Decision records:
> `docs/decisions/`. Audit and status: `docs/UX-AUDIT.md`.

## 0 · Role, mandate, how to run this

Act as a **UI/UX and Front-end Architecture Team** of four:
- **UI/UX lead:** layout, colour, type, icons, media, motion, email design.
- **Front-end engineer:** components, responsiveness, accessibility, performance.
- **Back-end engineer:** API contracts, role scoping, notifications, email rendering and delivery, Django admin.
- **QA and accessibility engineer:** screenshots, regression, WCAG 2.2 AA, email-client checks, metrics.

**Mandate.** Refine and enhance the live platform. Do not redesign, rebuild or add features. Keep the brand, routes, data model, flows and the money path. Where this prompt and the repo disagree, the repo wins until I approve a change. §4 lists the conflicts already known.

**Run order.** Start with Phase 1 only. Every phase ends at an approval gate. Nothing merges or deploys without my explicit go-ahead.

## 1 · The platform today

Verified on 21 Nov 2026 against `master` (1183cc47). Confirm or correct every line in Phase 1.

### 1.1 Surfaces and audiences

| Surface | Routes | Who | Main device | Must achieve |
|---|---|---|---|---|
| Public site | 22 CMS-driven routes, including `/`, `/nosotros`, `/modelo-educativo`, `/niveles/:nivel`, `/admisiones`, `/admisiones/documentacion`, `/admisiones/costos`, `/pre-registro`, `/agendar-visita`, `/calendario`, `/galeria`, `/contacto`, `/plataformas`, `/pagos`, `/aviso-de-privacidad`, `/p/:slug`, 404 | Prospective and current families | Phone | Build trust fast; win pre-registros and visit bookings |
| Admissions follow-up | `/inscripcion`, `/inscripcion/documentos`, the ficha (private until «Aceptado») | Invited applicant families | Phone | Finish the ficha and documents without calling the school |
| Family portal | `/portal/*`: inicio, cafetería, recarga and its return page, credencial, mi-cafetería, pagos, inscripciones, comunicados, notificaciones, perfil (avisos), privacidad | Parents with one or more linked children (ChildSwitcher); students (their portal is merged here: Mi cafetería, credencial); staff with a cafetería account | iPhone, busy mornings | See the balance, top up, show the credencial, read comunicados |
| Staff console | `/admin/*` (about 30 routes) and `/staff` | Admins (everything); staff limited by `staff_areas`: secretaría, recepción, cafetería | Desktop | Throughput, exceptions first, safe bulk actions, audit |
| Content editor | `/admin/contenido`, `medios`, `navegacion`, `formularios`, `testimonios`, `costos`, `aviso-privacidad` | Admins | Desktop | Edit and publish safely (publish gate «Revisión antes de publicar») |
| Django admin | `/django-admin/` (django-unfold) | Superusers only | Desktop | A clear, read-mostly system of record (`docs/ADMIN-VS-PORTAL.md`) |
| Email | `backend/templates/email/base.html` + `backend/apps/portal/emailing.py` (`EmailContent`); about 30 send sites in 17 files | Families, applicants, visitors, staff | Gmail app, iPhone Mail, Outlook | Trusted, on-brand, one clear action |
| System pages | `/login`, `/confirmar-correo`, 404, `public/offline.html`, the error boundary | Everyone | Any | Calm, branded, a way forward |

### 1.2 Stack
- **Front end:** React 18, TypeScript, Vite 8, Tailwind 3.4, lucide-react, framer-motion (LazyMotion on home), react-hook-form + zod 4, TanStack Query 5, Zustand, react-hot-toast through `ToastHost`, recharts (lazy), vite-plugin-pwa. The per-URL `<head>` is written into the raw HTML at build.
- **Back end:** Django + DRF, django-unfold, PostgreSQL (Supabase), SMTP, JWT (15 min access, 7 day refresh, coalesced refresh).
- **Ops:** Docker + Caddy on a Hostinger VPS, GitHub Actions CI, Sentry. I deploy with `deploy.sh`. You never deploy.

### 1.3 Systems that already exist (extend them, never replace or duplicate)
- **Design standard:** `docs/DESIGN.md`, `docs/DESIGN-TOKENS.md`, `docs/RESPONSIVE.md`, `frontend/BRAND.md`, `docs/BRAND_LOGO_GUIDE.md`. Tokens live in `frontend/src/index.css` (`:root`) and `frontend/tailwind.config.js`.
- **Primitives:** `frontend/src/components/ui/` (Button, Input, Card, SectionCard, Badge, StatCard, Modal, ConfirmDialog, DataTable, Pagination, EmptyState, ErrorState, ListSkeleton, TableSkeleton, ToastHost, Container, Section, Dropdown, Avatar and more), plus `components/admin/BulkConfirmDialog` and `components/portal/ChildSwitcher`.
- **Error contract:** the DRF shapes `{detail, code?}`, `{field: [msg]}` and `{non_field_errors}` (`backend/apps/core/exceptions.py`), read only through `frontend/src/lib/apiErrors.ts`.
- **List and bulk contract:** `?q`, `?ordering`, `?page`, `?page_size` (max 100) and filtersets (`apps/core/listing.py`); select-all-matching bulk actions (`apps/core/bulk`).
- **Permissions:** `IsAdmin` + `admin_area` on every console endpoint, guarded by `apps/core/test_areas.py`, mirrored in the SPA by `frontend/src/lib/areas.ts`.
- **Notifications:** `portal.services.notify()` with guardian fan-out; preferences per channel (email, in-app, push) and per category (cafetería, pagos, comunicados); urgent types bypass the toggles; `docs/NOTIFICATION-MATRIX.md`.
- **Email system:** one `EmailContent` structure renders both the HTML part and the plain-text part: preheader, category chip, highlight, details, list, button, note, and a footer with the reason line and the avisos link.
- **CMS:** section renderers in `frontend/src/cms/sections/`, blocks in `frontend/src/cms/blocks/`, published block data in production.
- **Quality gates:** Vitest + vitest-axe, pytest, Playwright (`visual.spec.ts` at 390 and 1280 px; `public-pages.spec.ts` on the 22 public routes with Linux baselines), Lighthouse CI (desktop and mobile configs), `check:budgets`, `check:sw`.
- **Seed data:** `seed_demo`, `seed_cms`, `seed_e2e_user`, `seed_perf_data`.

### 1.4 What the platform does not do
No grades, attendance, homework, teachers, timetables, report cards, tuition or enrollment billing (retired 22 Aug 2026), multiple campuses, multiple languages, dark theme in the SPA, or marketing email lists. Do not design for them, mock them or add them. The only money path is the cafetería wallet.

## 2 · Hard limits (the app is live)

1. **Live production.** interlaken.edu.mx is used every school day, and cafetería top-ups move real money (Banorte VCE, Loyverse in `instant` mode). Work on a branch from `master`. Never merge, deploy, change production env vars, or read or write production data.
2. **Flags for behaviour.** Any change in behaviour (what a button does, what an endpoint returns, who receives an email) ships behind an off-by-default flag. Pure visual changes need no flag. They need an approved baseline diff.
3. **The money path changes visually only.** This covers the recarga wizard, the Banorte hand-off (`banorte-bridge.js`), the «Por aplicar» and «Verificar» queues, MultiCobros reconciliation and balance adjustments. Amounts, steps, validation and payment wording stay as they are unless I approve a change separately. Their tests change only in snapshots.
4. **CMS contract.** Published pages are stored block data. Renderer prop names and meanings are frozen. New props are optional, with defaults that keep today's output. Content is the school's job in Contenido: no content migrations. The publish gate keeps working.
5. **SEO and PWA.** No URL changes. The per-URL raw-HTML head, JSON-LD (FAQPage, Event), 404/410 handling and redirects stay. Every precached `.html` must answer 200. `check:sw` and `check:budgets` stay green.
6. **Privacy already built in stays.** The ficha stays private until «Aceptado». Medical data stays masked for staff. Synthetic `@alumnos.` addresses never receive email. Emails name a student by first name and initial only.
7. **Outside the repo.** `Interlaken Edu App/` and `Cafetaria - interlaken/` are separate, git-excluded projects. Leave them alone.
8. **UI freeze, with one exception.** No unrelated front-end change merges during a phase, except hotfixes for live issues. Rebase the phase branch after a hotfix.
9. **Environment.** Development runs on Windows 11. Generate and update Playwright baselines in CI on Linux, never from Windows. The editor's preview browser does not paint animation frames, so take screenshots with Playwright. Save files as UTF-8 and check accents (á, ñ, «»).

## 3 · Standing rules

### 3.1 Working
1. Read the repo standard first (the docs in §1.3). It wins over generic or skill advice. Log every conflict in the audit for my decision.
2. One phase at a time and one PR per phase. Branch `ux/<phase>-<topic>`. Conventional Commits.
3. Every PR carries before and after screenshots at 390 and 1280 px, the baseline diff list, a metrics table against Phase 1, the tests added, the risks and a rollback note.
4. Local or seeded data only. Test emails go only to inboxes I name.
5. All checks stay green. Everything new has tests.
6. Tokens only in components: no raw colours, sizes, radii, z-index values or arbitrary widths. Emails and Unfold use literal values that a parity test ties to the tokens.
7. Run `code-review` at the end of every phase, and `security-review` on any change to scope, auth or email content.
8. New dependencies, dev dependencies included, need my OK. Propose them in Phase 1.

### 3.2 Visual (targets; D1 to D4 in §4 set the exact values)
- **Corners:** two radius tokens only. `radius-sm` for controls (buttons, inputs, selects, segmented controls, small tiles). `radius-md` for surfaces (cards, panels, dialogs, drawers, sheets, images, email blocks).
- **Pills:** `rounded-full` only for badges, plus avatars, switch thumbs and notification dots.
- **Badges:** only for a status or a count the person needs. Text plus icon, never colour alone. At most one per row or card.
- **Cards:** borderless. Separate them with a tinted surface, spacing or a subtle shadow. Hairlines stay only on form fields and table rows. Never a card inside a card.
- **Colour 60/30/10:** neutrals (white, cream) about 60 %, purple structure about 30 %, one accent for calls to action about 10 %. Status colours for status only. Nivel colours (preescolar, primaria, secundaria) are accents only, and the yellow is never text.
- **Emphasis:** one highlight style for key words, at most once per section.
- **Layering:** page < sticky < dropdown < drawer < modal < toast. Place the tab bar, the WhatsApp button and the cookie banner explicitly on that scale.

### 3.3 Copy (es-MX, usted)
- Spanish only, in the **usted** register, as today. Domain terms as in DESIGN.md §4.
- Cut text that repeats the UI. Headings carry the message, with at most one supporting sentence per section.
- Titles of 6 words or fewer. Messages of 15 words or fewer that say what happened and what to do next. Buttons start with a verb («Recargar saldo», «Ver movimientos»).
- Keep legal, pricing, consent, payment and safety text intact.
- Layouts survive strings 30 % longer, because the school edits CMS content.
- Keep one shared glossary (recarga, saldo, folio, movimiento, ficha, pre-registro, comunicado, aviso, credencial, ciclo escolar) and use it everywhere, emails included.

### 3.4 Icons
- lucide-react only. Official SVGs for third-party logos. Emails use hosted PNG icons at 2×.
- Sizes: 16 (inline), 20 (buttons, inputs), 24 (navigation, headers), 32 to 48 (empty states only). One stroke width throughout.
- Icons inherit the text colour. Brand colour for active states, status colours for status.
- Use them for navigation, primary actions, status, file types, empty states, field adornments, KPIs and list metadata. Never on every heading or bullet.
- Icon-only buttons have an `aria-label` and a tooltip. Decorative icons are `aria-hidden`. Meaning never rests on icon or colour alone.
- One icon per concept (alumno, familia, nivel, cafetería, recarga, saldo, movimiento, pago, credencial, comunicado, aviso urgente, visita, pre-registro, documento, ficha, calendario, mensaje, auditoría, ajustes), documented on `/_design`. Content icons keep coming from `cms/icons.ts`. Tree-shaken imports only.

### 3.5 Motion
- Motion explains something: new content, a state change, feedback or continuity. No decorative loops.
- Sections fade and rise 8 to 12 px, once per view. List stagger is capped at 6 items. Dialogs, drawers and sheets share one enter and exit.
- Micro-interactions: press, focus, toasts, row hover, the tab indicator. Errors change colour and icon and never shake.
- 150 to 300 ms from tokens. `prefers-reduced-motion` is honoured. No animation in email.

### 3.6 Student data privacy (every phase)
- Seeded fake data only in screenshots, PRs, fixtures, demos and test emails.
- No names, CURP, matrícula or email addresses in URLs, page titles or analytics. Internal numeric keys in authenticated console URLs are acceptable. Analytics never receives them (GA4 is consent-gated and runs on public pages only).
- Scope is enforced on the back end and tested. A parent sees only linked children, a student only themselves, a staff cafetería account only its own wallet, staff only their areas, and admins everything.
- Sensitive fields (medical data, ficha answers, documents, family notes, balance adjustments and their reasons) sit behind a deliberate click. They never appear in previews, toasts, push text, WhatsApp text or email subjects. Email bodies follow D13.
- **Law.** Mexico's LFPDPPP applies (new text published on 20 Mar 2025; the supervising authority is now the Secretaría Anticorrupción y Buen Gobierno), together with the school's aviso de privacidad. For any advertising email, LFPC art. 18 Bis forbids sending publicity to people who refused it or are listed in PROFECO's REPEP [Likely applies]. GDPR, COPPA and CAN-SPAM don't target this audience, so don't design for them. Flag gaps for the school's counsel. Give no legal conclusions.

### 3.7 Surface pass checklist (every pass in Phases 5 to 9)
Copy (§3.3), icons (§3.4), motion (§3.5), every state (Phase 4.4), the accessibility checks of Phase 1.3, privacy (§3.6), print where Phase 11 applies. Type, colour, content, icons, media, tables and motion must read as one system.

## 4 · Known conflicts: decide in Phase 1

The audit gathers evidence for every row, and I decide in Phase 2. Until then, the "Today" column rules.

| # | Topic | Today (repo) | Target | Recommendation |
|---|---|---|---|---|
| D1 | Radii | `--radius` 18 px on cards, 24 px panels; about 590 radius utilities outside any two-token set (`rounded-xl` 214, `rounded-lg` 174, `rounded-xl2` 114, `rounded-2xl` 48, arbitrary 31). Tailwind's own `rounded-sm` is 2 px and `rounded-md` 6 px | Two tokens | `radius-sm` 8 px and `radius-md` 12 px; remap Tailwind's `rounded-sm` and `rounded-md` to them; lint bans the rest. Show 3 screens before and after first |
| D2 | Buttons | Pill buttons (`.btn`, 50 px radius) | Pills for badges only | `radius-sm` buttons, decided with D1, because this is the most visible change |
| D3 | Cards | `.card` = hairline border + `shadow-card` | Borderless | Tint on cream pages, a soft shadow on white sections, hairlines only on fields and table rows |
| D4 | Pills | 234 `rounded-full` uses (badges, chips, avatars, dots, buttons) | Badges only, with text and icon | Classify every use in the audit and convert the non-badges |
| D5 | Widths | RESPONSIVE.md audits at 360, 390, 768, 1024, 1440, 1920; baselines at 390 and 1280 | 360 to 1536 | Audit at 360, 390, 768, 1024, 1280, 1440 (plus 1920 for the console two-pane view). Keep the 390 and 1280 baselines and add 768 for the portal and console |
| D6 | Errors | DRF shapes + `code`, through `apiErrors.ts` | A new `{success, error{code, details}}` envelope | Keep the existing contract. Add machine field codes only where the UI must branch. Add a contract test on the shapes |
| D7 | List params | `q`, `ordering`, `page`, `page_size` | `q`, `sort`, `order`, `page`, `pageSize` | Keep the existing parameters |
| D8 | Language | es-MX only, no i18n library | i18n for every string | No i18n framework; a proposal with its effort only |
| D9 | Theme | SPA light only (`color-scheme: light`); Unfold has light and dark; emails declare light | Every theme | No SPA dark theme. Unfold passes AA in both themes. Emails survive forced dark in the Gmail and Outlook apps, with a dark-safe logo |
| D10 | Motion | 300 ms ceiling, no page transitions | Page transitions up to 500 ms | Keep 300 ms and no page transitions |
| D11 | JS budget | 150 kB gz per public route (home 170), 120 kB per chunk, portal chunks forbidden on public routes | 200 kB per route | Keep the public budgets. Measure portal and console routes, then propose budgets |
| D12 | Lighthouse | DESIGN.md: ≥ 95 / ≥ 95 on `/`, `/admisiones`, `/pre-registro` | Performance ≥ 90, Accessibility 100 | Accessibility 100 on every public route; Performance ≥ 95 on those three and ≥ 90 elsewhere, on mobile |
| D13 | Amounts in email | Receipts and top-up emails show the amount, folio, new balance and the child's first name and initial (owner's design, 8 Nov 2026) | No amounts in subject or body | Subjects never carry names or amounts. Receipts for something the family itself did keep amount, folio and balance, because a receipt without them is useless. Comunicados and alerts carry no student detail |
| D14 | Flags | Back-end env settings only (`PAYMENTS_LIVE`, `CAFETERIA_TOPUP_APPLY_MODE`); no SPA flag system | A flag per dashboard | Propose the smallest mechanism: an env setting, off by default, exposed through an existing config response. Only behaviour changes use it |
| D15 | Session | 15 min access token, 7 day refresh, silent refresh; no idle timeout | Warn 2 minutes before timeout | No warning. When a refresh fails, keep the input (drafts), go to login, then return to the same page with the input kept |
| D16 | Photos | The school's own campus photography, some of which may show students | Real students only with written consent | Keep them and ask the school to confirm that consent is on file. No AI-generated or stock people presented as Interlaken students, staff or families |
| D17 | Header context | One campus; ciclo escolar; staff areas | Role, campus, term | Families see the active child. Staff see role and areas. Ciclo escolar only where it scopes data |
| D18 | Accent | Site calls to action pink (`--grad-cta`), portal primary actions purple, email buttons green-dark `#316F1C` | One accent | Set one primary-action colour per surface family in Phase 3; emails follow the site |
| D19 | Table state | Columns and density saved per person (`tableId`) | Everything in the URL | Search, filters, ordering and page go in the URL; columns and density stay personal preferences |
| D20 | Tickets | GitHub PRs and docs in `docs/` | JIRA tickets | Markdown tickets in `docs/UX-PLAN.md`, ready to paste as GitHub issues. Create issues only on my OK |

**Known drift to confirm and fix in Phase 3:** Unfold's `subtle` text still uses `#9A93AE` (2.93:1, the value DESIGN.md retired in favour of `#726B89`). The email page background `#F4F1EA` and the hex values in `emailing.py` `TONES` are not tied to the tokens.

## 5 · Skills and tools

Use what is installed. Install nothing.
- **impeccable** (critique, audit, polish, animate) and its reviewer agents (finish reviewer, motion reviewer). Keep `.impeccable/config.json` as it is.
- **interface-design** for console and dashboard layout.
- **ui-ux-pro-max** as advice only. Its palette and style suggestions were rejected before (DESIGN.md §4.5), because the logo fixes the palette.
- **dataviz** before touching any chart. Charts read `frontend/src/lib/chartTheme.ts`.
- **run** to start the app and see changes. **code-review**, **simplify** and **security-review** at the end of each phase.
- **claude-seo:seo-technical** and **seo-performance** (optional) for Core Web Vitals on public pages.
- **Freepik / Magnific** tools for media, in Phase 10 only, within a budget I approve. **Figma** only if I ask for comps.

frontend-design, Anthropic Design, Dashboard Design (UXKIN) and dataink are not installed. If you believe one adds something the installed set lacks, propose it with its publisher, what it adds and its risks (dataink runs a hook after every tool call), then wait.

## 6 · Phase 1 · Audit and baselines (documents only, no code)

**Deliverable:** `docs/UX-AUDIT.md`, replacing `docs/UI-UX-AUDIT.md` of 22 Aug 2026. Screenshots go in a gitignored folder and are referenced from the audit. Stop for approval.

### 1.1 Verify the map
- Confirm or correct §1. List the routes per role from `App.tsx`, `ProtectedRoute` and `lib/areas.ts`.
- **Scope per endpoint:** which endpoints enforce family, student, staff-area and admin scope on the back end, and which tests prove it. Any gap is P0.
- **Tokens:** every colour, type, spacing, radius, shadow, z-index, breakpoint and container value, and where it is used. For `oklch()`, report feasibility only; no migration.
- **Duplicates:** for example Card, SectionCard and `.card`; Modal, ConfirmDialog and BulkConfirmDialog; Badge, LiveBadge and inline chips; ListSkeleton and TableSkeleton; CookieBanner and CookieConsent; date and money formatters. Propose one of each.
- **Email inventory:** every send site with its family (Phase 9), audience, subject, preheader and button, and whether it carries names, amounts or other sensitive data. Report SPF, DKIM and DMARC status, read-only.
- **Capability matrix (exists, partial or missing):** sibling switcher; notification panel and preferences; urgent pinning and grouping; comunicado comments; threaded messaging; calendar filters and ICS (visit `.ics` exists; is there a subscription feed?); undo toasts; drafts autosave; offline states; onboarding checklists; site search; print styles.

### 1.2 Screenshots (seeded data)
- **Public:** the 22 routes at 360, 390, 768, 1024, 1280 and 1440 px, anonymous.
- **Family portal:** every route as a parent with one child, a parent with two children, a student and a staff cafetería account, at 360, 390, 768 and 1280.
- **Console:** every route as admin at 768, 1280, 1440 and 1920 (two-pane); each staff area (secretaría, recepción, cafetería) at 1280 on the routes it reaches.
- **Django admin:** the index, plus one changelist and one change form per group, in light and dark.
- **States:** loading, empty, error, no results and permission denied wherever reachable.
- **Engines:** Chromium, plus WebKit with an iPhone profile for the pilot screens and the recarga wizard.
- **Emails:** each template rendered from seeded data at 600 and 375 px, with images on and off, plus a simulated forced-dark pass (labelled as an approximation).
- Prune repeats: skip a screenshot that shows no new issue.

### 1.3 Score each screen and email
- Alignment with the header and footer edges, and any horizontal overflow.
- Tap targets ≥ 44 px (≥ 48 px in student views) and WCAG 2.2 target size.
- Radii and pills outside the target set, bordered or nested surfaces, badges per row.
- Primary buttons per view, alert blocks visible at once, words above the fold.
- axe serious and critical issues; focus order and visibility, including focus hidden under the sticky header, tab bar, cookie banner or WhatsApp button (WCAG 2.4.11); overlaps between layers.
- Icon sizes, strokes and meaning; media gaps and off-brand images.
- Strings 30 % longer; print output where Phase 11 applies.
- **Emails:** brand fit, hierarchy, one clear action, image quality, mobile rendering, forced dark, alt text, plain-text part, sensitive data in subject or body, footer reason and avisos link, HTML size.

### 1.4 Baseline metrics (re-measured after every phase)
- Lighthouse mobile and desktop (the existing configs) on the 22 public routes, plus one portal and one console route if authenticated runs are feasible.
- axe serious and critical count per route. vitest-axe covers components; route-level checks need `@axe-core/playwright`, so propose it.
- Gzipped JS per route from `check:budgets`, extended in the report to portal and console routes.
- LCP and CLS under Lighthouse's default mobile throttling.
- **Task scripts** (Playwright, seeded data), counting clicks and time:
  - Public: submit a pre-registro; book a visit.
  - Family: see the balance; start a top-up up to the sandbox checkout; show the credencial; read the latest comunicado; change avisos; switch child.
  - Staff: verify a loaded top-up; review an admissions case; confirm a visit; send a test comunicado to a seeded audience.
  - Admin: find a student.
- **Real completion and error rates** need production reads. Write the exact read-only queries, explain what each one measures, and ask me. Never run them yourself.
- **Email opens and clicks:** not measured. No tracking pixels, by design.

### 1.5 Output
- Issues ranked **P0** (broken, privacy or scope risk, money-path risk, accessibility blocker), **P1** (inconsistent) and **P2** (polish). Each has file and line, a screenshot reference, the rule it breaks, the fix and the effort in hours.
- Evidence and a recommendation for D1 to D20.
- A plan to consolidate duplicate components.
- Missing-feature proposals with effort, kept separate from the issues. Do not build them.

## 7 · Phase 2 · Decisions, pilot and delivery plan

### 2.1 Decisions
I decide D1 to D20. Record each one in `docs/decisions/` (one short ADR per changed standard), then update DESIGN.md, DESIGN-TOKENS.md and RESPONSIVE.md to match.

### 2.2 Pilot
- **Scope:** `/pre-registro` (the admissions inquiry form), the parent dashboard `/portal` for a parent with two children, and the «Pre-registro recibido» confirmation email to the applicant.
- **Additive tokens:** add the new tokens next to the old ones and use them only on the pilot screens, so nothing else changes.
- **Apply** the rules of Phases 3 to 9 and the surface checklist (§3.7) to the pilot only.
- **Review:** Playwright WebKit (iPhone), Chromium with a mid-range Android profile, and desktop. Add a short checklist for me to run on a real iPhone with Safari and an Android phone with Chrome. For the email: render tests, then test sends to the Gmail, Outlook and Apple Mail inboxes I name.
- **Show me** the before and after screenshots and the metric deltas. One PR, not merged until I approve.

### 2.3 Delivery plan
After the pilot is approved, write `docs/UX-PLAN.md`: one epic per phase, stories with acceptance criteria, estimates in hours, dependencies, order, a risk register and a timeline. The risk register covers the money path, published CMS content, the PWA cache, baseline churn and school dates (inscripciones, the December break, the end of the ciclo). Wait for my approval.

## 8 · Phase 3 · Foundations

1. **Baselines first.** The first commit extends the regression baselines (D5), generated in CI, before any visual change.
2. **Semantic tokens** on top of the brand tokens:
   - surface (page, raised, tint, inverse); text (ink, muted, subtle, on-dark); border (field and row hairlines only);
   - status pairs (success, warning, danger, info) with an AA foreground on their tint;
   - radius (sm, md, full for badges); elevation (two shadows); a z-index scale; motion (durations, easing, 8 to 12 px distance);
   - density: comfortable for public and family views, compact for the console, set once on the layout root.
3. **One source of truth.** A pytest parity test reads `index.css` `:root` and fails when the email constants (`emailing.py`, `base.html`) or the Unfold `COLORS` drift from the tokens. Fix the known drift listed in §4.
4. **Lint.** Reject raw hex in components (already checked), arbitrary `rounded-[…]` and `z-[…]`, arbitrary pixel widths, and radius utilities outside the set. Allowlist exceptions with a reason.
5. **Width.** Public pages use one `Container` (`max-w-6xl`) aligned with the header and footer. Text runs 65 to 75 characters per line. Forms and auth use the small container. The portal uses 1320 px (1680 px at 2xl) on every route. Prefer logical properties in new CSS, with no mass migration (Spanish is left-to-right).
6. **Type.** One h1 per page, no skipped heading levels, 16 px body text on phones, Poppins and Inter only.
7. **Localisation helper.** One helper for dates (DD/MM/AAAA), numbers and MXN, in America/Mexico_City.
8. **Consolidate** the duplicate components approved in Phase 1, with no visual change beyond the approved decisions.
9. **`/_design`.** A dev-only page showing every token, primitive and state, the icon map and the email blocks. It is left out of the production bundle and the PWA precache, and never linked.

## 9 · Phase 4 · Shared patterns

### 4.1 Forms
- One `Field` component built on react-hook-form + zod: label, hint, required mark, and an error under the field with an icon and one line, wired with `aria-invalid` and `aria-describedby`.
- Validate on blur, then live once a field has been touched. No error lists. On submit, focus the first invalid field. Long forms (ficha, inscripción) add one line: «2 campos requieren atención».
- Server errors map onto fields through `apiErrors.ts`.
- Correct `type`, `inputMode` and `autoComplete` on every field; a show/hide toggle on passwords; Spanish names (accents, ñ, two surnames); 10-digit Mexican phone numbers; CURP in capitals; dates as DD/MM/AAAA.
- Keep drafts autosave, and extend it to every flow longer than one screen. Warn before someone leaves with unsaved changes.
- WCAG 2.2: no redundant entry, and sign-in without cognitive tests (Google sign-in and password managers keep working).

### 4.2 Feedback

| Situation | Pattern |
|---|---|
| Field problem | Inline only |
| Success, or a non-blocking failure | Toast: one line, 8 words or fewer, 4 to 6 s, `aria-live` |
| Reversible action | Toast with «Deshacer», only where the API can undo; otherwise a proposal |
| Irreversible or blocking (delete, mass comunicado, balance adjustment, refund, payment failed, refresh failed, no permission) | Centred modal, focus trapped, showing the impact count, with one primary and one secondary action |
| Page state (offline, maintenance, active emergency) | One banner at the top of the content |

### 4.3 Dialogs and system pages
- Modal sizes sm, md and lg. A bottom sheet under `sm` for forms with three or more fields, centred otherwise. Scroll lock, focus trap, and focus returns to the trigger.
- Session handling follows D15. Refine the look of the 404 page, the error boundary and `offline.html`.

### 4.4 States everywhere
- **Loading:** a skeleton shaped like the content.
- **Empty:** why it is empty, plus one action.
- **Error:** a retry, with input kept.
- **No results:** a clear-filters action.
- **Permission denied:** names the area needed, for example «Requiere el área Cafetería y pagos».
- **Session ended:** a way back to sign in.

### 4.5 Tables
- **Desktop:** `DataTable` everywhere. Text left, numbers right with tabular figures, one date format, row actions in a menu at the end of the row, sticky header, pinned first column, one toolbar for search, filters and ordering, pagination below. URL state follows D19.
- **Phones:** columns declare a priority from 1 to 3. Below `md`, rows become borderless stacked items, in one pattern that replaces today's mix of `data-label` cards and bespoke lists. No sideways scrolling.

### 4.6 Charts
Only where a trend or a comparison matters (the console dashboard, cafetería spending). Labelled, AA contrast, with a text summary. Use the dataviz skill.

### 4.7 Shell, navigation and notifications
- **Public header:** the items stay as the school set them in Navegación; refine the presentation only. A clear Portal link. An active emergency shows as one top banner (check whether the public site has one; if not, propose it).
- **Portal header:** one flat bar with a bottom hairline, no boxed icon buttons, at most 4 targets on the right at 360 px. Profile, avisos, privacidad and sign-out live in the account menu.
- **ChildSwitcher:** unmistakable in the header, showing the active child's name and avatar. Switching re-scopes balance, movements, credencial and notifications. A test proves that no data from child A shows after switching to child B (query keys per child).
- **Console header:** role and areas visible; ciclo escolar where it scopes data.
- **Notifications:**
  - A bell with a dot or a count, opening one panel: a popover on desktop, a sheet on phones.
  - Rows only, with an unread dot and «Marcar todo como leído».
  - Urgent items pinned first, then action items (top-up pending, document rejected, low balance), then info. Repeats grouped. Every item deep-links to its target.
  - The same wording in-app, by email, by push and on WhatsApp, with no sensitive detail.
  - Fill API gaps, with tests, only within the existing models. Anything larger is a proposal.

## 10 · Phase 5 · Public site

- Work in `cms/sections/*` and `cms/blocks/*` under the CMS contract (§2, rule 4).
- **Above the fold:** a clear value proposition, real campus photography, defensible proof points (SEP incorporation, 40-year history, certifications; never the unverified figures listed in DESIGN.md §7), and one next step («Inicie su pre-registro»).
- **Admissions:**
  - `/admisiones`, `/admisiones/documentacion` and `/admisiones/costos`, with pricing text intact.
  - `/pre-registro`: steps, autosave, input modes, required cues, and a confirmation on screen and by email.
  - `/agendar-visita` (slots, confirmation with `.ics`) and `/contacto`.
- **Calendario and galería:** filters where the data supports them (audience, level). ICS subscription only if it exists; otherwise a proposal. There is no site search, so search is a proposal only.
- **Levels:** `/niveles/:nivel`, with the nivel colours as accents.
- **Performance:** LCP ≤ 2.5 s and CLS ≤ 0.1 (aim for 0.05) on mobile. Keep `preload-lcp.js`.
- **Leave untouched:** cookie consent, the consent-gated analytics (GA4 is not live), JSON-LD and the per-URL head.

## 11 · Phase 6 · Family portal

- **«Hoy» comes first.** Before anything else, show what needs attention now:
  - low balance and top-ups still pending;
  - urgent and unread comunicados;
  - pending admission steps (ficha, missing documents);
  - an upcoming visit.
  Then at most 4 KPIs (balance per child, this week's spending), then movements and comunicados.
- **Calm wording:** plain and supportive. Status badges with text and icon.
- **Money path:** visual changes only (§2, rule 3).
- **Credencial:** the barcode stays scannable (keep its `#111827` contrast exemption). It works offline from the PWA cache, and cached data shows when it was last updated.
- **Phones:** 44 px targets (48 px in student views), borderless items instead of tables, skeletons, at most 4 surfaces above the fold at 390 px, one surface level.
- **Students:** shorter copy at a primaria reading level, and larger type in Mi cafetería and the credencial.
- **First run:** refine the checklist per role if one exists (link your children, turn on avisos, save the credencial); otherwise propose one.
- **Privacy:** visibility follows guardian links, and nothing sensitive appears in previews.
- **Release:** behaviour changes go behind a flag (D14).

## 12 · Phase 7 · Staff console (`/admin`, `/staff`)

- **Exceptions first.** The dashboard lists what is pending:
  - top-ups «por aplicar» and «por verificar» (MultiCobros), and failed payments;
  - documents to review, new pre-registros, today's visits;
  - unanswered messages, password requests, ARCO requests;
  - Loyverse sync alerts.
  Each item opens its filtered queue in one click. Staff see only their own areas' items and land on their first area, as today.
- **Tables:** `DataTable` with URL state and multi-facet filters (the filtersets exist). Inline edit only where it is safe, and never on balances.
- **Bulk actions:** the existing contract (select all matching, the impact count in `BulkConfirmDialog`). Add progress and an error summary for imports and exports. Undo only where the API supports it.
- **Comunicados:** before sending, show the audience count, the rendered email and a test send to the signed-in admin's own address. The emergency broadcast stays admin-only, behind a blocking confirmation.
- **Record drawers:** refine the existing two-pane pattern. Add Prev and Next buttons that keep the table position and filters. Pilot them on Alumnos and Admisiones before rolling them out further.
- **Roles and audit:** restricted actions are disabled and show the reason. Sensitive edits (balance adjustments, staff areas, guardian links) show their audit trail from `core.AuditLog`, read-only.
- **Content editor:** apply the foundations to its shell (action bar, onboarding, review dialog), with no workflow changes.
- **Density:** compact.

## 13 · Phase 8 · Django admin (Unfold)

- Follow the rules in `docs/ADMIN-VS-PORTAL.md`: duplicated portal models don't come back, read-only stays read-only, and people and money are never edited here.
- Refine only through the `UNFOLD` settings, `backend/static/admin/unfold-interlaken.css` and ModelAdmin options: `list_display`, `list_filter`, `search_fields`, `readonly_fields`, fieldsets, Spanish verbose names, `help_text`, ordering, `date_hierarchy` and display decorators. No new template overrides beyond the existing `admin/index.html`, so Unfold upgrades stay safe.
- Colours come through the parity test (Phase 3, item 3). Both themes pass AA.
- The dashboard callback shows system KPIs and sends operational work to the console («Esto se gestiona en la consola»).
- **Tests:** for every registered model, the changelist and change form open for a superuser and refuse anyone else. Read-only models refuse add and delete.

## 14 · Phase 9 · Email

### Three families

| Family | Interlaken emails | Content rules |
|---|---|---|
| **A · Transactional and security** | Access (password, temporary password, email confirmation); admission accepted with credentials; cafetería (top-up applied or requested, low balance, adjustment, failed or refunded payment, spending digest); admissions (pre-registro received, invitation, document approved or rejected, ficha); visits (confirmed with `.ics`, 24 h reminder); ARCO; internal staff and ops alerts | One message, one action. Brand header and footer only. **No promotional blocks.** Emergencies use this layout |
| **B · School notices** | Comunicados to enrolled families | Service communications, not marketing [Likely]. A hero image only if the comunicado has one; up to 3 content cards (date, place, portal link). No promotion |
| **C · Marketing** | Open day, admissions campaigns, newsletters to prospects | **Does not exist.** Proposal only: it needs a consent purpose in the aviso de privacidad, unsubscribe, a suppression list that honours refusals and REPEP, and list management. Design its blocks on `/_design`, but build no sending path |

### Layout
- `EmailContent` + `base.html` stay the system. Add optional blocks (hero, cards, stat strip) for families B and C. A test fails if a family A email renders one of them.
- **Preheader:** 90 characters or fewer, complementing the subject (today it defaults to the intro).
- **Header:** the logo as a PNG at 2×, with a dark-safe version.
- **Footer:** as today (school, address, contact, hours, why this email arrived, avisos link), in text of at least 12 px. Unsubscribe only once family C exists.

### Borderless cards
- Move the main panel and the details table from bordered blocks to tinted blocks without borders, at `radius-md`. Outlook desktop shows square corners, and the design must still look right.
- A card holds an optional image, an optional label, a heading, 1 to 2 lines, and a button or text link.
- Layouts: a full-width card, two columns that stack on mobile, image-left list rows, a stat strip. At most 5 cards, with 24 to 32 px between them.

### Buttons, type and colour
- Bulletproof table-cell buttons (as today), at least 44 px tall, `radius-sm`. Add a VML fallback only if Outlook desktop testing shows it is needed.
- One primary button per email, in the D18 accent. Secondary actions are text links. Labels start with a verb.
- System font stack. Body 16 px, headings 22 to 28 px, line height 1.5. AA contrast. Colours come through the parity test.

### Technical
- 600 px wide, table layout, inline styles, `role="presentation"`, `lang="es"`.
- `color-scheme: light`, plus a forced-dark check.
- Hosted images at 2× with width, height and Spanish alt text. The email stays readable with images off.
- A plain-text part (exists). HTML under 100 KB, so Gmail doesn't clip it.
- Absolute `https://interlaken.edu.mx` links. UTM parameters only on links to public pages, never with personal data. No tracking pixels.

### Copy and privacy
- Subjects of 50 characters or fewer: specific, no all-caps words, no names, no amounts.
- The body says what happened, what to do and by when. Amounts follow D13. Never medical data, ficha answers or CURP. Students by first name and initial only.

### Tooling and tests
- A dev-only command (for example `manage.py render_emails`) renders every template with seeded data to HTML and text files, for review and tests.
- Test sends go only to inboxes I name, through an SMTP setup I approve. Development keeps the console backend.
- **Client matrix:** Gmail (web, Android, iOS), Outlook (Windows desktop, Outlook.com), Apple Mail (macOS, iOS), and Samsung Mail if available. No paid rendering service or spam-score site without my OK.
- Check layout, images off, forced dark, links, the plain-text part and size.

## 15 · Phase 10 · Media (parallel track with its own approval)

- **Slots:** only where meaning needs an image, with at most one hero per screen. Candidates: the login side panel, the side column of admissions forms, public heroes, empty states, error and offline pages, onboarding, and comunicado email heroes (from the school's uploads).
- **Order of preference:** the school's own photography (CMS media library), then licensed stock with model releases, then illustration. One illustration style app-wide, for steps and empty states.
- **People:** never realistic AI-generated children. No stock or AI-generated people presented as Interlaken students, staff or families.
- **Look:** neutral whites with a subtle purple cast, consistent lighting, `radius-md`.
- **Freepik / Magnific workflow:**
  1. Check the credits and agree a budget per phase.
  2. Show 3 options per slot, and download only the ones I approve.
  3. Grade the images and remove backgrounds where needed.
  4. Keep the originals and a licence log outside the repo, at a path I give you. Commit only optimised copies.
  5. Report the credits spent.
- **Web delivery:** AVIF or WebP with `srcset`, explicit width and height, lazy loading below the fold, `fetchpriority="high"` on the hero, heroes of 180 KB or less, Spanish alt text. CMS uploads go through the existing pipeline.
- **Email delivery:** hosted JPG or PNG at 2×, under 200 KB each, absolute HTTPS URLs, explicit width and height.
- Log every slot in the docs and on `/_design`.

## 16 · Phase 11 · Print

**Print targets that exist today:**
- the credencial (barcode scannable, card size);
- cafetería movements and top-up receipts;
- the ficha in the browser (the server's Excel and PDF exports are exact formats, so leave them alone);
- the student file and the aviso de privacidad (both already have print styles);
- the weekly visits agenda, comunicados and costos.

**Rules:** no navigation or buttons; black on white; clean page breaks; table headers repeated on every page; logo and title at the top; the date in the footer, plus page numbers where the browser supports `@page` margin boxes. Check the print preview in Chrome and Safari.

## 17 · Phase 12 · QA, docs and release

- **Regression:** every PR is diffed against the baselines, emails included (screenshots of the rendered HTML). Update a baseline only for an approved change, and only in CI.
- **WCAG 2.2 AA:**
  - Zero serious or critical axe issues.
  - Keyboard passes through pre-registro, login, the recarga wizard up to the Banorte hand-off, one form and one table per role, and every dialog.
  - Focus is never hidden behind sticky UI.
  - Screen-reader spot checks with VoiceOver (iOS) and NVDA (Windows) on pre-registro, the portal home and two emails.
- **Performance:** D11 and D12 met; LCP ≤ 2.5 s and CLS ≤ 0.1 on mobile.
- **Browsers:** the last 2 versions of Chrome, Safari iOS, Firefox and Samsung Internet. On Safari iOS, check sticky elements, the viewport, input zoom (16 px inputs), safe areas and the installed PWA.
- **Email:** the Phase 9 client matrix.
- **Analytics:** GA4 stays off unless I turn it on. Report against the Phase 1 baselines with the measurable metrics only.
- **Tests:**
  - **Unit:** Field states, Badge text and icon, icon-only buttons labelled, column priority.
  - **Integration:** server errors mapped onto fields, back-end scope per role, notification wording identical across channels, URL table state, re-scoping on sibling switch.
  - **Contract:** the error shapes and the list parameters.
  - **End to end:** pre-registro error, fix, then success; a blocking failure shows the modal; a failed refresh keeps the input; sibling switch; bulk preview, confirm, then result; a phone table per role; the recarga wizard's visual path in sandbox.
  - **Email:** a render test per family; family A has no promotional blocks; no names or amounts in any subject; a denylist scan of the rendered seeded output finds no sensitive fields; every email has a text part and stays under 100 KB.
  - **Django admin:** the smoke tests and read-only tests from Phase 8.
- **Docs:** update DESIGN.md, DESIGN-TOKENS.md and RESPONSIVE.md; add `docs/EMAIL-DESIGN.md`; write one ADR per changed standard; keep `/_design` current; add staff UAT cases to `docs/UAT.md`.
- **Release:** one PR per phase with screenshots, diffs and metrics. For every merge I approve, give me deploy notes: the `deploy.sh` steps, any env var or crontab change, the flag state and the rollback.

## 18 · Definition of done

- D1 to D20 are decided and recorded. The pilot and the delivery plan are approved.
- **Layout and visuals:** every public page aligns with the header and footer from 360 to 1440 px, with no horizontal scroll. Radii use the two tokens, pills are badges only, and badges appear only where needed. Cards are borderless and never nested.
- **Forms and feedback:** no error lists. Errors sit inline. Modals appear only for blocking or irreversible actions. Undo is offered wherever the API supports it.
- **Shell:** headers are flat and show the right context. The ChildSwitcher is unmistakable, and its scoping is tested.
- **Surfaces:**
  - Public pages build trust and meet LCP and CLS.
  - The family portal leads with «Hoy».
  - The console is exceptions-first, with URL-synced tables, safe bulk actions and visible audit trails.
  - The Django admin is clear, passes AA in both themes and is still read-mostly.
- **Email:** every template is on-brand, built from borderless blocks, and correct across the client matrix including forced dark. Each has a text part and no sensitive data, and family A carries no promotion.
- **Shared standards:** every view handles every state. One icon system. Media is approved, licensed and optimised. Motion comes from tokens. Print works.
- **Live safety:** the money path, published CMS content, the SEO head, the PWA and the budgets behave exactly as before. Behaviour changes sit behind flags.
- **Privacy:** no real student data anywhere. Scope is enforced and tested on the back end.
- **Quality:** regression, tests and lint are green. The WCAG 2.2 AA, performance, browser and email targets are met. Metrics improved, or the reason is written down. Docs and `/_design` are updated.

## 19 · Out of scope

- New brand colours or fonts, and logo changes (`Logo.tsx` uses the official artwork).
- New features or roles: propose them, don't build them.
- Payment logic and the money path's behaviour, Banorte's hosted pages, and Loyverse.
- URL and SEO structure.
- The sending provider and DNS.
- CMS content itself.
- Production data, env vars and deploys, and real sends to families.
- The native app folders.

**Start with Phase 1 only. Deliver `docs/UX-AUDIT.md` with the evidence for D1 to D20 and the missing-feature proposals, then stop and wait for my approval.**
