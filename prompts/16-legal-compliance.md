# Prompt 16 — Legal & Compliance (Mexico)

**Run in:** fresh session at `D:\Github\interlaken`. **Prereqs:** 02. **Reference:** `ROADMAP.md` §B. **Size:** M.

## Context
See `prompts/README.md`. The app handles **minors' personal data** and payments but has **no legal pages** — Mexico's LFPDPPP legally requires an **Aviso de Privacidad**.

## Goal
Add the legally-required notices and consent flows (Spanish), plus the plumbing for data-subject rights.

## Tasks
1. **Aviso de Privacidad** (`/aviso-de-privacidad`) — a real, editable page. Prefer content-managed: a `LegalDocument` model (slug, title, body, version, effective_date) + admin editing + public render, so Legal can update without a deploy. Seed a solid template (identify the responsible entity, data collected, purposes, transfers, ARCO mechanism, contact).
2. **Términos y Condiciones** (`/terminos`) — same mechanism.
3. **Cookie consent banner** — Spanish, stores consent, gates any analytics (Prompt 19) until accepted.
4. **ARCO rights** — a request form (`POST /api/v1/legal/arco/`) for Acceso/Rectificación/Cancelación/Oposición; stores the request + emails the data officer; parent-facing entry point in the portal.
5. **Parental-consent flag** — record consent (timestamp/version) when a parent creates a student-linked account or submits admissions data; surface the current privacy version accepted.
6. **Footer & forms:** link the legal pages in the footer; add "Acepto el Aviso de Privacidad" checkboxes (linked) to pre-registro, inscripción, booking, and contact forms.

## Constraints
- Spanish, legally-phrased (mark clearly that a lawyer should review the seeded text before go-live).
- Store consent versions/timestamps for auditability.

## Acceptance / verify
- `python manage.py check` + migrations apply.
- `/aviso-de-privacidad` and `/terminos` render from the DB and are editable in Django admin.
- Submitting a form without the consent checkbox is blocked; ARCO request persists and emails the officer (console in dev).
- Cookie banner blocks analytics until accepted.

## Do NOT
- Present the seeded legal text as final/authoritative — flag it for legal review.
