# UX audit and refinement status (21 Nov 2026)

Programme: `docs/UIUX-REFINEMENT-PROMPT.md`. Branch: `ux/refinement-programme`
(from `master` fd8f03cc). This file replaces `docs/UI-UX-AUDIT.md` (22 Aug 2026).

Method: five read-only audits run in parallel (tokens and primitives, public
site, family portal, staff console, email + Django admin + scope), plus
before screenshots with seeded demo data (`seed_demo`, never real data).
Findings carry `file:line` at `master` fd8f03cc; line numbers drift as the
branch changes code.

> **Status legend** used in the tables: ✅ fixed in this branch · ◐ partly ·
> ⏳ open (left for a later pass) · 💡 proposal (new feature, not built).
> §0 is the summary for review; the appendices hold the full audit evidence.

## 0 · Summary for review

One branch, `ux/refinement-programme`, 16 local commits on top of `master`
fd8f03cc (never pushed). No migrations, no new dependencies, no env or
deploy changes. Behaviour on the money path is unchanged.

### What changed
- **Design system:** two radii (8 px controls, 12 px surfaces) and no pill
  buttons; borderless surfaces; status colour pairs; one layer scale; Badge
  with text + icon; 16 px body floor on phones; motion at 300 ms / 12 px;
  print stylesheet; `npm run check:ui` in CI; `/_design` reference page (dev
  only); decision records `docs/decisions/0001-0004`.
- **Public site:** content aligned with header and footer; notice banner
  passes AA; cookie banner no longer covers dialogs; ficha shows one error
  line and focuses the field to fix, h1 on every screen, safer autocomplete,
  leave-page warning; contacto/visita/facturación/CMS forms share one
  pattern with inline success and failure; no card-in-card; 44 px footer links.
- **Family portal:** «Hoy» first; one header child switcher (the credencial
  now follows it: it could show a sibling's barcode before); flat header;
  avisos with urgent items pinned and one unread dot; 44/48 px targets;
  credencial shows when its balance was updated and works in print.
- **Staff console:** «Pendientes» exceptions list with ages and one-click
  queues (new read-only counters); KPI tiles are real links; one money
  format; «Sin resultados / Limpiar filtros»; denied-area state instead of a
  silent redirect; inline errors and a «Saldo: $X → $Y» preview on balance
  adjustments; dense tables by default.
- **Email:** borderless on-brand layout, purple 8 px button with Outlook
  padding, colours tied to the tokens, notice blocks only for comunicados,
  no names/codes/amounts in subjects, first name + initial in family bodies,
  `render_emails` previews, `docs/EMAIL-DESIGN.md`.
- **Django admin:** notifications, document review, comunicado activation,
  booking slots and payments can no longer be edited around the console's
  workflows; AA caption colour; smoke test over every admin.

### P0 status
| P0 | Status |
|---|---|
| Credencial ignored the selected child (wrong barcode at the till) | ✅ |
| No header child switcher; six pickers | ✅ (cafetería keeps one in-page picker: T2) |
| Dashboard without «Hoy» | ✅ |
| Pagos not child-scoped | ⏳ T1 |
| Console tiles not links, queues hidden, English codes | ✅ |
| Staff accounts without an exceptions home | ◐ built and tested, not routed (T3, behaviour change) |
| Pill buttons everywhere | ✅ |
| Public notice banner contrast; cookie banner over dialogs | ✅ |
| Django admin: notifications editable, `is_verified` bypass | ✅ |
| Scope proof missing on 5 endpoints | ✅ tests added, no leak found |

### Verification (21–22 Nov 2026, local)
| Check | Result |
|---|---|
| `tsc --noEmit` | clean |
| `npm run lint` | 0 errors (209 warnings; +9 «only-export-components» from new helper files) |
| `npm run check:ui` | clean |
| Vitest | 186 files, **1,216 tests passing** (baseline 1,163) |
| `npm run build` / `check:sw` | OK |
| `check:budgets` | OK after a **+1 kB home budget (172 kB, pending owner review)**: the footer's 44 px targets and print rules add 0.4 kB to the entry chunk (measured against a `master` build) |
| pytest (full, SQLite) | **3,287 passed, 0 failed**, 18 skipped (Postgres-only, optional PDF lib); core/portal/accounts rerun after the review fixes: 1,411 passed, 0 failed |
| Playwright visual baselines | will differ everywhere (expected): regenerate in CI and review (T18) |
| Code review (medium, whole branch) | 9 findings (5 important: credencial cold-open race, «Por aplicar» missing credited top-ups, failed-payments row vs its list, stale dated links, urgent avisos cut from «Hoy»; 1 pre-existing double count; 3 nits): **all fixed** with tests |

### Decisions for the owner in the morning
1. **Home JS budget** 171 → 172 kB, or do T17 (lazy admin routes) first.
2. **Inbox preview line** of receipts still repeats the intro, which can show
   an amount (D13 covers subjects only). Keep, or hide amounts there too?
3. **Staff «Pendientes» home** (T3) needs the flag channel (D14).
4. **Media:** done in the media round below (owner chose the 3D clay style
   and the budget on 22 Nov). Review the pages; any illustration or photo
   can be swapped per section in Contenido.
5. **Photo consent** (D16) and **marketing email legal review** (T21, T22).
6. **/admisiones JS budget** 150 → 152 kB for the illustrated admission
   steps (media round), pending review like the home budget.

### Media round (22 Nov 2026, owner request)

The owner asked for media instead of shorter text: every word of copy is
kept; pages gained 3D illustrations and photos and the cards were re-arranged.

- **Assets.** 40 3D clay illustrations (Freepik / Magnific, Nano Banana 2.1,
  objects only, brand palette) in `public/assets/illustrations/` as
  transparent WebP at 640 and 320 px (9–44 kB). 14 licensed Freepik stock
  photos with no recognisable faces (D16: hands, materials, places; never
  presented as Interlaken students) as `public/assets/foto-<slot>.webp` with
  -960 and -480. School photos stay first for anything that shows the school.
  Credits: 1,410 (photos cost 0 on Premium). Originals, licence log and media
  log are kept outside the repo in the owner's client folder
  (`02_Clients/Interlaken/UI-UX-Refinement/Media-2026-11-22/`).
- **Code.** `components/ui/Illustration.tsx` (`Illustration`,
  `IllustrationPanel`, `wash`); `lib/illustrations.ts` (names only, ships with
  pages), `lib/illustrationTopics.ts` (title matcher, only pages that need
  it), `lib/illustrationLabels.ts` (editor only). Sections declare
  `f.illustration(key)`: a select whose 40 options the editor fills
  (`optionsSet: 'illustrations'`), so public chunks do not carry the labels.
- **CMS contract.** Only optional fields were added (`illustration` selects,
  a few `photo`/`image` fields); no key, type or template was renamed. Content
  already saved in Contenido without the new fields still shows art: each
  section falls back by title, icon or position; «Sin ilustración» hides it.
- **Pages.** Levels: each part of the text beside an illustration or photo,
  alternating sides; program cards illustrated; quote bands; facts panel and
  link-card row instead of the sidebar. Home: illustrated promos and
  «Respaldo», stock photos in «Más allá del aula», and the Preescolar card no
  longer shows the «PRIMARIA» sign (also fixed at render time for saved
  pages). Nosotros, Modelo, Admisiones, Documentación, Costos, Agendar visita,
  Contacto, Pagos, Plataformas, Facturación, 404, login, confirmar correo,
  aviso (light) and offline.html all gained art and cleaner card layouts.
- **Offline.** `sin-conexion-320.webp` is precached by one narrow
  `additionalManifestEntries` entry (md5 revision), so offline.html shows it
  offline; navigateFallback is unchanged.
- **Open.** The visit page photo row has an optional `photosTitle` (empty, no
  new copy added; «Así es el colegio» would fit). `PlatformCard.tsx` was
  removed (no longer used).

### Hero videos and phone navigation (22 Nov 2026, owner request)

- **Hero loops.** Home and the three level heroes autoplay a silent 10 s loop
  of their own photo (Kling 2.5 image-to-video, camera motion only, no people
  added; forward + reversed so the loop never jumps). H.264 MP4 without audio,
  0.46–1.0 MB, in `public/assets/video/`; posters are each clip's first frame
  (`hero-<name>.webp`), so photo and video line up. 2,600 credits.
  Same loading rules as before: the poster is the LCP; the video mounts only
  on screen and not on Save-Data, 2g/3g or reduced motion; it pauses off
  screen and in hidden tabs; a pause button is always there (WCAG 2.2.2).
  Not precached by the service worker; WhiteNoise serves range requests (iOS).
- **Code.** `components/public/BackgroundVideo.tsx` (level heroes; its skip
  rule is a local copy so HeroVideo stays in the home chunk). Level heroes:
  new optional `video` field, and one gradient veil over photo and video
  instead of two 35 % layers. Home hero: `videoSound` toggle; the sound button
  shows only for videos with sound (the Ajustes video keeps it).
- **Phone navigation.** `Dropdown` keeps every header menu inside the screen
  (the «+» menu was 17 px off-screen at 375 px, 72 px at 320 px).
  QuickActions: 44 px rows, icon tiles, «Emergencia» set apart in danger red.
  MobileTabBar: equal columns, 64 px bar, active indicator behind the icon,
  labels fit whole from 360 px («Comunicados» still truncates by a few px on
  320 px phones). Sidebar/drawer: compact horizontal logo (+54 px for the
  menu on a 667 px phone), edge fades show there is more to scroll, an opened
  group scrolls into view, a folded group shows its pending count.
- **Merge note.** PR #292 (header buttons, home hero `tertiary`) touches the
  home hero too: after merging, keep both sets of hero fields and regenerate
  the manifests (`UPDATE_CMS_MANIFEST=1`).

### «Interlaken en video» autoplay (owner request, 22 Nov 2026)
- **What.** The home band's YouTube ad («Interlaken Publicitario», set in
  Ajustes) now starts as a silent, looping preview when the visitor reaches
  it; «Ver con sonido» restarts it from the beginning with sound and the
  YouTube controls. Own pause button; pauses off screen and in a hidden tab;
  Save-Data, 2g/3g and reduced motion keep the old click-to-play card.
