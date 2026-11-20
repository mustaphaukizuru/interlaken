# CMS editor shell and «Contenido» list

Branch `feat/cms-editor-shell` (on `feat/cms-v2`). Console only: no public page
changes, no backend changes, no migration.

## What the office can do

1. **Contenido** (`/admin/contenido`, `/staff/contenido`) lists each public page
   once, then the school's own pages in a second group.
   - Each row shows the page, its public address, its state in words and icon,
     who edited it last and when, and its actions:
     - «Personalizar» (first time) or «Editar»;
     - «Ver» (opens the live page);
     - «Versiones» (Dirección, once published; opens the editor's dialog);
     - «Eliminar el borrador» (a draft never published; a public page returns
       to its original design).
   - The states are: Diseño original, Borrador, Cambios sin publicar,
     Publicada, Programada and Borrador antiguo, plus «Pendiente de
     aprobación».
   - Search (accents ignored) and the state filter are kept in the URL (`?q=`,
     `?estado=`).
   - Dirección can still select pages for bulk publish, unpublish or delete,
     and export them.
   - On phones the rows become cards; from 768 px they show as a table.
2. **The editor** opens with a bar that never scrolls away:
   - the page title, the state chip and the autosave state («Guardando…»,
     «Guardado hace 1 min», or «No se guardó» with «Reintentar»);
   - undo and redo;
   - «Revisar», «Vista previa» (the whole page in a new tab, from a signed
     link) and «Publicar» (Dirección) or «Solicitar aprobación» (staff);
   - everything else under «Más»: Versiones, Enlace de vista previa, SEO,
     Programar, Diseño original, Ver en el sitio, Cómo editar and Retirar.
3. **Sections:** the list shows each section's full name (two lines and a
   tooltip), an icon for its type, whether it is hidden («Oculta en el sitio»)
   or fixed («Fija»), plus eye and «⋯» buttons (Subir, Bajar, Duplicar, Copiar,
   Eliminar).
   - Reorder by dragging or with Alt + ↑/↓ on a focused section; the new
     position is announced.
   - Selecting a section, in the list or in the preview, opens its form in
     place, with focus on its title. «‹ Secciones» goes back, and the arrows
     move to the previous or next section.
4. **Desktop (≥ 1024 px):** the editing column sits beside the live preview.
   - Drag the handle, or use the arrow keys on it, to resize the column
     (320 to 640 px). The width is remembered in this browser.
   - The bar holds one row from 1280 px. From 1024 to 1279 px the actions take
     a second row, all together.
5. **Phones and tablets (< 1024 px):** «Editar | Vista previa» tabs sit under
   the title, and the action bar is at the bottom.
   - The bar sits above the console's tab bar and uses the notch safe area. It
     hides while the keyboard is open.
   - Tapping a section in the preview switches to «Editar» with its form in
     view.
6. **Programar:** pick publish and withdraw dates in Mexico City time,
   whatever the computer's time zone.
   - The dialog explains what happens: the draft as it is then gets
     published; withdrawing brings back the original design, or «Página no
     encontrada» for custom pages; the cron runs every 5 minutes.
   - Each schedule can be cancelled, and the dialog saves right away.
   - Staff see the schedule read-only. SEO keeps only the title, address and
     SEO fields.
7. **Guide:** «Cómo editar una página» (4 steps) shows on the first visit.
   Closing it is remembered; «Más → Cómo editar» brings it back.
8. **Leaving:** closing or reloading the tab with a pending or failed save
   shows the browser's warning.
   - A console link with a pending save saves first, then leaves.
   - With a failed or paused save, it asks «¿Salir sin guardar?».
   - Either way, unsaved edits stay as a copy in this browser, and the editor
     offers «Recuperar mis cambios» on the next visit.

## Components (`frontend/src/cms/editor/shell/`)

| File | Role |
|---|---|
| `EditorActionBar.tsx` | Sticky top bar, phone tabs, `EditorBottomBar` |
| `MoreMenu.tsx` | Accessible menu button: arrows, Home/End, Escape and Tab; returns focus |
| `StatusChip.tsx`, `status.ts` | Page state vocabulary (`pageState`, `timeAgo`, `isLegacySeed`) |
| `SaveIndicator.tsx`, `useDraftSaver.ts` | Autosave state machine (C2) |
| `ScheduleDialog.tsx`, `mxTime.ts` | «Programar» in America/Mexico_City |
| `SeoDialog.tsx` | Title, address, SEO |
| `LegacyDraft.tsx` | C1 banner and dialog |
| `ConflictBanner.tsx`, `localCopy.ts` | C2 banner, local copy and «Recuperar mis cambios» |
| `BlockList.tsx`, `blockLabels.ts`, `blockIcons.tsx` | Section list |
| `PreviewPane.tsx` | Live preview with the phone, tablet and desktop switch |
| `AddBlockModal.tsx`, `VersionsModal.tsx` | Moved unchanged out of the editor |
| `EditorOnboarding.tsx`, `useOnboarding.ts` | First-visit guide |
| `useLeaveGuard.ts` | beforeunload plus console link interception (BrowserRouter has no blocker) |
| `pageList.ts`, `PageListGroup.tsx` | «Contenido» rows, filters and groups |

