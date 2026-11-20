# CMS completion: every public page editable

Date: 2026-10-20. Follows [CMS-PLAN.md](CMS-PLAN.md) and BACKLOG P3-1 to P3-14.

## 1. Status found (audit)

The CMS plumbing is built and tested: media library with WebP variants, `Page`/`PageVersion`
with draft, publish, unpublish, rollback, version diff, approval workflow (staff request,
Dirección publishes), scheduled publish/unpublish, pre-publish checks, signed preview links,
forms builder + inbox, menu editor, redirects, dynamic sitemap.

**But in production 0 of 9 seeded pages are published** (`GET /api/v1/content/pages/<slug>/`
returns 404 for all of them) and every public URL still renders hard-coded TSX. The school can
edit only Ajustes (contact data, hero video, SEP), the menu, testimonials, the calendar and the
price list. Root causes:

| # | Gap | Effect |
|---|---|---|
| G1 | A published CMS page **replaces** the designed TSX page with 18 generic blocks (plain hero, plain cards, plain stats). The real sections (video hero with logo and gradient headline, coloured stat icons, level cards with photos, programs, promos, strengths, gallery strip, lead form, timeline, nivel layouts) have no block equivalent. | Publishing any page visibly downgrades it, so nothing gets published. Effectively the site is not editable. |
| G2 | 9 public pages have no CMS hook at all: Nivel x3, Calendario, Agendar visita, Pre-registro, Facturación, Pagos, Aviso de privacidad, 404. | Their copy and photos need a deploy to change. |
| G3 | Footer, top contact bar, mobile "Agendar visita" bar and footer legal line are hard-coded in `PublicLayout`. | Site-wide text not editable. |
| G4 | No "hide" (only delete), no "reset to original design", no item reorder inside lists, no icon or colour choice. | Editors cannot hide a section for a season or undo safely. |
| G5 | Image fields accept only media-library ids. | The current static photos (`/assets/*.webp`) cannot be shown as defaults, so a ported page starts without its photos. |
| G6 | `timeline` block ignores its own items (always renders the built-in timeline); `form` block has no editable field in the editor; `open_school_events` exists in the backend but is missing from the editor's block list. | Broken generic blocks. |
| G7 | `CmsOverride` and the whole generic renderer are imported statically by `App.tsx`, so they ship in the entry chunk of every public page. | Avoidable bundle weight. |
| G8 | `seed_cms` writes a Python copy of the page text that has already drifted from the TSX. | Two sources of truth for the same copy. |

## 2. Decision: designed sections as blocks

Each public page is split into its **real sections**. Each section becomes a block type
(`home.hero`, `home.levels`, `nivel.groups`, `site.footer`, ...) whose React component **is the
existing designed markup**, with every text, image, list, link, icon and colour exposed as a
prop. The current hard-coded content becomes the section's **defaults**, and the page's default
block list is its **template**.

- No published CMS page: the template renders, pixel-identical to today. Zero-risk rollout.
- Editor opens a page: the draft starts as the template, so the school edits the real page.
- Published page: the same components render the edited props. The design never degrades.
- Props merge over defaults key by key, so a section added in a later release still gets
  sensible values on pages published before it existed.

Designed sections and the 18 generic blocks live in one registry, so editors can reorder,
hide, duplicate and delete sections and insert generic blocks (text, gallery, FAQ, video,
form, ...) between them on any page.

Single source of truth: the frontend registry. A generated manifest
(`backend/apps/content/block_manifest.json`) gives the backend the list of valid types and
their required props; a Vitest test fails CI if the manifest is stale.

## 3. Scope: every public URL

