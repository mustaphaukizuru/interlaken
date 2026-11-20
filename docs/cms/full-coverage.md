# CMS full coverage: every visible text editable

Date: 2026-11-20. Branch `feat/cms-full-coverage` (on `feat/cms-v2`, PR #257).
Follows [../CMS-COMPLETION-PLAN.md](../CMS-COMPLETION-PLAN.md).

The owner asked that everything on the public site be editable by the office,
not by a developer. After this branch, every visible text on every public page
and every site-wide element is edited in the console. The only exceptions are
the logo (a brand asset) and real data, which already has its own screen
(contact data in Ajustes, prices, visit slots, testimonials, admissions).

## 1. What changed

### Locked form sections: every word is copy

Labels, placeholders (the example inside a field), help texts, buttons, the
text while sending, success and error messages, validation messages, empty
states and counters are section fields with today's text as defaults:

| Section | New editable texts |
|---|---|
| Inicio · Solicite informes | field labels, «Enviando…», both pop-up messages, the privacy line and its link, the message that reaches Mensajes (`{nombre}`) |
| Pre-registro · Formulario | both block titles and subtitles, every label and example, «Seleccionar…», the «¿Cómo se enteró?» answers, the visit checkbox, six validation messages, the age hint (`{grado}`, `{edad}`, `{anio}`, `{tiene}`) |
| Contacto · Información y formulario | labels, examples, «Enviando…», four validation messages; Directorio: the word «Ext» |
| Agendar visita · Calendario y reserva | form labels, three validation messages, the booking error, the calendar weekday abbreviations |
| Facturación · Solicitud | every label, example and help text, the regime placeholder, the button, five error messages, the confirmation (`{correo}`, `{facturas}`) |
| Galería · Fotos con filtros | the counter words, «Ampliar», the position under the enlarged photo (`{n} / {total}`), the screen-reader labels of the filters, photos and lightbox buttons |
| Admisiones · Preguntas frecuentes | search placeholder and label, «Filtrar por tema», «Todas», the counter (`{n} de {total}`), the no-results text and link |
| Aviso de privacidad · Texto oficial | the text shown when the notice cannot load |

Fields, validation rules, grade lists, visit slots, the SAT regime list and
how each form submits stay in code. Validation messages are looked up by key
(the schema names the prop), so rewording a message never touches a rule.
Sections with many texts set `group` on their fields (`kit.inGroup`); the
«fields» branch renders those as collapsible groups.

### App screens are CMS pages

| Route | Contenido page | How |
|---|---|---|
| `/login` | Iniciar sesión (`iniciar-sesion`) | one locked section `acceso.screen`: panel photo, title, stats, every label, link and error message (all eleven Google sign-in errors) |
| `/inscripcion` | Inscripción (`inscripcion`) | hero section + locked wizard `inscripcion.wizard`: the three steps, every label, document names, consent checkboxes, messages, invitation states, confirmation |
| `/inscripcion/documentos` | Documentos de inscripción (`inscripcion-documentos`) | one locked section: heading, instructions, statuses, buttons, messages, the expired-link text and address |
| `/confirmar-correo` | Confirmar correo (`confirmar-correo`) | one locked section: every state (ready, done, expired, replaced, invalid, loading, error) |

Each route renders its template through `TemplatePage`, so SEO (title,
description, share image, «No indexar») is edited like any other page and the
server writes it into the HTML head (`SLUG_PATHS` maps the slugs; none of the
four is ever in the sitemap). The logic is unchanged and lives in the locked
section: password and TOTP sign-in, the Google return (`?login=ok`), the
deep-link return, old «correo para avisos» links, the single-use invitation
and document links, the e-mail confirmation. Inside the editor preview
(`cms/preview.tsx`, set by `EditableBlocks`) these sections show a sample
state and never sign in, redirect or spend a token.

These four templates set `paintAtOnce`: they never wait for the CMS. The
built-in copy paints at once and the school's published edits replace it
when they arrive (same block ids, so the screen does not remount and typed
text stays). Every other page still holds its first paint until it knows
whether a published version exists. A prefetch that already answered renders
on the first pass, and a CMS request that does not answer within 8 s counts
as «no published page». The single-use invitation and document tokens are
exchanged once per tab (`lib/inviteExchange.ts`), even if a section remounts.

Measured on a production build with the CMS request intercepted (form visible
after navigation start, median ms; numbers move ±50 ms on a shared machine):

| CMS answer | master (no CMS on /login) | before `paintAtOnce` | this branch |
|---|---|---|---|
| normal | 137 | 171 | 126 |
| delayed 3 s | 172 | 3452 | 166 |
| HTTP 500 | 159 | 157 | 167 |
| network error | 157 | 186 | 177 |
| never answers | 166 | never (> 15 s) | 161 |

The safe-publish backend knows the four pages: they are in
`template_manifest.json` (generated by `manifest.test.ts`), so
`page_templates`, `legacy_seed` and `cms_adopt_seed_drafts` treat them as
designed pages, and the visual guard `e2e/public-pages.spec.ts` shoots them
(their Linux baselines come from CI like the others). Published from the
design they have `legacy_seed` false and no pre-publish issues.

### Site texts in Navegación

Navegación has a new card, «Textos del sitio» (`components/admin/SiteTextsEditor.tsx`),
stored in `SiteSettings.chrome` next to the header and footer copy (no
migration). Each text shows its current value; a text equal to the original
is not stored, so the site keeps following the built-in copy, and
«Restablecer» puts the original back per text or per group.

| Group | Keys |
|---|---|
| Aviso de cookies | `cookie_text`, `cookie_link`, `cookie_decline`, `cookie_accept` (consent behaviour unchanged) |
| Mensajes de WhatsApp | `wa_admissions`, `wa_visit`, `wa_float`, `wa_password`, `wa_estimator` (`{{ciclo}}`, `{seccion}`) |
| Burbuja de contacto y menú | `float_whatsapp`, `float_visit`, `float_password`, `nav_contact`, `skip_link` |
| Pie de página | `footer_contact`, `legal_links` (up to 4 links in the bottom bar) |
| Aviso de privacidad en formularios | `privacy_note`, `privacy_link` |
| Pasos de admisión | `funnel_1` to `funnel_4`, `funnel_now`, `funnel_done`, `funnel_next` |
| Página sin conexión | `offline_title`, `offline_accent`, `offline_text`, `offline_retry`, `offline_home` |

The header/footer form and this card each save only their own keys
(`lib/chromeMerge.ts`). The backend validates every key and length
(`navigation.SITE_TEXTS`).

**Offline page.** `public/offline.html` is precached by the service worker at
build time and is shown when there is no network, so it cannot fetch the
school's copy. The site stores the edited `offline_*` texts in localStorage
whenever it loads the settings (`lib/offlineCopy.ts`), and `public/offline.js`
(same origin, precached, allowed by `script-src 'self'`) swaps them in as
plain text. With nothing stored the page keeps its built-in text, so it is
safe: a phone gets the new text the next time it opens the site online.

### Privacy notice console

Console «Aviso de privacidad» (`/admin/aviso-privacidad`, menu Contenido del
sitio, next to Navegación and Medios; admin only, listed in `ADMIN_ONLY`).

- The current version with how many consents and registrations it holds;
  every version as Vigente, Borrador or Anterior.
- «Nueva versión» copies the current text into a draft (nothing changes on
  the site).
- The draft is edited part by part: the text before the first part, then
  each part (title and text). The editor writes the text exactly in the
  format the page reads (part titles in capitals, a blank line between
  paragraphs) and flags what the page would read differently (a title with
  fewer than 15 letters, a paragraph in capitals, fewer than three parts).
- «Vista previa» renders the draft with the public page's own components
  and copy (`AvisoHero`, `AvisoNoticeBody`).
- «Publicar» asks for a confirmation that explains what happens: the site
  shows the new text, the portal asks every family to accept it, existing
  consents stay tied to the version they accepted, the text becomes read-only.
- Published versions open read-only; drafts can be discarded.

Backend (`apps/legal/notices.py`): list, create draft, edit draft, discard
draft, publish. Publishing deactivates the previous version and activates
the draft, exactly as the data migrations that published 2026.1 and 2026.3
did. Consent rows are never touched (a test compares every row before and
after). Re-consent is the existing rule (`services.needs_acceptance`).
Every change writes an AuditLog row (`legal.notice.draft`,
`legal.notice.publish`). Migration `legal.0008` adds `published_at`, so a
retired version nobody accepted stays frozen (Django admin uses the same rule).

### Admission documents: one list

The list is edited once, in Documentación («Documentos requeridos» section).
Admisiones («Documentos y pre-registro») no longer has its own copy: it shows
the list of the published Documentación page, or the built-in list while
that page is not published (`useAdmissionDocs` in `lib/admisionesDocs.ts`).
Both looks are unchanged; each page keeps its own title, summary and note.

### Testimonials photo: skipped

The public testimonial card (`components/public/Testimonials.tsx`) has a
quote mark, the quote, the author and the role. It has no place for a photo
or avatar, so no photo field was added.

### SEO of routes without a CMS page

Every route that used `ROUTE_META` without a CMS page now has one
(`/inscripcion` was the last). `ROUTE_META` stays as the default each page
shows until the school writes its own SEO in the page editor.

## 2. Coverage table

### Public routes

| Route | Edited in |
|---|---|
| `/` | Contenido → Inicio (every section, including the lead form texts) |
| `/nosotros` | Contenido → Quiénes somos |
| `/modelo-educativo` | Contenido → Modelo educativo |
| `/galeria` | Contenido → Galería (photos, filters, counter, «Ampliar», lightbox) |
| `/niveles/preescolar`, `/primaria`, `/secundaria` | Contenido → Preescolar, Primaria, Secundaria; SEP registrations: Ajustes |
| `/niveles/<other>` | redirects to Preescolar (code, no content) |
| `/admisiones` | Contenido → Admisiones; document list: Documentación; testimonials: Testimonios; estimator figures: the price list |
| `/admisiones/costos` | Contenido → Costos (texts); figures: the price list (Django admin today; the «tables» branch owns it) |
| `/admisiones/documentacion` | Contenido → Documentación (the one document list) |
| `/pre-registro` | Contenido → Pre-registro (hero, trust strip, every form text) |
| `/inscripcion` | Contenido → Inscripción |
| `/inscripcion/documentos` | Contenido → Documentos de inscripción; required documents: Admisiones |
| `/agendar-visita` | Contenido → Agendar visita; open slots: Visitas |
| `/contacto` | Contenido → Contacto; phone, e-mail, hours, address, WhatsApp, Maps link: Ajustes |
| `/pagos` | Contenido → Pagos |
| `/plataformas` | Contenido → Plataformas |
| `/comunidad/facturacion` | Contenido → Facturación |
| `/aviso-de-privacidad` | Contenido → Aviso de privacidad (hero, summary cards); the legal text: Aviso de privacidad (console) |
| 404 | Contenido → Página no encontrada |
| `/login` | Contenido → Iniciar sesión |
| `/confirmar-correo` | Contenido → Confirmar correo |
| `/p/<slug>`, `/<slug>` | Contenido → the custom page |
| `/puertas-abiertas`, `/calendario`, `/comunidad/plataformas` | redirects in code (no content); more redirects: Navegación → Redirecciones |

### Site elements

| Element | Edited in |
|---|---|
| Header menu, footer link columns, mobile menu | Navegación → Menú del sitio |
| Header buttons, footer tagline, copyright, legal note, mobile «Agendar visita» bar | Navegación → Encabezado, pie de página y barra móvil |
| «Contacto» menu link, footer contact heading, footer legal links, skip link | Navegación → Textos del sitio |
| Cookie banner | Navegación → Textos del sitio → Aviso de cookies |
| Prefilled WhatsApp messages | Navegación → Textos del sitio → Mensajes de WhatsApp (contact page and visit page messages: their sections) |
| WhatsApp bubble menu | Navegación → Textos del sitio → Burbuja de contacto y menú |
| Privacy line under forms | Navegación → Textos del sitio (home lead form: its section) |
| Admission steps in the form heroes | Navegación → Textos del sitio → Pasos de admisión |
| Offline page | Navegación → Textos del sitio → Página sin conexión |
| Phone, e-mail, address, hours, WhatsApp number, Maps link, videos, social links, SEP registrations | Ajustes |
| SEO title, description, share image, «No indexar» per page | Contenido → the page → SEO |
| Photos | Biblioteca de medios (chosen in each section) |
| Testimonials | Testimonios |
| Privacy notice text | Aviso de privacidad |
| Notice banner above the header | Comunicados («Publicar en el sitio») |
| Logo | developer only (brand asset) |

## 3. Left in code, and why

- **The logo** (brand asset, `components/ui/Logo.tsx`).
- **Data formats**: month and weekday names in dates come from the Spanish
  locale (`date-fns`, `toLocaleDateString`), the «h» after a time, the «✓» of
  a finished step. They format data, they are not copy.
- **Browser messages**: the home lead form uses the browser's own required
  and e-mail checks, so their bubbles are worded by the browser.
- **Messages written by the server**: when the server explains a refusal
  (a visit slot taken, a fiscal field rejected, a link already used) the
  site shows that message as it comes.
- **A few screen-reader labels of shared chrome** (menu button, calendar
  month arrows, the logo link): interface wording that never shows on
  screen.
- **The family portal and e-mails** are not public pages and are out of
  this scope.

## 4. For developers

- New site text: add the key to `SiteTextKey` (`lib/siteChrome.ts`),
  `SITE_TEXTS` (`backend/apps/content/navigation.py`) and a field in
  `SITE_TEXT_GROUPS` (`SiteTextsEditor.tsx`); the component keeps its own
  built-in text and reads it with `useSiteTexts(DEFAULTS)` or `siteTexts`.
- New form text: a field with today's text as default in the section, read
  with `t(p.key)`; validation messages are schema keys mapped to props.
- Regenerate the manifest after changing section fields:
  `UPDATE_CMS_MANIFEST=1 npx vitest run src/cms/manifest.test.ts`.