`AdminPageEditor.tsx` keeps the page state, the mutations and the
`<BlockForm block onChange />` mount (unchanged props), so the «fields» branch
can work on it with small diffs.

## Contracts consumed

All the new fields are optional. Without them the UI behaves as before.

### C1: old generic seed drafts

- **Field read:** `legacy_seed?: boolean` on the list rows and the page detail.
  - When the field is missing, the old client-side guess applies
    (`isLegacyDraft`: never published, the page has a template, and only
    generic blocks).
  - When the field is a boolean, the editor trusts it.
- **Banner:** shown on open when the draft is legacy. «Cargar el diseño actual»
  replaces the draft with the template (the existing load-design action) and
  hides the banner until the page reloads.
- **Publishing:**
  - Clicking «Publicar» on a draft known to be legacy opens the dialog first
    (a client guard, so nothing is lost before the backend ships).
  - `POST …/publish/ {"action":"publish"}`, answered with HTTP 409
    `{"code":"legacy_seed_draft"}`, opens the same dialog.
  - The dialog offers «Cargar el diseño actual» (recommended; no publish
    call), «Publicar de todos modos» (resends
    `{"action":"publish","confirm_legacy":true}`) and «Cancelar».
- **List:** a legacy row shows «Borrador antiguo».

**The backend must match:** the 409 is told apart from C2 by `code`. The
`confirm_legacy` key is sent only on that second call.

### C2: two people on one page

- **Fields read:** `draft_revision`, `draft_updated_by` (a name string; an
  object with `full_name` or `name` also works) and `draft_updated_at`.
- **Every draft PATCH** from the editor sends `draft_revision`, but only when
  the page detail had one. This covers blocks, title, SEO and schedule. The
  next save uses the `draft_revision` from the PATCH response.
- **HTTP 409** `{"code":"draft_conflict","draft_revision":n,"draft_updated_by","draft_updated_at"}`:
  - autosave pauses, and later local edits are kept but not sent;
  - the banner reads «<Nombre> guardó cambios en esta página hace X»;
  - a copy of the local draft goes to localStorage (`cms-local-copy:<id>`).
- **«Conservar los míos (sobrescribir)»** resends the local draft with
  `draft_revision: n`.
- **«Ver sus cambios (recargar)»** refetches the page and resets the editor
  from it. The local copy is then offered with «Recuperar mis cambios».
- **Publish, «Revisar», «Solicitar aprobación» and the preview link** save
  first. If the save stops on a conflict, they do not run.

**The backend must match:**

- The PATCH response includes the new `draft_revision`.
- A version restore (`POST …/versions/`) returns the page with its new
  revision; the editor resets from it.
- The 409 body has the fields above at the top level.

### C3 hook (the «fields» branch owns the rendering)

When a save or publish fails with `errors: [{block_id | block_index, …}]`,
the shell opens the first block in the list (`showBlockError` in
`AdminPageEditor.tsx`). The messages themselves are left to `BlockForm` and
the error summary of the «fields» branch.

## Browser storage (every access in try/catch)

| Key | Content |
|---|---|
| `cms-onboarding-dismissed` | `1` once the guide is closed |
| `cms-editor-column` | Width of the editing column (px) |
| `cms-local-copy:<pageId>` | Unsaved local draft (conflict, failed save, leaving) |
| `cms-clipboard` | Copied section (unchanged) |

## Also fixed

- **«Enlace de vista previa»** built `origin + url`, but the API returns an
  absolute `FRONTEND_URL` link. The link now uses this site's origin plus
  `/p/<slug>?preview=<token>`.
- **«Retirar»** said visitors would see a 404. For a public page with a design
  template, the site goes back to the original design, and the dialog now
  says so.
- **Autosave** marked edits typed during a save as saved, and could send two
  saves at once. It now sends one save at a time and saves the newer edits
  right after.

## Tests

- `pages/admin/AdminPageEditor.test.tsx` covers the action bar and «Más», the
  save error and «Reintentar», the leave guard, versions, «Programar», all
  three C1 paths plus the case without the field, four C2 paths, the sections,
  the guide and the phone tabs.
- `pages/admin/AdminPages.test.tsx` covers the single list, the badges, the
  filters, «Personalizar», bulk publish and the staff view.
- `cms/editor/shell/shell.test.ts` covers Mexico City time, the page states
  and the contract readers.
