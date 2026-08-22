# Responsive and mobile-first rules (BACKLOG P1-B1)

## Breakpoints (Tailwind)

| Token | Min width | Use |
|-------|-----------|-----|
| `xs`  | 360px | Smallest supported phone. Below this, layouts may wrap but must not overflow horizontally. |
| `sm`  | 640px | Large phones / small tablets portrait. Modals switch from bottom sheet to centered dialog. |
| `md`  | 768px | Tablets. Admin tables switch from stacked cards to real tables; notifications switch from bottom sheet to popover; toasts move top-right. |
| `lg`  | 1024px | Portal sidebar becomes static; mobile tab bar and drawer disappear; public nav shows inline. |
| `xl`  | 1280px | Dashboards: 3 to 4 KPI tiles per row. |
| `2xl` | 1536px | Two-pane list + detail layouts (admisiones, alumnos). |

Audit every new screen at **360, 390, 768, 1024, 1440, 1920**. The Playwright visual suite (`frontend/e2e/visual.spec.ts`) snapshots 390 and 1280.

## Non-negotiables

- Tap targets are at least **44px** (`.btn`, `.input-field`, icon buttons `h-11 w-11`).
- Inputs are **16px** (`text-base`) so iOS does not zoom on focus; `inputMode` and `autoComplete` on every tel/email/numeric field.
- Respect safe areas: `env(safe-area-inset-bottom)` on fixed bottom UI (tab bar, sheets, sticky CTAs).
- Body never scrolls horizontally; wide content (tables, code, charts) scrolls inside its own `overflow-x-auto` container (`.admin-table-wrap`).
- Content max width: public pages `max-w-6xl` (1152px); portal `max-w-[1320px]`.
- Type uses the fluid scale (`text-fluid-*`) for headings; body stays 15 to 16px.
- Hover-only affordances always have a tap equivalent.
- `prefers-reduced-motion` disables entrance animations (see `lib/motion.tsx`, `Reveal`).

## Patterns

- **Tables**: desktop `<table class="admin-table">` inside `.admin-table-wrap` (sticky header, internal scroll). Under `md` rows stack into cards automatically via `data-label` on each `<td>`; tables that need a richer card ship a `md:hidden` list and hide the table with `hidden md:block`.
- **Modals**: `components/ui/Modal` is a bottom sheet under `sm` (grab handle, focus trap, scroll lock) and a centered dialog above.
- **Notifications**: bell opens a bottom sheet under `md`, popover above; `/portal/notificaciones` for the full list.
- **Toasts**: `components/ui/ToastHost`, bottom-center on phones (above the tab bar), top-right on desktop, max 3 visible.
- **Drawer**: swipe-left closes, first item focused on open, Escape closes; tab bar hides while the soft keyboard is open.

## Large screens (P1-B10, 2026-08-22)

- Portal container: 1320px up to xl, 1680px at 2xl.
- KPI tiles: 1 / 2 / 3 / 4 per row at base / sm / lg / xl.
- Two-pane pattern at 2xl: list on the left, sticky detail on the right (`AdminStudents` + `AdminStudentDetail embedded`). Row links keep working as links below 2xl and with ctrl/cmd-click, so nothing depends on the pane.
- Dashboard secondary cards (activity, avisos) sit side by side at 2xl.
