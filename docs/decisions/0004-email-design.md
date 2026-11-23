# 0004 · Email design: borderless blocks, two families, D13 subjects

- **Status:** accepted, 21 Nov 2026 (programme D13, D18; Phase 9).
- **Standard:** `docs/EMAIL-DESIGN.md`.

## Decision
- One system: `EmailContent` (`backend/apps/portal/emailing.py`) rendered by
  `templates/email/base.html` (HTML) and `render_text` (plain text).
- **Look:** cream page, borderless white panel (12 px), tinted 12 px blocks
  instead of hairlines, one purple (`#401A8E`) 8 px button per email (D18: the
  site's primary-action colour), colours from the tokens (parity test).
- **Families:** `transactional` (default: access, admissions, visits,
  cafetería, payments, ARCO, staff alerts) never renders promotional blocks;
  `notice` (comunicados) may add a hero, up to 3 cards and a stat strip.
  Emergencies use the transactional layout with «Aviso importante».
  A marketing family does not exist (proposal P7, needs legal review).
- **D13:** subjects never carry a person's name, a code or an amount. Family
  bodies name a student by first name and initial. Receipts keep amount,
  folio and balance. Staff emails may use full names in the body (staff need
  them to find the student).

## Consequences
- 15 subjects lost names or codes (list in `docs/UX-AUDIT.md` Appendix E status).
- Outlook desktop renders square corners and relies on `mso-padding-alt` for
  the button height; check in the client pass (T20).
- The inbox preview line (preheader) still repeats the intro, which can
  include an amount; D13 covers subjects only. Revisit if the owner wants
  previews without amounts.
