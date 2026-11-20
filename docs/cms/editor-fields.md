# CMS editor fields

Date: 2026-11-20. Branch `feat/cms-editor-fields`, on top of `feat/cms-v2`
(see [CMS-COMPLETION-PLAN.md](../CMS-COMPLETION-PLAN.md)). This round makes
every input of the section form usable by office staff who do not know
markdown, URLs, icon names, slugs or HTML. Stored values never change shape:
published pages render exactly as before.

## What the office can do now

1. **See problems while editing.** A red box above the editor, «Antes de
   publicar, corrija N campos», lists every field that would block publishing:
   empty required fields, photos without a description (alt text) or deleted
   from the library, and links that cannot work. Each line jumps to its field,
   opens its group and list item, and puts the cursor there.
2. **Errors next to the field.** A field shows its problem when you leave it,
   and from then on the message updates as you type. Errors returned by the
   server (save, «Publicar», «Revisar») show at their field too, in Spanish,
   with the section and field names, until that field is edited.
3. **Long sections in parts.** Costos (price tables), Nivel (text of the
   level), Agendar visita, Contacto and Admisiones (documents and pre-registro
   call) open as named groups: «Inscripción · 5 de 5», with the number of
   required fields filled and a red badge when something needs fixing. The
   browser remembers which groups you left open.
4. **Links by page name.** «Elegir destino» opens a list of the site's pages
   (and the pages made in Contenido, and sections such as «Admisiones ·
   Estimador de costos»). Other tabs: Sitio web, Correo, Teléfono, WhatsApp
   (number plus an optional message already written). The field shows the
   destination's name, and warns when a page does not exist or is a draft.
5. **Icons by picture.** A grid with Spanish names («Birrete», «Moneda»,
   «Personas») and a search box: «pago» finds «Moneda». Same picker in
   Navegación for the menu.
6. **Colours by swatch.** Brand green and coral first, then the other site
   colours and the level colours. «Personalizado» accepts any colour and warns
   when it would be hard to read on white.
7. **Formatted text without codes.** The generic «Texto» block is a small
   word processor (negritas, cursiva, subtítulo, listas, enlace). The Nivel
   text and the Pagos/Plataformas notes keep their `**negritas**` and
   `[texto](/ruta)` format, but a toolbar writes it and a preview shows the
   result.
8. **Photos uploaded right there.** «Elegir o subir» or «Subir», or drag a
   photo onto the field: progress bar, the same limits as Medios (JPG, PNG,
   WebP or GIF, 10 MB). The description is asked for right away, saved in the
   library. The field shows the size and warns when the photo is too small for
   its place (1600 px for covers, 1200 px for gallery and text photos, 800 px
   elsewhere).
9. **Forms by name.** The generic «Formulario» block offers the site's forms
   and the ones made in Formularios (unpublished ones flagged).
10. **Gallery filters without keys.** A filter is its button text; the key is
    derived from it under «Avanzado» («todas» never changes). Each photo picks
    its filter from a list, and follows a renamed filter.
11. **Data that updates itself.** While a text field has focus, chips insert
    «Ciclo escolar · 2026-2027», «Años del colegio · 45», «Año en curso · 2026»
    (and, under «Más datos», phone, e-mail, address, hours, WhatsApp, year of
    foundation). Texts with data show «Se verá así: …».
12. **Help under every field**, in plain Spanish.

## Contracts

### C3: structured errors

Backend (`apps/content/pages.py`, `checks.py`):

| Where | Response |
|---|---|
| Save (`POST`/`PATCH /content/admin/pages/…` with invalid `draft_blocks`) | 400 `{detail, draft_blocks: {blocks: [detail]}, errors: [...]}` (answered before the serializer; `draft_blocks` keeps its old shape) |
| Publish (`POST …/publish/`) blocked by checks | 400 `{detail, issues, errors: [...]}` |
| Checks (`GET …/checks/`) | each issue located in a section also has `block_index`, `block_label`, `field`, `field_label`, `field_message` |

Each `errors` entry: `{block_index, block_id, block_label, field, field_label, message}`.
`field` is a path such as `title`, `items.2.title` or `photos.0.image`; a
link's `href` is reported on its link field (`cta`). `field_label` reads
«Tarjetas › 3 › Título». Labels come from `block_manifest.json` `labels`,
generated from the frontend specs (`manifest.test.ts`); no message names a prop key.

`checks.py` changes are message formatting and location only: the same checks
run, `_hrefs` now records where each link is, images come with their path
(`pages.image_ref_paths`), and messages use `where()` and the field labels.
The SEO checks at the end are untouched.

Frontend (`cms/editor/validation.ts`): `validateFields(fields, props, media)`
mirrors the publish checks while editing; `fieldErrorsFrom(axiosError)` and
`fieldErrorsFromIssues(issues)` read the server's errors.
`requestFieldFocus(blockId, path)` (`cms/editor/fieldFocus.ts`) jumps to a field.
`PageErrorSummary` renders the summary.

### C4: field groups

`FieldSpec.group?: string`. Consecutive fields with the same title render as one
collapsible `FieldGroup`. In section modules use `grouped('Título', [...])`
(`cms/sections/kit.tsx`) or `{ group: '…' }` on a field. Open state is stored in
`localStorage['cms-field-groups'][type]` (wrapped in try/catch).

### C5: field kinds and controls

New spec options (`cms/blocks/registry.ts` `FieldSpec`), all editor-only:

