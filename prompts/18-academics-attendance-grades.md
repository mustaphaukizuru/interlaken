# Prompt 18 — Academics: Attendance, Grades & Teacher Portal

**Run in:** fresh session at `D:\Github\interlaken`. **Prereqs:** 02. **Reference:** `ROADMAP.md` §D. **Size:** XL (split into sub-steps).

## Context
See `prompts/README.md`. The `staff` role exists but has **no features**. Parents open a school app mainly for **attendance** and **grades** — both absent today.

## Goal
Add the core academic layer: a teacher portal that records attendance and grades, with parent-facing views and instant absence alerts. Deliver in three sub-steps; verify each before the next.

## Sub-step 18a — Structure
1. `apps/academics/` models: `SchoolYear`, `Term` (periodo), `Group`/`ClassSection` (grade+group), `Subject`, `Enrollment` (student↔section), `TeacherAssignment` (staff↔section/subject). Seed from existing `StudentProfile.grade/group`.
2. Add a **teacher portal** area (role `staff`): route group + `ProtectedRoute roles={['staff','admin']}`; sidebar entries.

## Sub-step 18b — Attendance
3. `Attendance` model (enrollment, date, status present/absent/late/excused, note). Teacher endpoints to take/edit daily attendance per section (bulk).
4. **Absence alert:** on marking absent, notify the student's parents (in-app + email, WhatsApp optional) via `portal.services.notify` — high-value, near-real-time.
5. Parent/student views: attendance history + summary; admin reports.

## Sub-step 18c — Grades / Boletas
6. `GradeItem` (assessment) + `Grade` (enrollment, subject, term, score) with weighting → term averages. Teacher gradebook UI (enter/edit per section/subject).
7. **Boleta (report card):** per-student, per-term PDF; parent download; publish/lock per term (audited).
8. Parent/student dashboard cards: latest grades + term average.

## Constraints
- Respect roles strictly (teachers only their assigned sections; parents only their children). Spanish.
- Migrations incremental; don't disrupt existing portal dashboards.

## Acceptance / verify (per sub-step)
- `python manage.py check` + migrations apply after each sub-step.
- 18b: a teacher marks a student absent → parent gets a notification; parent sees it in attendance history.
- 18c: a teacher enters grades → term average computes → parent downloads a boleta PDF.
- `npx tsc --noEmit && npm run build` clean.

## Do NOT
- Let a teacher access sections they aren't assigned. Expose one family's data to another. Ship all three sub-steps unverified in one pass.
