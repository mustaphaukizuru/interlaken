# Safe publishing: old drafts, conflicts, SEO, image sizes, visual guard

Date: 2026-11-20. Branch `feat/cms-safe-publish`, on top of `feat/cms-v2`
([CMS-COMPLETION-PLAN.md](../CMS-COMPLETION-PLAN.md) §8).

The phase-1 audit of the designed-section CMS found five ways an office
admin could break a public page without noticing:

| # | Problem | Fix |
|---|---|---|
| 1 | Nine drafts left in production by the old `seed_cms` (admisiones, contacto, costos, documentacion, galeria, inicio, modelo-educativo, nosotros, plataformas) look like normal drafts; publishing one replaces the designed page with plain generic blocks. | `cms_adopt_seed_drafts` puts them back to «Diseño original»; any path that would publish an old generic draft now asks for an explicit confirmation (C1). |
| 2 | Their SEO titles already said «· Colegio Interlaken», so the site showed the name twice, and they hid the template's own title («Costos» with the school year, the home brand title). | The site name is appended once; blank SEO falls back to the template's; loading the design drops the seed SEO. |
| 3 | A library photo 1600 px wide or less has no `lg` size, so `/media/<id>/lg/` answered 404 and heroes showed a broken image. | Missing sizes serve the next larger one or the original; pages request only sizes that exist. |
| 4 | The pre-publish check warned «Falta la descripción SEO» on pages whose design already has one. | Checks count the template's SEO; a page published from its design passes with zero issues; messages name section and field. |
| 5 | Two people editing one page: the last autosave silently won. | Draft revisions; a stale save gets 409 (C2). |

## What changes for the office (step by step)

1. **After the deploy, nothing looks different on the site.** The public pages
   render exactly as before (checked pixel by pixel, see «Visual guard»).
2. **Contenido → Páginas del sitio.** Once `cms_adopt_seed_drafts --apply`
   has run, the nine old drafts are gone: those pages show «Diseño original»
   and «Personalizar», like every page nobody customised. «Personalizar»
   creates the draft from today's design.
3. **A draft still in the old format** (only if someone edited one by hand,
   listed as «revisar a mano» by the command): the editor keeps its yellow
   banner. «Cargar el diseño actual» swaps the old blocks for the design and
   now also clears the old SEO title and description, so the page gets its
   real title back. «Diseño original» does the same.
4. **Publishing such a draft as it is** asks for a confirmation (the console
   shows the server's message: the page would stop looking like today's
   design). The same happens when staff request approval for it. Bulk
   «Publicar» skips it, and a scheduled publication never publishes it.
5. **Two people on the same page**: once the console sends the draft revision
   (the «shell» branch), the second save gets «X guardó cambios en esta página
   mientras usted la editaba» instead of silently erasing the other's work.
6. **«Revisar»** (pre-publish checks) no longer warns about a missing SEO
   description on designed pages, and every message says which section (its
   number and name in the list) and which field to fix, for example
   «Sección 2 (Costos · Precios), campo «Enlaces › elemento 1 › Enlace»: ...».
7. **Photos from the library** of any size now show in heroes and large slots.

## C1: old generic drafts (backend contract)

- `legacy_seed: boolean` on the page list and detail
  (`GET /content/admin/pages/`, `GET /content/admin/pages/<id>/`). True when
  the slug has a designed template (`template_manifest.json`), the draft has
  blocks and none of them is a designed section (no `.` in the type), and the
  site does not already show a generic version of it (a page live with generic
  blocks is not degraded further by republishing).
- `POST /content/admin/pages/<id>/publish/` on such a page without
  `{"confirm_legacy": true}` → **409**
  `{"code": "legacy_seed_draft", "detail": "<Spanish sentence>"}`. With the
  flag it publishes (pre-publish checks still apply) and the audit record of
  the publish carries `legacy_seed_confirmed: true`.
- `POST /content/admin/pages/<id>/review/ {"action": "request"}` (staff ask
  for approval): same 409 without `confirm_legacy`; with it, the request goes
  through and Dirección's notice says the draft is in the old format.
  Approving is publishing, which asks again.
- Bulk publish (`/content/admin/pages/bulk/`): the row is skipped with
  «borrador antiguo con bloques genéricos: publíquelo desde el editor para
  confirmar».
- `cms_schedule`: never publishes it; it stays overdue in the editor and the
  cron logs a warning (counted as «bloqueadas por revisión»).

The 409 bodies always carry `detail`, so the editor's existing error toast is
the fallback until the «shell» branch adds the dialog.

## C2: draft conflicts (backend contract)

