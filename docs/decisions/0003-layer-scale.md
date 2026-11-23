# 0003 · One layer scale

- **Status:** accepted, 21 Nov 2026.

## Decision
`page < sticky < header < dropdown < drawer < modal < toast < overlay`, as
tokens (`--z-*` in `index.css`) and Tailwind names (`z-sticky` …):

| Layer | Value | What lives there |
|---|---|---|
| `z-raised` | 5 | pinned table cells |
| `z-sticky` | 30 | phone tab bar, sticky CTA bars and footers, WhatsApp button |
| `z-header` | 35 | app header and public nav (their menus open over the sticky bars) |
| `z-dropdown` | 40 | menus, popovers, child picker, drawer backdrop, bulk bar |
| `z-drawer` | 50 | sidebar drawer, cookie banner |
| `z-modal` | 60 | dialogs, bottom sheets, command palette |
| `z-toast` | 70 | toasts |
| `z-overlay` | 80 | full-screen credencial, gallery lightbox, skip link |

`z-0` and `z-10` remain for stacking inside one component. `check:ui` rejects
`z-20…z-50` numbers and arbitrary `z-[…]`.

## Why
Modal, drawer, public header and dropdowns all sat at 50; the portal header's
own menus opened under the tab bar between 768 and 1023 px; toasts used the
library's 9999; the cookie banner (100) covered dialogs on phones.
