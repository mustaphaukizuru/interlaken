# 0001 · Two radii, no pill buttons

- **Status:** accepted by the owner, 21 Nov 2026 (programme D1/D2).
- **Supersedes:** DESIGN.md §1.7 radii `xl2 18px / xl3 24px / xl4 32px`, `--radius 18px`, pill `.btn` (50 px).

## Decision
Two corner radii only, as tokens in `frontend/src/index.css`:

| Token | Value | Tailwind | Use |
|---|---|---|---|
| `--radius-sm` | 8 px | `rounded-sm` | controls: buttons, inputs, selects, chips, segmented items, small tiles, icon buttons |
| `--radius-md` | 12 px | `rounded-md` | surfaces: cards, panels, dialogs, drawers, sheets, images, segmented tracks, email blocks |
| (pill) | 9999 px | `rounded-full` | badges and count pills, avatars, switch thumbs and tracks, dots, spinners, step numbers, progress tracks |

Nested shapes follow outer = inner + padding (a 12 px track around 8 px items).

## Why
The site mixed eight radii (4 to 32 px) and pill buttons next to square-ish
cards, so controls and surfaces didn't read as one system. Two values keep
the friendly look while making hierarchy obvious: soft surfaces, crisp
controls.

## Consequences
- 673 radius utilities moved onto the scale; 102 pill buttons, chips, inputs
  and icon tiles became `rounded-sm`/`rounded-md`.
- The old Tailwind names (`rounded-lg`, `-xl`, `-2xl`, `-3xl`, `-xl2/3/4`, bare
  `rounded`) are **aliases** of the tokens so classes stored in published CMS
  content still land on the scale. `npm run check:ui` keeps them out of `src/`.
- Visual baselines change everywhere; they regenerate in CI.
- Reversible: change the two token values.
