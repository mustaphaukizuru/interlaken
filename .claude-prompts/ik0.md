# IK0 — Architecture Audit (read-only)

**Phase:** IK0 of the Interlaken architecture plan (phases IK0–IK8, renamed to avoid
collision with the repo's own `prompts/01–20`).
**Run in:** fresh Claude Code session at `D:\Github\interlaken`.
**Mode:** READ-ONLY except for writing one file. Do **NOT** run `prompts/run-prompts.ps1`
or start any build work. Audit only.
**Output:** `ARCHITECTURE-AUDIT.md` at repo root.

---

## Task

Produce `ARCHITECTURE-AUDIT.md` with these sections:

1. **STACK REALITY** — exact backend/frontend frameworks + versions; hosting target as
   evidenced by config (Passenger? which host?); how deploys happen today; env/secret
   handling; background-job mechanism (cron details); database engine and where it runs.

2. **FUNCTIONAL INVENTORY** — every Django app and what it does; every API endpoint
   grouped by domain; every frontend route/view; auth flows present (JWT + Google
   confirmed — anything else?); third-party integrations already wired (search for:
   loyverse, banorte, global payments, sesweb, whatsapp, twilio, CFDI, PAC, facturación).

3. **DATA MODEL DIFF** — list all models with key fields, then diff against this target,
   marking each EXISTS-MATCHES / EXISTS-CONFLICTS(how) / ABSENT:
   AcademicCycle · Household · Guardian (users; parents never = students) · Student
   (entity, NOT a user; card_id/barcode unique) · Wallet (cycle-independent ledger) ·
   TuitionAccount (per-cycle, 10/11-month modality) · Enrollment (unique per
   student+cycle) · consent records (LFPDPPP, granular) · append-only AuditLog on
   money/minor-data mutations.

4. **FEATURE COVERAGE MAP** — for each target module state DONE / PARTIAL(what's missing)
   / ABSENT: pre-registro público, inscripción digital (ficha fields + document uploads
   with statuses), reinscripción, cafetería wallet, pagos/colegiaturas, facturación
   request (RFC/CFDI), circulares/notificaciones, plataformas hub, public site sections
   (Preescolar/Primaria/Secundaria/Inscripciones/Plataformas/Fotografías/Facturación/
   Contacto), admin console.

5. **DESIGN INFRASTRUCTURE** — tokens vs hardcoded values (grep hex/px in components);
   component library vs one-offs; dark/light theming; mobile-first evidence; a11y basics
   (focus states, contrast, touch targets); loading/empty/error states coverage. Grade
   each ✅/⚠️/❌ with file evidence.

6. **QUALITY & RISK** — test coverage reality; migration coherence; secrets in code (flag
   lines); dependency audit (pip + npm); the repo's `prompts/` pipeline — summarize what
   its prompts 01→NN have already built so we don't re-plan finished work.

7. **VERDICTS** — per module KEEP / ENHANCE / REPLACE (one line each), then a recommended
   build order for the remaining gaps given what exists.

End with **the 5 facts you'd want your architect to know** before planning another sprint.

## Constraints
- Read-only except writing `ARCHITECTURE-AUDIT.md`. Do not modify source.
- Do not use `prompts/run-prompts.ps1`. Do not start build work after the audit.
- Cite evidence as `path:line` throughout.

## Method (recommended)
Fan out read-only exploration across five domains in parallel, then synthesize:
(1) backend models/data-model, (2) API endpoints/auth, (3) frontend routes/design,
(4) integrations/quality/risk, (5) `prompts/` pipeline + planning docs.
