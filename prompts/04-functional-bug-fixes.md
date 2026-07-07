# Prompt 04 — Functional Bug Fixes (P2)

**Run in:** fresh session at `D:\Github\interlaken`. **Prereqs:** 02. **Reference:** `STATUS_REPORT.md` §6. **Size:** S–M.

## Context
See `prompts/README.md`. Several confirmed functional bugs: announcements never reach parents/students (enum mismatch); "Sincronizar todos" hits the wrong endpoint; `ParentProfileSerializer` is broken; the Contact form does nothing.

## Goal
Fix the four confirmed functional defects with minimal, targeted changes.

## Tasks
1. **Announcement audience mismatch** (`apps/portal/views.py:92,110`). `Announcement.Audience` values are plural (`parents`/`students`) but `User.Role` is singular (`parent`/`student`), so the filter `['all', user.role]` never matches. Add a role→audience mapping (`parent→parents`, `student→students`, `staff→staff`) and use it in both the dashboard and the announcements list. Verify a parent now sees a `parents`-targeted announcement.
2. **"Sincronizar todos" wrong endpoint** (`frontend/src/pages/admin/AdminCafeteria.tsx:26`). It calls `cafeteriaApi.syncBalance(0)` → `/cafeteria/admin/sync/0/`. Add `syncAll()` to `frontend/src/services/api.ts` hitting `POST /api/v1/cafeteria/admin/sync-all/` and use it for the bulk button; keep per-student `syncBalance(id)` for the row buttons.
3. **Broken serializer** (`apps/accounts/serializers.py:24`). `ParentProfileSerializer.students` uses `source='user.parents.through'` — invalid (`User` has no `parents`; reverse is `children`). Either fix it to expose the parent's children correctly (via `user.children`) or remove the field if unused. Ensure nothing imports the broken version.
4. **Contact form does nothing** (`frontend/src/pages/public/ContactPage.tsx:59`). Wire it: add a `core` (or `portal`) `ContactMessage` model + `POST /api/v1/contact/` (AllowAny + rate-limited) that saves the message and emails the school (uses the SMTP config from Prompt 08 if present, else console). Update the form to submit via a new `contactApi.send()` and show success/error toast (react-hot-toast is already a dep). Add basic zod validation.

## Constraints
- Keep Spanish copy and existing styling.
- Small migrations only; don't restructure the portal/admissions apps.

## Acceptance / verify
- `python manage.py check` + migrations apply.
- A `parents`-audience announcement appears for a parent user via `/api/v1/portal/announcements/`.
- Admin "Sincronizar todos" calls `admin/sync-all/` (verify in network tab / server log).
- `POST /api/v1/contact/` persists a message and returns 201; the Contact page shows a success toast.
- `npx tsc --noEmit && npm run build` clean.

## Do NOT
- Change unrelated portal/admissions behavior. Send email to real recipients in dev (console backend is fine locally).
