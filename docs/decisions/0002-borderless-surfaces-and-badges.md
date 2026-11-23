# 0002 · Borderless surfaces, status badges

- **Status:** accepted, 21 Nov 2026 (programme D3/D4).
- **Supersedes:** DESIGN.md §2 `Card: .card token border (line) + shadow-card`.

## Decision
- **Surfaces are borderless.** A white card on the cream page is separated by
  a soft shadow (`shadow-card`); a block inside a white surface is a tint
  (`bg-cream`, `bg-cream-2`) without a border. Hairlines (`border-line`) stay
  only on form fields, table rows and dividers. Never a card inside a card.
- **Popovers, menus, dialogs and sheets** use `shadow-raised`.
- **Badges** (`components/ui/Badge.tsx`) are for a status or a count the person
  needs: text plus an icon (never colour alone), at most one per row or card,
  colours from the status pairs (`success`, `warning`, `danger`, `info`,
  `neutral`; AA on their own tint). Badge icons are 14 px, the one optical
  exception to the 16/20/24 icon scale.
- **Eyebrows** (`.section-label-*`) are tinted tags with `radius-sm`, not pills.
  Turning them into plain text needs a per-section contrast check on the dark
  heroes first.

## Consequences
`.card`, the admin table wrapper, stacked phone rows and 93 bordered
containers lost their hairline. Dashed upload zones, selectable tiles and
form controls keep their borders.