| Option | Effect |
|---|---|
| `kind: 'href'` | a destination string, picked with `HrefInput` (was `text`/`url` typed by hand) |
| `kind: 'form'` | a form slug, picked with `FormSelect` |
| `marks: ['bold' \| 'link']` | textarea with the `**…**` / `[…](…)` toolbar and preview |
| `minWidth` | image width under which the field warns |
| `advanced` | inside a list item, the field sits under «Avanzado» |
| `slugFrom: { field, keep? }` | the value is a slug of a sibling field while empty or still derived |
| `optionsFrom: { list, value, label }` | a select whose options are another list of the block |

Behaviour is keyed on the kind and these options, never on a section name, so
fields added later by other branches get the same controls.

Exported from `frontend/src/cms/editor/fields` (console only, never import from
a public page or a section module):

| Component | Props (besides `id`, `label`, `required`, `hint`, `error`, `warning`, `onBlur`) |
|---|---|
| `TextField` | `value`, `onChange(v)`, `multiline?`, `rows?`, `type?`, `placeholder?`, `tokens?: TokenName[] \| false`, `moreTokens?`, `onEnter?` |
| `HrefInput` | `value: string`, `onChange(href)`, `kinds?: ('page'\|'web'\|'email'\|'phone'\|'whatsapp')[]` |
| `LinkField` | `value: {label, href}`, `onChange(v)`, `textLabel?` |
| `LinkPickerDialog` | `open`, `value`, `onClose()`, `onPick(href)`, `kinds?`, `pages?`, `title?` |
| `IconField` | `value`, `onChange(v)`, `choices?: IconChoice[]` (default the CMS set), `allowNone?`, `compact?` |
| `ColorField` | `value` (`var(--token)` or `#hex`), `onChange(v)` |
| `RichTextEditor` | `value: html`, `onChange(html)` |
| `MarkTextField` | `value`, `onChange(v)`, `marks`, `rows?` |
| `ImageField` | `value: number \| string \| null`, `onChange(ref)`, `minWidth?`, `altError?`, `askAlt?`, `children?` |
| `MediaLibraryDialog` | `open`, `onClose()`, `multiple?`, `current?`, `onPick(ids)` |
| `FormSelect` | `value`, `onChange(slug)` |
| `FieldGroup` | `title`, `open`, `onToggle()`, `filled`, `total`, `required`, `requiredFilled`, `errors`, `children` |
| `TokenChips` | `target` + `value` + `onChange`, or `onInsert(text)`; `tokens?`, `more?` |

Helpers: `describeHref`, `hrefProblem`, `hrefKind`, `buildWeb/Email/Phone/WhatsApp`,
`SITE_PAGES` (kept in step with the templates by `links.test.ts`),
`normalizeRichHtml` (output always equals what `sanitizeHtml` prints),
`contrastOnWhite`, `useMediaAsset`, `useMediaLookup`, `useMediaUpload`.

### Help texts

`cms/editor/fieldHelp.ts`: section-specific help (`OVERRIDES[type][path]`, with
`list[].key` paths), then the spec's `hint`, then help by label and by kind.
It is console code, so the public bundles do not carry it. `fieldHelp.test.ts`
fails when a text field has no help of its own, when an override points at a
field that no longer exists, or when help contains keys, HTML or dashes.

## No new dependency

The visual text editor uses `contentEditable` and the browser's editing
commands; its output goes through `normalizeRichHtml`, which ends in the
existing sanitizer.

## For other branches

- «tables» adds Costos fields with `group`; `grouped()` and the `card()`
  helper in `costos.tsx` already group the existing price cards.
- «coverage» fields upgrade automatically by kind: use `href` for any link
  destination, `marks` for texts with negritas or links, `image` for photos.
- After changing a section's fields, regenerate the manifest:
  `UPDATE_CMS_MANIFEST=1 npx vitest run src/cms/manifest.test.ts`.
  The manifest now carries `labels`; branches that change fields in parallel
  will conflict there: regenerate it after merging instead of resolving by hand.
- «shell» owns `AdminPageEditor.tsx`. This round changed it in one place only:
  three imports, a `fieldErrors` state set by the save, publish and checks
  handlers, `jumpToField()`, `<PageErrorSummary>` above the checks panel, the
  checks issue button calling `jumpToField`, and `serverErrors` passed to
  `BlockForm`. Field tests for the editor live in `AdminPageEditor.fields.test.tsx`.

## Generic «Texto» block styles

The public generic text block used `prose` classes, but the Tailwind
typography plugin is not installed, so lists had no bullets and subtitles
looked like body text. `.cms-rich` (`src/index.css`) now styles headings,
lists, links and quotes, and the visual editor uses the same class, so what
the office sees while writing is what the site shows. Only generic «Texto»
blocks change; no page template uses them.

## Bundles

Editor code stays in console chunks. The shared entry grows by about 0.15 kB
gz (four new console chunks in the lazy-route preload map); the public routes
measure `/` 167.4, `/admisiones` 149.1, `/admisiones/costos` 140.0 kB gz
(base 167.2, 148.9, 139.8). `useQueries` is deliberately avoided: it would put
~0.9 kB gz into the react-query chunk that every public page loads.

## Known limits

- The visual editor relies on the browser's editing commands (`execCommand`),
  still supported by every current browser but marked as legacy.
- Links written inside `[texto](/ruta)` notes are checked for format in the
  editor; the server's pre-publish check does not look inside them yet.
- On a 390 px screen the editor's own header row («Bloques», undo, redo,
  Pegar, Agregar) is a few pixels wider than the screen, as on the base
  branch; that row belongs to the «shell» branch.
