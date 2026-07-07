# Prompt 14 — Open-Class Unification + WhatsApp Booking (Phases 3–4)

**Run in:** fresh session at `D:\Github\interlaken`. **Prereqs:** 12, 13. **Reference:** `BOOKING_CALENDAR_SPEC.md` §4.2, §5, §7. **Size:** M–L.

## Context
See `prompts/README.md`. Group open days live in `admissions.OpenSchoolDay`; unify them under the bookings system and let parents book from WhatsApp.

## Goal
Serve open-class events through the bookings app (with calendar + confirmations), surface a live "Próxima Puertas Abiertas", and enable WhatsApp booking (deep link now, conversational bot when the WABA number is ready).

## Tasks
1. **Unify open class:** migrate/adapt `OpenSchoolDay` into `AvailabilitySlot(visit_type=open_class, capacity=N)`; the existing `open-school/signup/` creates a `Booking`. Add calendar sync + confirmation (Prompts 12–13). Keep backward-compatible routes/redirects.
2. **Live event banner:** wire the HomePage "Próxima Puertas Abiertas" (Prompt 06) to `GET /api/v1/bookings/availability/?type=open_class` (next upcoming). Enhance `OpenSchoolPage.tsx` to list upcoming group events from the API.
3. **WhatsApp Tier 1 (ship now):** a "Reservar por WhatsApp" button → `wa.me/<WHATSAPP_NUMBER>?text=…` with a prefilled Spanish message. Staff completes the booking in admin (`source=whatsapp`). (Reuses `core/urls.py` wa.me redirect.)
4. **WhatsApp Tier 2 (conversational):** `GET|POST /api/v1/whatsapp/webhook/` — the `GET` handles Meta's verify handshake (`WHATSAPP_VERIFY_TOKEN`); the `POST` verifies `X-Hub-Signature-256` (`WHATSAPP_APP_SECRET`) then handles messages: list next open slots (interactive buttons/list) → on selection create a `Booking(source=whatsapp)` + calendar event + WhatsApp confirmation via the Cloud API (`WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`). Add these env keys to `.env.example`.
5. **Docs:** in `DEPLOYMENT.md`, note the webhook needs valid **HTTPS** (SSL fix) and a Meta WABA number; document sandbox testing.

## Constraints
- Verify every WhatsApp webhook signature. Fail soft on calendar (Prompt 13). Spanish messages.
- Tier 1 must work with zero external setup; Tier 2 behind the env keys (no crash if unset).

## Acceptance / verify
- `python manage.py check` + migrations apply; existing open-day signup still works.
- HomePage banner + OpenSchoolPage show live upcoming events.
- Tier 1 button opens WhatsApp with the prefilled message.
- Tier 2: the verify `GET` echoes the challenge; a signed sample `POST` books a slot and replies; an unsigned POST is rejected.
- `npx tsc --noEmit && npm run build` clean.

## Do NOT
- Trust unsigned WhatsApp webhooks. Break existing admissions open-day URLs.
