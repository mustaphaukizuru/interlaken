# Design tokens (BACKLOG P1-I1)

Source of truth: `frontend/src/index.css` (`:root` custom properties) and `frontend/tailwind.config.js`
(utilities). Brand: green, coral/pink, purple, cream. **Teal is not a brand color.**

| Token | Value | Use |
|-------|-------|-----|
| `--purple` / `brand-*` | #401a8e | primary actions, active nav, links |
| `--pink` / `--grad-cta` | #e01a4e | CTAs (pre-registro, pagar) |
| `--coral` | #dd2622 | destructive, errors, alerts |
| `--green` / `--green-dark` | #47a028 / #316f1c | success, cafetería, positive KPIs |
| `--amber` | #b45309 | warnings, pending |
| `--cream` / `--cream-2` | #F5F4FA / #FAF9FD | page and card backgrounds |
| `--text-main` / `--text-muted` / `--text-light` | #1A1130 / #6E6885 / #6B6482 | ink, muted, subtle |
| `--border` | #ECEAF3 | lines |
| `--nivel-preescolar` / `nivel-preescolar` | #8ac6a4 | Preescolar accents |
| `--nivel-primaria` / `nivel-primaria` | #f4436c | Primaria accents |
| `--nivel-secundaria` / `nivel-secundaria` | #f1c82f | Secundaria accents |

Rules:
- Use tokens, never raw hex, in components; charts read `lib/chartTheme.ts`.
- `html { color-scheme: light }`: the portal is a light design; OS dark mode must not invert controls.
- Spacing: 4px scale (Tailwind). Radii: `--radius-sm` 8px (`rounded-sm`, controls) and `--radius-md` 12px (`rounded-md`, surfaces); `rounded-full` for badges, avatars, switches and dots only (decisions/0001).
- Surfaces are borderless; hairlines only on fields and rows (decisions/0002). Layers: `z-sticky … z-overlay` (decisions/0003).
- Status pairs: `--success-*`, `--warning-*`, `--danger-*`, `--info-*`, `--neutral-*` (fg on bg passes AA); Tailwind `text-success bg-success-bg` etc.
- `npm run check:ui` (CI) rejects off-scale radii, global z numbers and raw hex in components.
- Type: Poppins for headings (`font-head`), Inter body; fluid scale `text-fluid-*`.
