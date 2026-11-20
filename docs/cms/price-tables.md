# Price tables: «Costos y precios», editable labels and the «Tabla» block

Date: 2026-11-20. Branch `feat/cms-price-tables` (on `feat/cms-v2`).
Follows [CMS-COMPLETION-PLAN.md](../CMS-COMPLETION-PLAN.md).

The owner's request: the payment tables must be editable professionally and
easily, by office staff. Until now the figures of `/admisiones/costos` lived in
six Django models that only a superuser could edit in Django admin, the column
headers were fixed in code, and the CMS hint pointed to a screen that does not
exist («Ajustes, Costos»).

## 1. What Dirección can do now

### Change the colegiatura of 3º de primaria (or any price)

1. Console › Contenido del sitio › **Costos y precios** (`/admin/costos`).
2. Tab **Colegiaturas**. Click the amount next to «Primaria» (it shows
   `$ 6,450.00`; while editing it shows `6450.00`). Type the new amount and
   press Enter. The old figure stays under the cell («antes $6,450.00») and the
   tab gets a dot.
3. Look at **Vista previa del sitio** below: the real Costos tables (and, with
   «Estimador», the Admisiones calculator) already show the new figure.
4. **Guardar cambios** (bottom bar) lists every change, old → new. **Guardar**.
   The site shows it at once; Auditoría keeps the amount before and after.

The site has one colegiatura per section (Primaria covers 1º to 6º). A
per-grade price would be a new row («3º de Primaria») and a decision about how
the estimator should treat it (it matches level names, see §4).

### Everything else on that screen

| Want to | Do |
|---|---|
| Add a level, concept, class, schedule or policy | «Agregar …» under the table; it lands at the end of its group. |
| Copy a row | Duplicate icon (the copy is marked «Nueva»). |
| Hide a row for a while | «Visible» switch: the row stays, the site does not show it. |
| Delete a row | Bin icon, then confirm. Deleted only when saving. |
| Reorder | Drag the handle (desktop), the arrows, or Alt + ↑ / ↓ in a cell. |
| Move around | Tab / Shift+Tab, Enter / Shift+Enter, arrows (at the edge of the text). |
| Undo everything | «Descartar» in the bottom bar. |
| Work in Excel | «Exportar Excel» (one sheet per table plus instructions), edit, «Importar Excel»: every change is shown old → new; «Cargar en el editor» puts it in the editor; review the preview; «Guardar cambios». |

Problems show next to the cell, with the API's own words (negative amounts,
more than 2 decimals, a level repeated in the same modality, a required cell
left empty...). Nothing is saved while one is open. If someone else saved the
same table meanwhile, the save is refused (409) and «Recargar esas tablas»
loads their version.

Leaving the screen with unsaved changes asks first (closing the tab, reloading,
or clicking a console link). The browser back button is not covered: the app
uses a plain `BrowserRouter`, which has no route blocker.

### The texts around the tables