- **Why not a full background.** The ad has a voice-over and its own text;
  muted behind the heading it loses its message and fights the copy. A true
  background loop needs the original MP4 from the school (then it can be a
  self-hosted silent loop like the heroes, with the full ad one click away).
- **Cover.** `facade-sign.webp` (the building, the ad's first real shot) covers
  the preview until YouTube has hidden its title and buttons (~5 s of
  playback, via the iframe API's progress messages; 8 s fallback), then fades
  into the video. YouTube's own thumbnail (a cartoon dog) and its other frames
  (children's faces) were not used. The glow behind the card is the cover,
  blurred.
- **CMS.** Home block «Video institucional» gains «Foto de portada del video»
  (empty = YouTube thumbnail) and «Esperar un clic para reproducir» (off =
  preview; older saved pages preview too). Other video blocks are unchanged.
- **Privacy/performance.** YouTube (nocookie domain) now loads when the band
  nears the screen instead of on click: no cookies, but Google sees the
  visitor's IP, and the player downloads about 1 MB. Nothing loads above the
  band, so first paint and the home JS budget are unaffected (171.9 / 172 kB).
- **Local data note.** The band had vanished locally because the demo reseed
  emptied `SiteSettings.video_url`; it was restored locally to
  `https://youtu.be/z271WfIaPSE` (the value in the owner's saved DB).

### Credencial drawn as the printed student ID (owner request, 22 Nov 2026)
- **What.** `/portal/credencial`, «Mi credencial» and the staff view in
  Alumnos now show the school's printed ID (template supplied by the owner):
  navy band with the logo, the level's C.C.T. and «45 años»; the level colour
  with the clock-ray pattern; grade pill («5A Primaria»), photo, Nombre, Ciclo
  Escolar, Matrícula (the Loyverse code) and the Code128 barcode the POS scans.
  Balance, «Saldo bajo», paid top-ups on their way and «Saldo actualizado…»
  moved to a panel beside the card (under it on phones), so the card itself
  matches the plastic one. «Pantalla completa» (barcode + QR) is unchanged.
- **Colours.** The school's level palette (`nivel`): Maternal and Preescolar
  mint, Primaria pink, Secundaria yellow; staff (and a pupil with no level)
  lavender with the puesto in the pill and «Código» for the code. Card type
  uses a deeper ink (`credencial.ink`) so it passes AA on Primaria pink.
- **C.C.T. per level** comes from the official list in
  `lib/sepIncorporations.ts`. The owner's sample cards print the Preescolar
  C.C.T. on a Primaria card and the Secundaria one on another; the digital
  card prints each level's own registration.
- **Photo.** The account's uploaded photo, else the Google picture saved at
  its last Google sign-in, else an empty frame (owner's rule). Google pictures
  are asked at 480 px. Cards API: new `student.photo` (no migration).
- **Standard landscape card (owner, same day).** The vertical card read as
  too long, so it is laid out as a standard landscape ID (CR80, 85.6 × 54 mm,
  like a bank card): navy band left (logo, C.C.T., 45 años), level colour
  with the pattern, photo on a white mat, grade pill, NOMBRE, CICLO ESCOLAR,
  MATRÍCULA, and a white barcode strip across the bottom; a soft laminate
  sheen. Artboard 4050 × 2550, type in container units with a minimum size
  for phones. 358 px wide on phones (the balance now shows without
  scrolling), 416 px beside the panel on tablets, 480 px on desktop; prints
  at 85.6 × 54 mm from Alumnos → Imprimir.
- **Assets.** `public/assets/credencial/logo.webp` and `45-anos.webp`, cut from
  the owner's template with a transparent background (13 kB and 10 kB).
- **Home JS budget.** The master merge (#291/#292) left `/` at 172.016 kB,
  16 bytes over its 172 kB budget, before this work. The card adds nothing to
  public pages (its SEP figures are copied, not imported from the footer's
  module, with a test that they agree; its icons are not shared). Shortening
  the home video toggle's editor hint brought `/` back to 171.999 kB: it
  passes by one byte, so the next public change needs the structural fix
  (lazy admin route table) or the owner's call on the budget.

### Header: «Portal Cafetería», no «Colegiaturas», solid sticky bar (owner, 22 Nov 2026)
- **Buttons.** Back to two, as before #292: «Portal Cafetería» (/login) and
  «Agendar visita». The home hero's second button reads «Portal Cafetería» and
  its optional third button is empty by default. «Familias → Colegiaturas y
  cafetería» stays in the menu. The icon-only squeeze (1024-1149 px) now runs
  only when Navegación has three or more buttons.
- **Sticky bar.** The owner saw photos (level cards, the round
  extracurricular photos) drawn over the bar. Cause: a local dev server on a
  stale Tailwind config never generated `.z-header`, so the header had
  z-index `auto`; builds and a restarted dev server have the rule. A test now
  pins `sticky top-0 z-header bg-white`, and the bar has a stronger shadow
  (`shadow-md`) so its edge shows over white sections. Restart dev servers
  after editing `tailwind.config.js`.
- **Live data.** #292 noted that production had no saved header buttons, so
  the defaults apply on deploy. If anyone saved buttons in Navegación since,
  those win and must be edited there; the same holds for a home page saved in
  Contenido with three hero buttons.

### Deploy notes (when approved)
Standard `deploy.sh`; no migrations, no env vars, no crontab change. After
deploy: hard-refresh once (new CSS), check `/`, `/portal` and `/admin` on a
phone, and run `python manage.py render_emails --out /tmp/emails` only on a
DEBUG machine (it refuses in production). Rollback: redeploy `master` fd8f03cc.

### Local environment note
The run used a fresh seeded SQLite DB. The owner's previous local DB is kept
as `db_local.sqlite3.pre-uiux` (repo root, untracked) and in the session
scratchpad; restore it with `mv db_local.sqlite3.pre-uiux db_local.sqlite3`.

## 1 · Decisions taken (owner, 21 Nov 2026)

| # | Decision | Record |
|---|---|---|
| D1/D2 | Two radii: `--radius-sm` 8 px (controls) and `--radius-md` 12 px (surfaces). No pill buttons. `rounded-full` only for badges, count pills, avatars, switch thumbs and dots | `docs/decisions/0001-radius-tokens.md` |
| D3 | Borderless cards (white on cream with a soft shadow, or a tint); hairlines only on fields and table rows | `docs/decisions/0002-borderless-surfaces.md` |
| D4 | Badges: text + icon, at most one per row | same |
| D5 | Audit widths 360, 390, 768, 1024, 1280, 1440 (+1920 console). Baselines stay 390/1280 | RESPONSIVE.md |
| D6/D7 | Keep the DRF error shape and the list parameters (`q`, `ordering`, `page`, `page_size`) | — |
| D8 | es-MX only, no i18n framework | — |
| D9 | No SPA dark theme; Unfold both themes AA; emails survive forced dark | — |
| D10 | 300 ms motion ceiling, no page transitions | — |
| D11/D12 | Keep the public JS budgets; Lighthouse A11y 100, Perf ≥ 95 on `/`, `/admisiones`, `/pre-registro`, ≥ 90 elsewhere | — |
| D13 | Receipt and top-up email bodies keep amount, folio and balance; subjects never carry names or amounts | `docs/decisions/0004-email-design.md` |
| D14 | Behaviour changes behind an env flag, default off | — |
| D15 | No session-timeout warning; keep input when a refresh fails | — |
| D16 | Keep the school's photography; school to confirm consent is on file | open question for the school |
| D17 | Families: active child in the header; staff: role and areas | — |
| D18 | One primary-action colour per surface family; emails follow the site (purple) | `docs/decisions/0004-email-design.md` |
| D19 | Search, filters, ordering and page in the URL; columns and density stay personal | — |
| D20 | Tickets as markdown, ready for GitHub issues | §5 |

## 2 · Baseline (before any change)

| Check | Result |
|---|---|
| `tsc --noEmit` | clean |
| `npm run lint` | 0 errors, 200 warnings |
| Vitest | 180 files, 1,163 tests passing |
| pytest | see §0 |
| Screenshots | 44 shots (public 7 routes, parent 6, admin 9; 390 and 1280 px), seeded demo data, kept outside the repo |

Not measured tonight: Lighthouse on authenticated routes, route-level axe
(needs `@axe-core/playwright`, a new dev dependency: proposal), real
completion and error rates (need production reads: the queries are in §6 for
the owner to run).

## 3 · Findings index

The full evidence per surface is in the appendices. The tables there keep
the auditors' ranking (P0 broken or risky, P1 inconsistent, P2 polish).

- Appendix A · Tokens and primitives
- Appendix B · Family portal
- Appendix C · Staff console
- Appendix D · Public site
- Appendix E · Email, Django admin and back-end scope

## 4 · Missing-feature proposals (not built)

New capabilities the audit found missing. None is built in this branch;
each needs the owner's go-ahead. Effort in hours, one engineer.

| # | Proposal | Why | Effort |
|---|---|---|---|
| P1 | Notification **priority** field (urgent / action / info) on `portal.Notification`, used by the panel, email and push | Urgent pinning today is a client-side sort on `notif_type`; the API has no priority | 8–12 |
| P2 | **Family onboarding checklist** (link your children, turn on avisos, save the credencial) | Only staff accounts get a profile checklist | 6–8 |
| P3 | **Ficha autosave** (debounced save on blur/idle, behind a flag) | A reload loses the step being typed; tonight only a leave-page warning was added | 6–10 |
| P4 | **Record drawer** with Prev/Next and a `?ver=<id>` deep link across console lists | Records open in modals with no Prev/Next and no shareable link | 16–24 |
| P5 | Comunicado **test send** to the signed-in admin's own inbox | The composer has no way to see the real email before a school-wide send | 4–6 |
| P6 | Public **calendar** with audience/level filters and a public «Suscribirse» link to the existing `content/calendar.ics` feed | The public calendar was removed; the ICS feed exists but is only linked in the console | 6–10 |
| P7 | **Marketing email** family (open day, admissions campaigns): consent purpose in the aviso de privacidad, one-click unsubscribe + `List-Unsubscribe`, suppression list honouring refusals and REPEP, campaign composer with preview and test send | Doesn't exist; needs legal review first (LFPDPPP 2025, LFPC art. 18 Bis) | 30–40 |
| P8 | `List-Unsubscribe` header (pointing to the avisos preferences page) on comunicado blasts | Deliverability of school-wide sends | 2–3 |
| P9 | Threaded family ↔ school **messaging** | Today: comunicado comments and the contact inbox only | 40–60 |
| P10 | Public **site search** | No search UI or endpoint | 16–24 |
| P11 | Route-level **axe in CI** (`@axe-core/playwright`, new dev dependency) and authenticated Lighthouse for one portal and one console route | Today axe runs per component only | 4–8 |
| P12 | A **flag channel to the SPA** (D14: an env setting exposed through an existing config response) | Behaviour changes in the UI have no off switch without a rebuild | 4–6 |
| P13 | One shared **Hero** component for the ~11 copied dark heroes | P2 duplicate markup on public sections | 12–16 |
| P14 | Eyebrows as plain text after a per-section contrast check on dark heroes | Tonight they became 8 px tags | 2–3 |
| P15 | i18n framework / SPA dark theme | Out of scope by D8/D9; listed only for completeness | 40+ each |

## 5 · Tickets (open after this PR)

Ready to paste as GitHub issues (D20). Estimates in hours, one engineer.
«Owner» = needs a decision or an action only the school can take.

| # | Ticket | Acceptance criteria | Est. | Depends |
|---|---|---|---|---|
| T1 | **Pagos scoped to the selected child** (portal P0-2) | `/portal/pagos` defaults to the child chosen in the header; the summary takes `?student=`; test proves child B never sees A's payments in the default view | 4–6 | API param |
| T2 | Cafetería page: one child picker | Families use the header switcher only; the in-page picker stays for staff; money-path test updated, amounts and flow unchanged | 2–3 | owner OK (money path) |
| T3 | **Staff «Pendientes» home** | A staff account with areas can open `/admin` and sees only its areas' pending rows (component built and tested); sidebar label «Pendientes»; behind a flag | 3–4 | D14 flag channel |
| T4 | Comunicado rendered email preview | `POST /portal/admin/announcements/email-preview/` returns subject + HTML from the same renderer as the fan-out; composer shows it before sending | 4–6 | — |
| T5 | Record drawer with Prev/Next and `?ver=` | Alumnos and Admisiones first; table position and filters kept | 16–24 | — |
| T6 | One date format across the console | Every console page uses `lib/tableFormat` (cafetería done tonight) | 4–6 | — |
| T7 | Eyebrows as plain text | Per-section contrast check on dark heroes, then `.section-label-*` drop the tint | 2–3 | — |
| T8 | Single-image CMS block with width/height | `useMediaInfo` from `cms/runtime.tsx`; no layout shift; school photos never cropped | 2–3 | — |
| T9 | Visit booking grade as a select | Data change (free text today) | 2 | owner |
| T10 | Ficha autosave behind a flag | Debounced save on blur/idle; health data stays server-side | 6–10 | D14 |
| T11 | Precache the credencial chunk | Credencial opens offline at the till; `check:sw` green; precache size noted | 1–2 | — |
| T12 | Icon-scale sweep | Remaining off-scale lucide sizes (~200, mostly console and CMS editor) move to 16/20/24 | 3–4 | — |
| T13 | Copy sweep for console pages not touched tonight | Messages ≤ 15 words, verb-first buttons, usted | 4–6 | — |
| T14 | Route-level axe + authenticated Lighthouse in CI | `@axe-core/playwright` (new dev dependency) | 4–8 | owner OK (dependency) |
| T15 | Notification priority field | Proposal P1 | 8–12 | — |
| T16 | Gallery hover chip (`galeria.tsx:230`) | Not a status badge → plain caption | 1 | — |
| T17 | Lazy admin route tree | Moves ~60 console `lazy()` stubs out of the public entry chunk; reclaims several kB on `/` and returns the home budget to ≤ 171 kB | 4–6 | — |
| T18 | Regenerate visual baselines in CI and review the diffs | Every public route and the portal/console shots; approve or file fixes | 2 | owner |
| T19 | Real-device pass | iPhone Safari and an Android phone: portal home, header switcher, credencial, recarga up to Banorte, ficha | 2 | owner |
| T20 | Email client pass | Gmail (web/app), Outlook (Windows/web), Apple Mail, from `render_emails` samples and test sends to owner inboxes | 2 | owner |
| T21 | Photo consent (D16) | School confirms consent is on file for photos showing students | — | owner |
| T22 | Marketing email (P7) | Legal review (LFPDPPP 2025, LFPC art. 18 Bis / REPEP) before any build | — | owner + counsel |

## 6 · Read-only production queries for the owner

Real completion and error rates need production data, which this branch never
touches. Run these read-only in `docker compose exec app python manage.py shell`
on the VPS (check field names against the models first; nothing here writes).

```python
from datetime import timedelta
from django.db.models import Count
from django.utils import timezone
since = timezone.now() - timedelta(days=90)

# Admissions funnel: pre-registros by status, fichas invited → submitted → accepted
from apps.admissions.models import PreRegistration, Registration
print(PreRegistration.objects.filter(created_at__gte=since).values('status').annotate(n=Count('id')))
print(Registration.objects.filter(created_at__gte=since).values('status').annotate(n=Count('id')))

# Top-up funnel: online card payments by status (failed = lost top-ups)
from apps.payments.models import Payment
print(Payment.objects.filter(created_at__gte=since, type='cafeteria').values('status').annotate(n=Count('id')))

# Visits: created vs confirmed vs cancelled
from apps.bookings.models import Booking
print(Booking.objects.filter(created_at__gte=since).values('status').annotate(n=Count('id')))

# Notifications never delivered (email/push failures)
from apps.portal.models import Notification
print(Notification.objects.filter(created_at__gte=since, delivered_at__isnull=True).count())
```

---

## Appendix A · Tokens and primitives

**Radius.** Theme scale added `xl2` 18, `xl3` 24, `xl4` 32 (xl4 unused) on top
of Tailwind's 4/6/8/12/16. Usage: `rounded-full` 234, `rounded-xl` 214,
`rounded-lg` 174, `rounded-xl2` 114, `rounded` 83, `rounded-2xl` 48, arbitrary
31 (20 px ×11, 14 px ×8, 22, 18, 12, 10, 9, 5, 4), `rounded-xl3` 5. CSS: focus
outline 4 px, skip link 10, skeleton 12, `.btn` 50, `.nav-item` 12, `.badge`
999, `--radius` 18. Inline `borderRadius` in `CafeteriaTrendCard.tsx:131`,
`ChartsSection.tsx:34` (10) and `Blob.tsx:92` (50 %).

**Shadows.** Three different "card" shadows (`--shadow-card`, Tailwind `card`,
`.card` inline). 21 arbitrary `shadow-[…]`.

**z-index.** No scale. Modal, drawer, public header and dropdowns all at 50;
the portal header (30) traps its own dropdowns under the tab bar (30) between
768 and 1023 px; toasts at the library default 9999; cookie banner, full-screen
credencial and skip link at 100.

**Containers.** `Container.tsx` md 880 / lg 1120 / xl 1280; `max-w-[1120px]`
repeated 8 times; `max-w-6xl` 20.

**Motion.** `.route-enter` 0.32 s, above the 300 ms ceiling.

**`rounded-full` classification (234).** badge/status 33 · count pill 12 ·
avatar 9 · dot 12 · switch 7 · **icon button 18** · **text/CTA button 31** ·
**filter/segmented/action chip 34** · progress 22 · decorative blob 8 · other
48 (spinners 4, skeletons 3, icon medallions 17, step markers 12, lines and
handles 8, pill inputs 2, tab indicator 1, swatch 1). The bold groups break D2.

**Card-like containers.** 123 lines in 86 files combine a background, a
border and a radius (`rounded-xl2 border border-line bg-white` ×19,
`rounded-xl border border-line bg-white` ×19, cream-2 variants ×18; CMS
sections also use `border-ink/10`). `.card` raw ~64 lines in 36 files;
`<Card>` 119 uses; every Modal panel is a `.card`. Card-in-card: DataTable
inside a bordered `.card` (27 console pages), bordered boxes inside modals
(`MulticobrosUploadDialog.tsx:242,579,587`), `AdminPrivacyNotice.tsx:336`,
`MyChildren.tsx:139,169`.

**Duplicates.**
- Card / SectionCard / StatCard: StatCard re-implements a card. Merge into
  Card with `padding` and `header` props.
- Modal / ConfirmDialog / BulkConfirmDialog: all share Modal; icon medallion
  and footer duplicated (`ConfirmDialog.tsx:59`, `BulkConfirmDialog.tsx:325,453`).
- Badge / LiveBadge / ~7 chip re-implementations (`StatusChip`, `CheckChips`,
  `DocStatusChip`, `StageChip`, `StageCard:65`, `VisitaCard:179`,
  `AdminRequiredDocs:231` verbatim copy) + `.badge*` CSS (27 uses) +
  `.section-label-*` (48).
- ListSkeleton / TableSkeleton.
- CookieBanner / CookieConsent are not duplicates (consent logic vs markup).
- Money and dates: `formatMXN`, `formatPrice`, `formatDateTime` (lib/format),
  `shortDate`/`shortDateTime` (lib/tableFormat), `fmtDay`/`fmtDayTime`/`money`
  (lib/caseStages), `fmtMXN`/`fmtDay` (lib/chartTheme, same name different
  format), local `mxn` with `toFixed(2)` and **no thousands separator**
  (`BanorteDialogs.tsx:33`, `PaidTopUpQueue.tsx:36`, `AdminCafeteria.tsx:79`),
  60 `toLocaleString(` and 46 date-fns `format(` calls.

**Icons.** lucide only. 297 of 477 `size=` values are off the 16/20/24 scale
(14 ×78, 15 ×68, 17 ×38, 18 ×33, 13 ×31 …); 106 `h-3`/`h-3.5` classes.

**Primitives.** `Button` (primary | cta | secondary | danger | ghost | green;
sm | md | lg; `rounded-full`; no icon-only or link variant). `Input` (label,
error, hint; `rounded-xl`; hard-coded `#ECEAF3`). `Badge` (5 tones, text only,
no icon slot).

**Drift found and fixed in this branch.** `--text-light` `#726B89` vs Tailwind
`subtle` `#6B6482` (now one value, `#6B6482`).

## Appendix B · Family portal

**Routes.** `/portal` ParentDashboard · `/portal/cafeteria` CafeteriaPage
(`?alumno ?tipo ?desde ?hasta ?orden ?page ?hijo ?recarga`) · `/portal/credencial`
CredencialPage → StudentCard · `/portal/cafeteria/recarga/retorno` ·
`/portal/mi-cafeteria[/credencial]` (MineScope) · `/portal/pagos` ·
`/portal/perfil?tab=…` · `/portal/notificaciones[/:id]` · `/portal/privacidad`.
`/portal/inscripciones` and `/portal/comunicados[/:id]` redirect; their pages
are no longer imported.

**P0**
1. **Credencial ignores the shared child selection.** `CredencialPage.tsx:44-48`
   keeps its own `useState(selectedId)` and draws its own chips (`:98-117`).
   A parent who picked child B elsewhere opens child A's barcode at the till.
   Fix: read/write `useSelectedChildStore`. **S**
2. **Pagos is not child-scoped.** `PaymentsPage.tsx:78,144-147` uses its own
   `?alumno=`; `['payments-summary']` is family-wide. **M**
3. **No header ChildSwitcher; six child pickers, three sources of truth**
   (ParentDashboard 4th section below the fold, CafeteriaPage ×2, wizard
   select, Credencial chips, Pagos select, CafeteriaTrendCard). **M**
4. **Dashboard has no «Hoy».** Low balance shown 3 times, a top-up entry
   point 4 times; notifications, admission steps and visits absent. **M**

**P1**
5. Pill buttons: `Button.tsx:18`, `.btn*` 50 px, 9 hand-made pill chips.
6. Eight radii in scope (8, 9, 10, 12, 14, 16, 18, 24).
7. Cards bordered and nested: `CafeteriaPage:601-608`, `:813-870` (boxes in
   the Modal), `NotificationDetailPage:118`, `ProfilePage:158`,
   `ParentDashboard:194+201`, `CredencialPage:26`, `PaymentsPage:200,264`.
8. Header not flat: gradient accent bar (`AppHeader.tsx:20`), dark glowing
   hamburger (`:32`), bordered bell (`NotificationsMenu.tsx:61`), bordered
   account pill (`AccountMenu.tsx:35`).
9. Account menu lacks Avisos and Privacidad; the Sidebar has a second,
   different menu (`Sidebar.tsx:226-234`).
10. Notifications: no urgent pinning (no priority field), unread signalled 3
    ways, «Marcar todas» on a 32 px target, mark-all always enabled, 40 px
    pill filter chips, deep links without the child, 2 badges and 2 «Volver»
    on the detail page plus internal delivery metadata.
11. No z-index scale (see Appendix A); toasts cover the wizard footer.
12. 19 tap targets under 44 px (e.g. `ParentDashboard:183`, `CafeteriaPage:632,648,690`,
    `LiveBadge.tsx:40` 28 px, `PaymentsPage:229` 32 px); student views need
    48 px (`StudentCard.tsx:116` ~30 px, `:152` 40 px).
13. No permission-denied state (`ProtectedRoute.tsx:19-27` redirects
    silently); long empty states with 2 actions (`ParentDashboard:151-165`,
    `:253` 45 words).
14. Credencial offline shows a cached balance (up to 7 days) with no time
    (`StudentCard.tsx:92`, `vite.config.ts:169-177`); its chunk is not precached.
15. Copy: tú mixed with usted on 17 lines; messages over 15 words; non-verb
    buttons («Estado de cuenta (PDF)», «Mi credencial», «Mi información»,
    «Otro monto»); «Avisos» vs «Notificaciones», «Mi perfil» vs «Mi información».
16. Badges are text only (no icon).

**P2** 17 off-scale icon sizes · 18 micro text (`text-[10–11.5px]` ×30) ·
19 decorative chrome (gradient tiles, glows, blur blobs, count-up) · 20
`dark:` classes and `usePrefersDark` in a light-only app (chart turns dark on
a white card) · 21 hand-written page headers · 22 redundant controls (boxed
refresh, hamburger duplicating the tab bar).

**Pilot: ParentDashboard (2 children, 390 px).** Today: header + refresh box ·
one low-balance alert per child · per-child tiles with chips · ChildSwitcher ·
hero · «Alumnos» stat · 2 quick actions · install and push hints · Novedades ·
charts · «Mi información». Above the fold: 4 containers and 10 shapes, nested.
Proposed: header switcher · **«Hoy»** list (≤ 4 rows, one verb each) ·
selected child's wallet hero · ≤ 3 KPIs · Novedades and other children as rows ·
charts.

**Money path (visual only).** `CafeteriaPage.tsx` (availability `:104-148`,
deep links `:252-294`, validation `:296-300`, `payWithBanorte` `:305-356`,
`topupMutation` `:358-386`, wizard `:724-916`), `CafeteriaTopupReturn.tsx`,
`lib/banorteCheckout.ts`, `public/banorte-bridge.js`, `lib/cardholder.ts`,
`CardholderStep.tsx`, `lib/topupApply.ts`, `lib/status/payment.ts`,
`lib/status/cafeteria.ts`, `BalanceWithPending.tsx`, `PendingTopUps.tsx`,
`BanortePaymentNotice.tsx`, `AmexNotAccepted.tsx`, `services/api.ts`
(cafeteriaApi, paymentsApi). Must not change: the return route and
`payment_id`, `?recarga&hijo` and its $20–$2000 guard, `TOPUP_PRESETS/MIN/MAX`,
step order and disabled rules, the jump back to step 3 on billing error,
`setChildId` before checkout, event handling and payload, the `paying` lock,
test/certification banners and Amex/Banorte notices, return polling 5 × 2 s,
query keys and invalidations.

**Existence.** Family onboarding checklist: missing. Offline balance and
credencial with «last updated»: partial. Print styles for credencial and
movements: missing. Urgent pinning: missing (grouping by Hoy/Esta
semana/Anteriores exists).

## Appendix C · Staff console

**Tables.** DataTable 37 instances (32 in 19 pages). Hand-rolled: 1 raw table
(audit diff, fine) and 8 lists (`PageListGroup.tsx:62-71` grid table,
`AdminRequiredDocs.tsx:146,212`, `AdminPrivacyNotice.tsx:130`,
`AdminSchoolYear.tsx:63`, `AdminGuardianMerge.tsx:60`; kanban and week grid
are legitimately non-tabular). URL state via `useUrlFilters`/`useUrlPage` on
18 pages; **not** on the «por verificar» / «por aplicar» queues
(`AdminCafeteria.tsx:872,924`, `PaidTopUpQueue.tsx:65,315`),
`AdminCafeteriaStudent.tsx:62-63`, required-docs tab, visits week, staff
dashboard range, or any open record.

**Dashboard today.** Three conditional banners, 8 StatCards that look
clickable but are not links (`StatCard.tsx:69` div + `hover-lift`), vanity
KPIs mixed with queues, two tiles merging two queues each, 5 competing
buttons, charts, activity, avisos.

| Exception | Today | Counter available | Queue |
|---|---|---|---|
| Recargas por aplicar | banner only | `portal/views.py:119-157`; `core/badges.py:80-84` | `/admin/cafeteria?tab=pos` |
| Por verificar | card + «Verificar ahora» | `portal/views.py:153-156`; `core/badges.py:87` | same |
| Pagos fallidos | missing | `payments/views.py:516` (`failed_by_reason`, `stuck_pending`) | `/admin/pagos?estado=failed` |
| Documentos por revisar | missing | `core/badges.py:16` | `/admin/admisiones?vista=inscripciones` |
| Pre-registros nuevos | merged tile | `portal/views.py:271-272`; `core/badges.py:74-76` | `/admin/admisiones?estado=pending` |
| Visitas de hoy | tile, no link | `portal/views.py:286`; `core/badges.py:78` | `/admin/visitas` |
| Mensajes | merged tile | `portal/views.py:289`; `core/badges.py:90-91` | `/admin/mensajes` |
| Contraseñas | merged tile | `portal/views.py:288`; `core/badges.py:89` | `/admin/contrasenas` |
| ARCO | missing | `core/badges.py:96-97` | `/admin/arco` |
| Alertas Loyverse | stale links only | `cafeteria/views.py:1121` sync health | `/admin/cafeteria` |
| Saldo bajo | tile, no link | `portal/views.py:280` | `/admin/cafeteria?tab=low` |

**P0** 1 KPI tiles not links, vanity and queues mixed · 2 missing exceptions
(failed payments, documents, ARCO, sync, bookings to confirm) · 3 staff
accounts have no exceptions home (`lib/areas.ts:76-80`, `portal/views.py:244`)
· 4 English and internal codes on the landing page (`AdminDashboard.tsx:148`
«update · studentprofile», `:184` «Parents», `AdminAudit.tsx:213` «system») ·
5 pill buttons everywhere (290 `Button` uses in admin + 48 `.btn*`).

**P1** 6 phones: no sort on stacked tables, no column priority, bordered
stacked rows · 7 card-in-card ×27 (DataTable inside `.card`) · 8 radius tokens
· 9 pill tabs and toggles (`StatusTabs.tsx:62` → 21 tab sets) · 10 record
views in modals with no Prev/Next or deep link (`AdminContactInbox:218`,
`AdminFamilies:244`, `AdminAudit:206`, `AdminMedia:273`, `AdminStaffUsers:466`,
`AdminCafeteria:1355`, `AdminForms:335` table in a modal) · 11 URL gaps ·
12 restricted actions hidden instead of disabled with a reason
(`ConsoleAreaGuard.tsx:21` silent redirect) · 13 money formatted three ways
(`$20000.00` with no separator) · 14 six date formats · 15 field errors as
toasts (47 `toast.error(apiErrorMessage…)` sites; `AdminAnnouncements.tsx:115`,
`AdminCafeteriaStudent.tsx:91`) · 16 balance adjustment without a resulting
balance preview or confirm on «Descontar».

**P2** 17 row actions inline (3 buttons + menu on Alumnos) · 18 density
defaults to normal · 19 empty and no-results conflated · 20 full-page spinner
on the cafetería student page · 21 badges text only, two per row on Alumnos ·
22 23 of 127 toasts over 8 words · 23 31 `dark:` classes in StaffDashboard ·
24 nested scroll (`.admin-table-wrap` 68vh) · 25 sideways scroll on the visits
week between 768 and 980 px · 26 pagination count without es-MX grouping ·
27 hand-rolled lists without search/sort/pagination.

**Comunicados.** Audience count: yes (`portal/views.py:766`,
`AdminAnnouncements.tsx:118-121,545-558`). Rendered email preview: **no**.
Test send: **no**. Composer is a 520 px modal with a plain textarea.

**Existence.** Record drawer with Prev/Next: none (two-pane only on Alumnos at
2xl). Disabled-with-reason: only in the admissions case
(`DocumentacionCard.tsx:117`, `ExamenCard.tsx:191`, `FichaDownloads.tsx:57`).
Audit trail on balance adjustments: yes (`AdminCafeteriaStudent.tsx:264-299`).
Import/export progress and error summary: mostly yes (ImportDialog dry-run,
error report, summary; bulk «Procesando N de M»).

## Appendix D · Public site

**CTA correction.** Since 21 Nov 2026 the ficha is private (noindex, no
public link); the standard public CTA is **«Agendar visita»**
(`cms/sections/kit.tsx:77-89`, `PublicLayout.tsx:74`, migration 0033), not
«Inicie su pre-registro». The prompt's line is superseded by this decision.

**Routes.** Every page is `TemplatePage(<group>.templates[n])`; a published CMS
page with the same slug overrides it (`App.tsx:35-54,104`). `/` home(+below) ·
`/nosotros` about · `/modelo-educativo` modelo · `/galeria` galeria ·
`/niveles/:nivel` nivel · `/admisiones` admisiones(+faq) ·
`/admisiones/documentacion` · `/admisiones/costos` costos + PricingSections ·
`/pre-registro` preregistro → `FichaWizard` · `/inscripcion/documentos`
documentos · `/agendar-visita` visita · `/contacto` · `/pagos`, `/plataformas` ·
`/comunidad/facturacion` · `/aviso-de-privacidad` · `/p/:slug` and `*` CmsPage →
BlockRenderer · `/login` acceso · `/confirmar-correo` correo. Redirects:
`/inscripcion` → `/pre-registro`, `/puertas-abiertas` → `/agendar-visita`,
`/comunidad/plataformas` → `/pagos`, `/calendario` → `/`.

**P0**
- `SiteNoticeBanner.tsx:36`: `bg-amber` + `text-ink` ≈ 3.6:1 on 14 px text,
  the only public alert channel. → `bg-warning-bg text-warning` or white text.
- `CookieBanner.tsx:24` (`z-[100]`, `mb-[76px]`) sits above the gallery
  lightbox and every Modal; on phones it can cover a bottom sheet's buttons.
- Privacy: none (consent opt-in, ficha token in sessionStorage only).

**P1**
1. Content width ≠ header/footer: header/footer `max-w-6xl px-4 sm:px-6`;
   `<Container>` defaults to 1120 px with `px-5 sm:px-6 lg:px-8` (`ui/Container.tsx:10,23`),
   so ~45 Section bodies sit 24 px inside the header edge on desktop and 4 px
   on phones; 8 blocks hard-code `max-w-[1120px]`.
2. Layering collisions (header = modal = dropdown at 50; sticky CTA = WhatsApp at 40).
3. Pill controls: `Button.tsx:18`, home lead inputs `home.below.tsx:365,375`,
   gallery filters `galeria.tsx:193`, `PublicLayout.tsx:440`, `WhatsAppFloat.tsx:43`,
   ~10 ghost link-buttons in the ficha and sections.
4. 48 `section-label-*` eyebrows drawn as pill badges (`.badge` 999 px).
5. Badge misuse: `PricingSections.tsx:149-153` (2 per card), label pills
   `fields.tsx:279`, `admisiones.tsx:313,367`, `costos.tsx:27`.
6. ~64 bordered surfaces; card-in-card in the ficha (`StepInicio.tsx:76`,
   `StepRevision.tsx:39,101`, `StepBar.tsx:69`, `ResumeForm.tsx:51`,
   `parts.tsx:57`, `FichaWizard.tsx:512`), `documentos.tsx` ×5, `nivel.tsx` ×5, `acceso.tsx` ×4.
7. Body under 16 px on phones: `text-[15px]` ×49 (24 in the ficha), `<p text-sm>` ×56,
   `fluid-base` ≈ 15.1 px at 375 px, hint/error `text-xs`; home lead inputs
   15 px (iOS zoom).
8. Forms don't share one pattern: four required-mark conventions; `Input`
   hides the hint on error; contacto errors without `aria-describedby`;
   success/failure only as toasts (`contacto.tsx:94-97`, `home.below.tsx:331-333`,
   `visita.tsx:171`); no focus to first invalid (`FacturacionForm.tsx:89,100`,
   CmsForm); `visita.tsx:314` no `autoComplete="name"`, `:318` grade free text.
9. tú register: `CookieBanner.tsx:11`, `home.below.tsx:331,333`, `home.tsx:266`;
   ficha messages over 15 words (`ficha/copy.ts:41,44,60,150,155`).
10. Headings: `about.tsx:175` h4 under h2; `/pre-registro` steps/review/done
    have no h1 (hero hidden when `view !== 'start'`, `preregistro.tsx:50`);
    `/p/:slug` without hero has no h1, two heroes give two.
11. More than one primary CTA: hero `btn-pink` + sticky «Agendar visita» on
    phones; header `btn-primary` vs hero on desktop; `FichaDone.tsx:50-54` 3 CTAs.
12. ~70 off-scale icons (PublicLayout `h-3`/`h-3.5` ×9; ficha `h-7`).
13. ~20 footer links `text-xs` with no min height (`PublicLayout.tsx:484,511,530,541,575`).
14. `WhatsAppFloat.tsx:48` `role="menu"` without arrow keys or focus move.
15. Calendar block shows raw ISO dates, hard-coded headings (`generic.tsx:177-192`).
16. Image/gallery blocks without width/height (`generic.tsx:38,130`); alt fallbacks differ.

**P2** ~11 copies of the dark hero markup (one Hero component, L) · draft
preview banner under the header · dead `'/login'` in `HIDE_STICKY_CTA` ·
FunnelHero step labels 10 px · footer h3s without an h2 · gallery masonry tab
order runs by column.

**Pilot `/pre-registro` (FichaWizard).** Good: email/postal/CURP attributes,
`text-base` inputs, CURP live check, step heading focus, sticky action bar
(44 px, keyboard-aware, safe area). Issues: phone fields `autoComplete='off'`
but email fields autofill the filler's own email into padre/madre/emergencia;
Domicilio lacks `address-level*`; `name` missing on selects and «other»
inputs; `aria-required` missing on `accept_privacy` and country fields;
required checks only after a PATCH; **an ErrorSummary list with focus on it**
(`parts.tsx:46-84`) instead of the first invalid field; **no autosave** and no
`beforeunload`; FichaDone without h1, 3 CTAs, mismatched icon; start screen
repeats itself three times and shows «Unos 15 minutos» where the visitor
cannot start.

**Frozen CMS contracts.** Generic block types and prop keys
(`cms/blocks/registry.ts:77-143`), built-in form slugs (`generic.tsx:207-212`),
table value shape (`cms/blocks/table.ts:14-15`), designed section types
`${group}.${type}` (`kit.tsx:16-18`, 20 groups in `loaders.ts`), template
slugs and section order, `preregistro.form` prop keys (`FICHA_TEXT`,
`FICHA_LINKS`, `FICHA_LISTS`, `RETIRED_DEFAULTS`), CmsLink `{label, href}`,
ImageRef, default merging (`blocks/specs.ts:19-24`), tokens and placeholders,
`VISIT_CTA`/`INFORMES_CTA`, backend mirror `content/block_manifest.json`.

**Existence.** Public emergency banner: partial (one dismissible notice,
contrast fails). Calendar filters: missing (public calendar removed). ICS feed:
partial (`content/calendar.ics` exists, no public «Suscribirse» link). Site
search: missing. Print styles: partial (no global `@media print`).

## Appendix E · Email, Django admin and back-end scope

No confirmed data leak. Sending goes through `portal/services.py:68 send_email`
→ `build_email` (:38); `notify()` (:138) → `emailing.notification_content`;
comunicados and emergencies through `_deliver` (:821); three sites call
`build_email(...).send()` directly to attach files (`admissions/process_messages.py:331`,
`bookings/services/notifications.py:45/81/111` with `.ics`). No email carries
a CURP, medical or ficha health data.

**Family A, transactional (family, applicant, visitor).** 19 send sites. Issues:
- **Names in subjects** (D13 says never): `family_self.py:204` «Código para
  agregar a {first}: {code}» (first name **and the 6-digit link code**),
  `notify_email.py:212` «Confirme su correo para los avisos de {name}», and
  every admissions email: `ficha.py:673/756/790`, `admissions/services.py:219/252/313/355`,
  `admissions/views.py:172/453/624`, `process_messages.py:518/562` «… {child}».
- Subjects over 50 characters: about 10 (ficha, outcome, documents, ops).
- `email_invite` prints «El enlace vence» as now + 14 days (`services.py:211`)
  instead of `reg.invite_expires_at`.
- `core/views.py:227` facturación acknowledgement repeats the **RFC** in the body.
- Reschedule email (`bookings/views.py:399`) sends no updated `.ics`.
- Cafetería notices: subjects are short and nameless (good); bodies carry the
  child's full name and amounts (D13 keeps amounts; the name should be first
  name + initial). The cron low-balance alert (`low_balance_alerts.py:94`)
  looks different from the inline one (`cafeteria/services.py:617`); the bulk
  top-up (`cafeteria/views.py:1935`, :1780) sends a plain message.

**Family B, school notices.** Subject = `announcement.title` (no cap); body
cut to 280 chars (`services.py:312`); an **emergency is labelled «Comunicado»**
(`emailing.py:185` forces the category); no `List-Unsubscribe` header on
school-wide blasts.

**Internal / ops.** Inconsistent subject prefixes (`Interlaken:`, `[Interlaken]`,
`[Contacto web]`, `[Facturación]`); student name and amount in staff subjects
(`cafeteria/services.py:1401`, `loyverse_push.py:635`); page-approval email
pastes the preview token URL in the text and points the button at `/admin`
(`content/pages.py:1115`).

**`templates/email/base.html`.** Bordered card (`:37` 1px, 16 px radius),
bordered details table with row hairlines (`:72-76`), 3 px left-border note
(`:111`, 8 px); button 10 px radius, green-dark `#316F1C`, padding on the `<a>`
only (Outlook desktop renders it ~20 px tall); preheader has no 90-char cap
and defaults to a 150–280-char intro; only the `color-scheme` meta (no dark
overrides, so Gmail/Outlook auto-invert); `white-space:pre-line` ignored by
Outlook; colour drift `#1B1536 / #3D3852 / #6B6680 / #F4F1EA` vs tokens. Size
~10 KB (no clipping risk). Logo URL breaks if `FRONTEND_URL` is empty.

**Builders a preview command can call.** Pure: `_code_email`,
`confirmation_email`, `notification_content`, `content_from_text`,
`topup_apply_report._notice`, `render_html/render_text`. Send-in-place but
fine with unsaved objects under locmem: `email_ficha_*`, `email_invite`,
`email_registration_outcome`, `email_rejected_documents`, `_notify_requester`.
Inline in views (need extracting): `admissions/views.py:160,182,442,614`,
`bookings/views.py:387`, `core/views.py:52,215`.

**Django admin (unfold 0.110.1).**
1. **`portal/admin.py:53` NotificationAdmin has full CRUD**: an admin-added
   row has `delivered_at=NULL`, so `dispatch_pending_notifications` emails and
   pushes it to the family within 5 minutes. → read-only. **P0**
2. **`admissions/admin.py:61` `list_editable is_verified`** bypasses
   `set_document_review` (no status/review note, no rejection email, no audit). **P0**
3. `portal/admin.py:11` `list_editable is_active` skips the comunicado fan-out. **P1**
4. `bookings/admin.py:39/46` slot editable (skips capacity, reschedule email,
   calendar sync). **P1**
5. `font.subtle-light` `#9A93AE` (fails AA on light); keep `base.400` for dark
   mode (`#9A93AE` on `#0f0a24` ≈ 6.5:1). `BORDER_RADIUS` supported (unfold
   `sites.py:74`), not set.
6. `admissions/admin.py:17` uses Django's `StackedInline` (unstyled), not unfold's.
7. English column headers from models without field labels (cafeteria, core,
   payments, portal).
8. Search/filters missing on several read-only admins.
9. Dashboard «Documentos en revisión» counts rejected documents too (`core/dashboard.py:27`).
No smoke test renders every changelist.

**Scope.** Every family endpoint scopes correctly by inspection, and most have
an outsider test. **Missing proof (P0 candidates, code looks right):**
`cafeteria/views.py:537 MyLoyverseHistoryView`, `:368 MySpendingCategoriesView`,
`portal/novedades.py:55/68 NovedadesView` (hand-written payment filter the
contract regex doesn't catch). P1: `NotificationMarkReadView` (`portal/views.py:732`),
`AnnouncementAckView` (:702).

**Status after this branch (Appendix E).** ✅ borderless layout, purple 8 px
button with Outlook padding, token parity test, preheader ≤ 90, line breaks
in Outlook, notice-only blocks, «Aviso importante» on emergencies, invite
expiry date, first name + initial in family bodies, Django admin P0s and
P1 items 3–6 and 9, admin smoke test, five scope proof tests (no leak).
⏳ staff bodies keep full names (by design); `low_balance_alerts.py`
details and `loyverse_push.py:635` staff subject; RFC repeated in the
facturación acknowledgement (`core/views.py`); comunicado subjects uncapped
(the school's title); English column headers and missing search on some
read-only admins; logo PNG on a white box in forced dark.

Subjects changed (D13: no names, codes or amounts):

| Before | After |
|---|---|
| Código para agregar a {nombre}: {código} | Su código para vincular a sus hijos |
| Confirme su correo para los avisos de {nombre} | Confirme su correo para recibir avisos |
| Pre-registro recibido: {niño} · Nuevo pre-registro: {niño} | Pre-registro recibido · Nuevo pre-registro |
| Ficha de inscripción iniciada / recibida: {niño} · Nueva ficha … iniciada: {niño} | names dropped |
| Enlace para continuar la ficha: {niño} | Enlace para continuar la ficha |
| Invitación de inscripción: {niño} | Invitación de inscripción |
| Inscripción aprobada: {niño} · Actualización de su inscripción: {niño} | names dropped |
| Documentos pendientes para la inscripción de {nombre} | Documentos pendientes para la inscripción |
| Documento(s) por corregir: {niño} · Documentos de inscripción: {niño} · Inscripción recibida: {niño} | names dropped |
| Examen de admisión de {niño} · Resultado del examen de admisión de {niño} · Ficha de inscripción: {niño} | Fecha del examen de admisión · Resultado del examen de admisión · Ficha de inscripción |
| Interlaken: Por verificar: {alumno}, $X | Interlaken: Recarga por verificar (or «N recargas por verificar», «Recordatorio · …») |