| URL | Slug | Sections (editable) |
|---|---|---|
| `/` | `inicio` | hero (video, poster, headline, subtitle, 2 buttons), stats, levels, programs, promos, strengths, video, gallery strip, testimonials, lead form |
| `/nosotros` | `nosotros` | hero, history, mission/vision/values, timeline, photos, CTA |
| `/modelo-educativo` | `modelo-educativo` | hero, pillars, program details, CTA |
| `/galeria` | `galeria` | hero, filterable photo grid (photo, caption, category) |
| `/niveles/preescolar`, `/primaria`, `/secundaria` | `preescolar`, `primaria`, `secundaria` | hero (title, headline, intro), the school's text by parts (subtitle, paragraphs with **bold**, program cards, closing quote), photo, groups, extras, SEP, side links (one template per level) |
| `/admisiones` | `admisiones` | every Admisiones section |
| `/admisiones/costos` | `costos` | hero, price tables (data from Costos), disclaimer |
| `/admisiones/documentacion` | `documentacion` | hero, document lists |
| `/pre-registro` | `pre-registro` | hero/intro copy; the form is a locked section |
| `/agendar-visita` | `agendar-visita` | hero/intro copy; the booking widget is a locked section |
| `/contacto` | `contacto` | hero, contact cards, form (locked), map |
| `/pagos` | `pagos` | hero, payment cards |
| `/plataformas` | `plataformas` | hero, platform cards |
| `/comunidad/facturacion` | `facturacion` | hero, steps; CFDI form (locked) |
| `/aviso-de-privacidad` | `aviso-de-privacidad` | hero copy; legal text stays versioned in `legal` (locked) |
| 404 | `no-encontrada` | message and buttons |
| Header bar, footer, mobile CTA | `sitio` | top bar, footer columns and legal line, mobile CTA |

Locked sections carry application logic (forms with validation, booking, legal consent
versions). They can be moved, not deleted or hidden, so the page never loses its purpose.

Out of scope on purpose: `/inscripcion` and `/inscripcion/documentos` (invitation-token
wizards, not public information), `/pago/simulado` (sandbox), portal pages.

## 4. Editor features added

- Page list shows **every** public page, including those never customised ("Diseño original");
  "Personalizar" creates the draft from the template.
- Per section: hide/show (eye), duplicate, delete (unless locked), reset to original.
- Per page: "Restablecer diseño original" (replaces the draft, versions untouched).
- Banner on old generic drafts (from `seed_cms`) offering to load the current design.
- Field kinds: `select`, `toggle`, `icon`, `color`; image fields accept library images or the
  current site photos; list items reorder up/down; gallery fields add many photos at once.
- Preview renders inside the public motion provider, so sections look exactly as on the site.
- Tokens in any text: `{{ciclo}}`, `{{anios}}`, `{{telefono}}`, `{{correo}}`, `{{direccion}}`,
  `{{horario}}`, `{{whatsapp}}`.

## 5. Backend changes

- `pages.py` loads the manifest: designed section types validated alongside generic ones;
  draft size cap; hidden blocks stripped from the public payload.
- `checks.py`: string (site-asset) images are valid; hidden blocks skipped; link and image
  checks walk nested lists generically.
- `navigation.py` `SLUG_PATHS`: new slugs mapped (`preescolar` to `/niveles/preescolar`, ...);
  `sitio` and `no-encontrada` never appear in the sitemap.
- `seed_cms`: keeps the media import, stops writing page copy (templates replace it).

## 6. Rollout

