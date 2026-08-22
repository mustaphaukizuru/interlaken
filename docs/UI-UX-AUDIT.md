# UI/UX audit (BACKLOG P1-I7), 22 Aug 2026

Scope: every portal and public screen at 360 / 768 / 1440. Status reflects the autopilot build on
`feat/retire-tuition-enrollment`. Items marked **open** are tracked in BACKLOG P2/P4.

## Portal shell
- Sidebar: grouped nav, badges, collapsible rail, account menu on user card. Done.
- Header: breadcrumbs, quick actions, compact on scroll, notifications sheet on phones. Done.
- Tab bar: hides with the soft keyboard; badges on Cafetería/Admisiones. Done.
- Open: ChildSwitcher inside the sidebar (E4); command palette for families (E7).

## Admin tables
- Alumnos, Admisiones, Visitas: bespoke card lists under md. Done.
- Cafetería (balances), Pagos, Auditoría, Mensajes, Contraseñas, Usuarios: stacked cards via `data-label`. Done.
- Open: column chooser and row density (A8); bulk actions (A8).

## Forms
- All tel/email fields carry inputMode/autoComplete; inputs 44px/16px. Done.
- Pre-registro and Inscripción autosave drafts; eligibility hint live. Done.
- Recarga: 3-step wizard with sticky actions. Done.
- Open: step indicator on Inscripción wizard (exists as steps, no progress bar).

## Feedback states
- EmptyState/ErrorState/Skeleton used on every list page. Done.
- Toasts responsive with stack cap. Done.
- Open: optimistic updates on toggles (I3) are only on mark-read; others refetch.

## Public site
- Header/footer per school instructions; Puertas Abiertas removed; Plataformas = Cafetería. Done.
- Nivel pages carry official colors (accent bar). Open: full content/images (P2-7).
- Open: home hero video, stats band, timeline, galería albums, testimonials, calendario, maps (P2).

## Accessibility
- 0 icon-only buttons without labels; focus-visible net; reduced motion; color-scheme light. Done.
- Open: contrast check of nivel yellow (#f1c82f) when used on white for text (keep accent-only).

## Performance
- Route chunks lazy; charts lazy. Open: srcset/lazy on galería and nivel images (P2-20).