Console › Páginas › Costos › «Costos · Tablas de precios». Besides the card
titles and notes, these are now copy (default = today's text):

- column headers: «Nivel», «Gastos administrativos», «Inscripción», «Reinscripción»;
- «/ mes», «/ año» and the estancia «/mes»;
- «Destacar las políticas que mencionan» (`recargo, devolución`): policies that
  mention one of the words are bold with the amber icon (accents ignored, so
  «devolución» also matches «devoluciones», as the old `/recargo|devoluci/i` did);
- the message when the prices cannot be loaded.

The fields carry a `group` (C4) per card, so the «fields» branch shows them as
collapsible groups. The section starts with an **Editar precios** button
(replacing the wrong hint): it opens `/admin/costos` in a new tab, so the page
draft (autosaved 1.5 s after each change) is never left behind; back in the
editor, the preview reads the prices again. Staff accounts (no access to the
screen) read «Las cifras las cambia Dirección en «Costos y precios»» instead.

### The Admisiones estimator

Console › Páginas › Admisiones › «Admisiones · Estimador de costos»: every
visible label of the calculator is copy (card label and title, level buttons,
start level, modality buttons, result rows, notes, WhatsApp button, link to
Costos, error message). The figures still come from the price tables and the
arithmetic stays in code. It has the same «Editar precios» button.

The level buttons find their prices by name: «Primaria» shows the rows whose
name contains «Primaria» (accents and case ignored). The console warns (amber,
non-blocking) when an Inscripción or Colegiaturas row would not be found by
the default buttons.

### The «Tabla» block (any page)

Contenido › any page › «Agregar» › **Tabla**: title, intro, columns (label,
alignment, format: texto, dinero MXN, número, porcentaje), rows, one optional
highlighted row (star), footnotes (one per line) and an optional card style
identical to the price cards (colour, icon, small label, subtitle). Cells copied
in Excel or Google Sheets paste straight into the grid; pasted on the header
row they also fill the titles.

- A real `<table>` with a caption and `th scope`; all content renders as text.
- On a phone a wide table scrolls inside its card (never the page), says so,
  and becomes a focusable named region only then.
- Limits: 8 columns, 60 rows, 300 characters per cell, enforced by the editor
  and by the API (`content/table_block.py`, limits read from `block_manifest.json`).
- It lives in the generic-blocks chunk: no public page downloads it unless it
  uses it. Nothing was added to any page; every page is pixel-identical.

## 2. API (`backend/apps/content/pricing_admin.py`)

All admin only (`ADMIN_ONLY` in `core/test_areas.py`).

| Method | URL | |
|---|---|---|
| GET | `/api/v1/content/admin/pricing/` | `{tables: {key: {key, label, rows, version}}}` |
| PUT | `/api/v1/content/admin/pricing/` | `{tables: {key: {rows, version}}, source?: 'editor'|'import'}` |
| GET / PUT | `/api/v1/content/admin/pricing/<key>/` | one table |
| GET | `/api/v1/content/admin/pricing/export/` | `.xlsx` (audited as an export) |
| POST | `/api/v1/content/admin/pricing/import/` | multipart `file`: `{tables: {key: {sheet, rows, errors}}, ignored_sheets}`; never writes |

Table keys: `inscripcion` (EnrollmentFee), `colegiaturas` (TuitionCost),
`seguros` (FixedConcept), `extraescolares` (ExtracurricularActivity),
`estancia` (DaycareRate), `politicas` (PricingPolicy).

A save sends the whole table: rows with `id` are updated, rows without are
created, rows missing are deleted, list order becomes `order` (Inscripción
numbers each modality 1, 2, 3, as the public page shows them separately). All
tables of one request are one transaction. Errors answer 400
`{code: 'invalid_rows', errors: {key: [{row, field, label, message}]}}`; a stale
`version` answers 409 `{code: 'version_conflict', tables}`. Each created,
changed or deleted row writes one `AuditLog` row with the amounts before and
after (context `cms.pricing`, or `cms.pricing.import` after an import). The
public pricing cache is cleared on commit.

Validation: amounts ≥ 0, at most 2 decimals, at most $999,999.99 (the model's
`max_digits=8`); required labels; lengths of the model fields (policies 600);
modality one of the two choices; unique level per modality, section,
concept, class and schedule + service; text cannot start with `=` or `@`.

Not exposed on purpose: `TuitionCost.inscripcion` (legacy, no page shows it;
untouched on update, empty on new rows) and `FixedConcept.mandatory` (no page
shows it; new rows are mandatory).

## 3. Files

Backend: `content/pricing_admin.py` (new), `content/table_block.py` (new),
`content/pages.py` (`'table'` in `BLOCK_SCHEMAS` + one loop calling
`table_problem` in `validate_blocks`), `content/urls.py`,
`content/block_manifest.json`, `core/test_areas.py`; tests
`test_pricing_admin.py`, `test_table_block.py`.

Frontend console: `pages/admin/AdminPricing.tsx`,
`components/admin/pricing/*` (model, grid, money input, change list, import
dialog, preview, leave guard), `services/pricingAdminApi.ts`, route in
`App.tsx`, menu entry in `components/layout/navConfig.ts` (C6: site content
group, after «Biblioteca de medios»).

Frontend CMS: `cms/blocks/table.ts`, `cms/blocks/TableBlock.tsx`,
`cms/blocks/registry.ts` (Tabla spec; `FieldKind` gains `'table' | 'action'`;
`FieldSpec` gains `group`, `limits`, `href`), `cms/blocks/generic.tsx`
(one `case`), `cms/editor/TableField.tsx`, `cms/editor/customFields.tsx`,
`cms/editor/gridNav.ts` (spreadsheet keys, shared with the console),
`cms/manifest.test.ts` (kinds `table`/`action`; `tables` limits in the
manifest entry), `cms/sections/kit.tsx` (`group` option, `f.action`),
`cms/sections/costos.tsx`, `cms/sections/admisiones.tsx` (estimator part
only), `components/public/PricingSections.tsx`,
`components/admissions/CostEstimator.tsx`, `components/admissions/estimatorCopy.ts`.

Shared editor files, for the branches that also change them:

- `cms/editor/BlockForm.tsx`: one import (`CustomField`) and the `default:`
  branch of `Field` renders `<CustomField spec value onChange />` instead of
  `null`. Nothing else.
- `pages/admin/AdminPageEditor.tsx`, `pages/admin/AdminPages.tsx`: untouched.

## 4. Bundles

| Route | Before | After | Budget |
|---|---|---|---|
| `/` | 167.3 | 167.3 | 171 |
| `/admisiones` | 148.9 | 146.5 | 150 |
| `/admisiones/costos` | 139.8 | 140.6 | 150 |

`/admisiones` went down: the estimator below the fold now loads on demand
(its own skeleton holds the place, so nothing moves). The console, its
preview and the Tabla block are lazy chunks.