1. Merge and deploy: nothing visible changes (templates = today's site).
2. Dirección opens Contenido, sees all pages, edits and publishes one at a time.
3. After a page has been published and validated, its old TSX fallback is already gone: the
   template *is* the page, so there is nothing left to delete.

## 7. Status (2026-10-20): built

- 19 templates (all public URLs above) in `frontend/src/cms/sections/*.tsx`, rendered by
  `cms/TemplatePage.tsx`; 6 locked sections (Contacto form, Agendar visita booking,
  Pre-registro form, Facturación request, Calendario events, Aviso legal text).
- Shared section `page.hero`; site chrome (`SiteSettings.chrome`, migration 0027) edited
  in Navegación.
- Backend: `block_manifest.json` (regenerate with
  `UPDATE_CMS_MANIFEST=1 npx vitest run src/cms/manifest.test.ts`), hidden blocks stripped
  from public payloads, library alt text served with the page (`media`), checks and the
  media in-use guard follow the manifest image paths, public page responses revalidate
  (`no-cache` + ETag) so a publish shows immediately.
- Verified: full-page screenshots of all 19 URLs at 390 and 1280 px identical to master;
  end-to-end personalise, edit, hide, publish, see it live, reset to original, republish.
- Entry chunk 118.4 kB to 96.6 kB (the generic renderer no longer ships with every page).

### Added after the first pass

- Editor: undo/redo (buttons and Ctrl+Z / Ctrl+Shift+Z; one step per field edit),
  copy a section and paste it on any page («Copiar» / «Pegar», works across tabs),
  a warning before leaving with an unsaved draft, and the selected section scrolls
  into view (preview click opens its form, list click shows it in the preview).
- SEO: a share image per page (WhatsApp/Facebook) from the media library, the
  current titles shown as placeholders, and «No indexar» now emits `robots noindex`.
- Server-rendered head (`apps/core/spa.py`): for a route with a published CMS page,
  Django writes the page's SEO title, description and share image into the HTML
  (social crawlers never run the app) and skips the static first-paint shell,
  which mirrors the built-in hero and would flash the old headline.
- Testimonios sections: label, title and how many to show are editable.
- Pre-publish check warns when the share image was deleted from the library.

Kept in code on purpose at this stage: form field labels and validation messages, the FAQ
search and filter controls, the gallery counter and «Ampliar» label, the calendar level
filter, and the official privacy-notice text. All of these became editable afterwards:
see [cms/full-coverage.md](cms/full-coverage.md) (2026-11-20).

### How the school edits a page

1. Contenido (`/admin/contenido`): «Páginas del sitio» lists every public page.
2. «Personalizar» (first time) or «Editar»: the editor opens with the page as it looks today.
3. Click a section in the preview or the list; edit texts, photos, lists and buttons on the
   left. Eye icon hides a section, the bin deletes it, «Agregar» inserts any section or
   generic block, drag to reorder. «Restablecer» undoes one section, «Diseño original» the
   whole draft.
4. «Publicar» (Dirección) or «Solicitar aprobación» (staff). Versions keep every publish.

### Adding a section or page (developers)

Add a spec + component in the page's module (`cms/sections/<group>.tsx`), or a new module
plus one line in `cms/sections/index.ts`, then regenerate the manifest. Defaults must be
today's copy so the template stays pixel-identical.

## 8. Port onto master (2026-11-20, branch feat/cms-v2)

The branch was merged into master 29cbdbc (177 commits newer). Master wins as
behaviour; its later public copy now lives in the section defaults:

- `/calendario` left the public site (owner, 2026-11-08): the `calendario`
  template and `CalendarioPage` are gone, the route still redirects home, and
  the generic «Calendario» block no longer links to it. 18 templates remain.
- Niveles: the owner's own text per level (lib/levelStories.ts) is the
  `nivel.content` story (one item per part: subtitle, paragraphs separated by a
  blank line with `**negritas**`, program cards, closing quote; photo after
  part n). The hero gained the headline line. `LevelStory.tsx` was folded in.
- Facturación: the «Su solicitud llega a facturas@…» line is off by default
  (empty «Texto antes del correo»). Pre-registro: the portal note is gone and
  the visit hint reads «le daremos el enlace». Contacto: master's side padding.
- Costos: master's reserved height for loading/error/empty and the always-on
  reference note, with the editable copy. TemplatePage's loading placeholder
  fills the screen (CLS fix, e2e/layout-shift.spec.ts).
- Footer: `{{anio}}` stays a token in `SiteSettings.chrome` (Navegación no
  longer saves the current year as fixed text).

Bundle budgets (scripts/check-budgets.mjs): the generic blocks
(`cms/blocks/generic.tsx`), the editor preview (`cms/editor/EditableBlocks.tsx`),
the table of every section group (`cms/sections/loaders.ts`) and the full icon
set (`cms/icons.ts`, now loaded on demand through `cms/iconRuntime.tsx`) are
off the public pages: `/` 167.3 kB (master 170.4), `/admisiones` 148.9 kB
(148.7), `/admisiones/costos` 139.8 kB (139.8).