Migration `content.0028_page_draft_revision` adds to `Page`:

| Field | Meaning |
|---|---|
| `draft_revision` | integer, +1 on every draft save: create (1), every PATCH/PUT of the page, restoring a version into the draft. Existing pages start at 0. |
| `draft_updated_by` | in the API: the display name (`full_name`) of who saved last, `''` when unknown. |
| `draft_updated_at` | when; backfilled from `updated_at` for existing pages. |

`PATCH /content/admin/pages/<id>/` with `draft_revision` different from the
stored one → **409**
`{"code": "draft_conflict", "draft_revision": n, "draft_updated_by": "...", "draft_updated_at": "...", "detail": "<Spanish sentence>"}`
and nothing is written. The row is locked (`select_for_update`) from the
check to the write, so two saves of the same revision cannot both win. A save
without `draft_revision` behaves exactly as before (last write wins) and
still bumps the revision; a non-integer value is a 400.

Also on the page serializer: `seed_seo`, the SEO fields that still hold the
old seed values (`{}` normally). The editor uses it to clear them when it
loads the design.

## `cms_adopt_seed_drafts`

```sh
python manage.py cms_adopt_seed_drafts            # simulation, prints the table
python manage.py cms_adopt_seed_drafts --apply    # does it
```

It lists every page of a designed template whose draft is in the old generic
format and decides:

- **Se eliminará / Eliminado: vuelve a «Diseño original»** when the page was
  never published (no versions), is not waiting for approval, has no
  scheduled publish or unpublish, and its title, blocks and SEO are exactly
  what one of the `seed_cms` versions wrote. The versions differ in two
  places (git history of `seed_cms.py`): the home buttons pointed to
  `/pre-registro` until 58e8e11 and to `/agendar-visita` after; the nosotros
  timeline was empty until 7a404c4. Image slots match no image, a deleted
  asset, or an asset with the file name the seed imported. Block ids,
  `hidden: false` and empty values are ignored; anything else differing is an
  edit.
- **Revisar a mano (no se toca)** otherwise, with the reason (which block
  changed, «el SEO cambió», «se publicó alguna vez»...).

**Why delete instead of reset.** The console shows «Diseño original /
Personalizar» exactly when no `Page` row exists for the slug, and the design
lives in the frontend templates, not in the database, so the backend cannot
write a designed draft. An unedited, never-published seed row holds nothing a
person wrote. Deleting it is what the console handles naturally:
«Personalizar» recreates the draft from today's design when someone wants to
edit. The seed SEO goes with the row.

**Safety.** Dry run by default. Each deletion runs in its own transaction,
re-checks the page under a row lock (a page edited while the command runs is
«Omitido: cambió durante la ejecución») and writes one audit record
(`content.page`, action `delete`, context `cms.adopt_seed_drafts`, actor
`system:cms_adopt_seed_drafts`) whose `changes` hold the whole deleted row:
slug, title, status, SEO and blocks. Idempotent: a second run finds nothing.

Recovering one page (never needed so far): read the audit row in Django admin
(Auditoría) or with
`AuditLog.objects.filter(context='cms.adopt_seed_drafts', object_id='<id>')`,
then recreate it with `Page.objects.create(slug=..., title=..., draft_blocks=changes['draft_blocks'][0], seo=changes['seo'][0])`.

### Production

```sh
# on the VPS
cd /opt/interlaken/deploy
docker compose exec -T app python manage.py cms_adopt_seed_drafts
# read the table; if it is right:
docker compose exec -T app python manage.py cms_adopt_seed_drafts --apply
docker compose exec -T app python manage.py cms_adopt_seed_drafts   # check: «Nada que hacer»
```

Expected for the nine untouched production drafts: nine rows «Se eliminará:
vuelve a «Diseño original»», «Resumen: 9 se eliminarían, 0 para revisar a
mano.», then with `--apply` nine «Eliminado» rows and «Resumen: 9 eliminados
(un registro de auditoría cada uno), 0 para revisar a mano.». Any row marked
«Revisar a mano» is a draft someone touched: open it in Contenido and use
«Cargar el diseño actual».

## SEO

- `Seo.tsx` and the server-rendered head (`apps/core/spa.py`) append
  « · Colegio Interlaken» only when the title does not already name the school.
- `template_manifest.json` (generated with `block_manifest.json`, see below)
  gives the backend each designed page's SEO as the site shows it when the CMS
  sets none: the template's own, else the route defaults (`ROUTE_META`).
  Years that roll over are tokens (`{{ciclo}}`, `{{anios}}`) expanded by
  `apps/content/page_templates.py`.
- A published designed page with blank SEO gets that template SEO in the
  server-rendered head (social previews), as the browser does.
- `TemplatePage`: when the CMS overrides some SEO fields (a share image only,
  say), the blank ones keep the route defaults instead of the generic site title.
- «Cargar el diseño actual» / «Diseño original» drop the fields listed in the
  page's `seed_seo` (`cms/seedSeo.ts`); SEO the school wrote stays.

## Image sizes

`build_variants` creates `thumb` (320) always, `md` (960) only for photos
wider than 960 px, `lg` (1600) only for photos wider than 1600 px.

- `GET /content/media/<id>/<variant>/` serves the variant, else the next
  larger existing one, else the original (`media.served_variant`), with the
  same `Cache-Control: public, max-age=31536000, immutable`; the ETag names
  the file actually served. Unknown variant names and missing assets stay 404.
- Public page payloads (`media`) list each image's `variants`;
  `CmsMediaProvider` remembers them and `cms/media.ts` builds URLs and srcset
  from what exists, with real widths (an 800 px photo:
  `thumb 320w, original 800w`). Without that information (editor picker, old
  payloads) the full set is requested and the server falls back.

## Pre-publish checks (`apps/content/checks.py`)

- The SEO description warning only fires when neither the page nor its
  template has one; length warnings only count what the school typed.
- New warning `seed_seo` when the SEO still holds the old seed values, with
  how to recover the design's.
- Messages: «Sección N (label in the editor's list), campo «Field»: what is
  wrong and what to do». Field names come from a small Spanish map
  (`FIELD_LABELS`); nested fields read «Enlaces › elemento 2 › Enlace».
- Verified on the phase-1 database with every template published from the
  design: zero issues on all of them (and the e2e guard asserts it on every run).

## Visual guard (`frontend/e2e/public-pages.spec.ts`)

Every designed public page (read from `template_manifest.json`) plus the 404
page, full height, at 390 and 1280 px, fixed clock (2026-08-10 10:00), reduced
motion, animations off, fonts and images awaited, a fresh page per width, the
video setting off. Two states:

1. **defaults**: every `GET /content/pages/<slug>/` answers 404, so the
   templates render;
2. **published from the design**: the spec builds each template's draft with
   the app's own code (`originalBlocks`, served by Vite), creates it through
   the admin API like «Personalizar», asserts `legacy_seed` is false and the
   pre-publish checks return no issue, publishes it, and shoots again. The
   pages are deleted afterwards.

Assertions: the published shot equals the defaults shot of the same run
(anti-aliasing tolerance: at most 2,000 pixels with a channel moved by more
than 48), always, on any platform; and each shot matches the committed
baseline `public-pages.spec.ts-snapshots/<slug>-<width>-chromium-<platform>.png`
(`maxDiffPixels` 2,000). Without a baseline for the platform that comparison
is skipped and annotated (`no-baseline`), so the spec passes cleanly until
they are committed. Baselines are written only from the defaults state.

### Producing the linux baselines (do this once after merging)

Linux baselines are rendered by CI, never on Windows (fonts and anti-aliasing
differ). The `e2e` job does it by itself while none are committed:

1. Push the branch (or merge); the E2E job runs.
2. Step «Render missing public-page baselines (for review)» renders them and
   «Upload public-page baselines» publishes the artifact
   **`public-pages-baselines-linux`** (kept 14 days).
3. Download it from the run page (or `gh run download <run-id> -n public-pages-baselines-linux -D frontend/e2e/public-pages.spec.ts-snapshots`),
   look through the PNGs, commit only the `*-chromium-linux.png` files into
   `frontend/e2e/public-pages.spec.ts-snapshots/`.
4. From the next run on, the comparison with the baselines is blocking.

After an intentional design change, the job fails on the public pages; the
existing «Regenerate linux visual baselines» step now regenerates both visual
specs and the `visual-baselines-linux` artifact holds
`visual.spec.ts-snapshots/` and `public-pages.spec.ts-snapshots/`.

Locally (Windows) the spec runs with the published-vs-defaults check only;
`npx playwright test public-pages.spec.ts --grep "defaults" --update-snapshots=missing`
writes local `*-win32.png` baselines for your own comparisons (do not commit
them as linux ones). The published state needs a database without CMS pages
for the designed slugs (it skips otherwise, as CI's fresh database never does).

## Manifests

`UPDATE_CMS_MANIFEST=1 npx vitest run src/cms/manifest.test.ts` (from
`frontend/`) regenerates both `block_manifest.json` and
`template_manifest.json`; the test fails when either drifts.
