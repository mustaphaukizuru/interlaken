# Colegio Interlaken - Go-Live Readiness Audit

_Whole-system audit by a virtual team (Test / Fullstack / UI-UX), each finding independently triaged against the code. Generated 2026-07-18._

## Summary

**50 confirmed items** - **0 blockers**, 19 major, 25 minor, 6 polish.

Baseline: backend test suite green (~340 tests); frontend `tsc` clean; `eslint` 0 errors. No go-live blockers found - the list below is the ranked finish-work backlog. Items tagged _(credential/config-gated)_ are pending client-supplied secrets, not code defects.

## Blockers

_None - no go-live-stopping defects found._

## Major (19)

### `auth-accounts`

**1. Password reset is not implemented end-to-end — parents with non-Google emails have no login path**  
`Backend` - status: _missing_ - evidence: `backend/apps/accounts/api_urls.py (no reset routes); backend/apps/accounts/urls.py (only google/, callback/, logout/); import_students.py:169,185 (set_unusable_password); frontend/src/pages/auth/LoginPage.tsx:212-214 (only 'Contacte al colegio'); grep for reset/forgot/set_password across *.py/*.tsx finds no reset endpoint or UI`  
Every CSV-imported parent/student is created with an unusable password, so the email/password form always 401s for them. There is no request-reset endpoint, no signed-token issue/verify, and no set/reset-password page in the SPA. import_students.py's own comment acknowledges this is deferred ('password reset once SMTP is live'). Non-Google-email parents cannot self-serve first access at go-live.  
**Done when:** A request-password-reset endpoint that emails a signed, expiring, single-use token, plus a set/reset-password page in the SPA wired into LoginPage ('¿Olvidó su contraseña?'). Backend tests cover token issue/expiry/single-use; a LoginPage flow test covers the happy path. (May ship behind the SMTP go-live gate, but the endpoints + page must exist.)  
_Triage: Real gap, but the auditor overstated scope and severity. NOT 'most accounts': imported students get @alumnos.interlaken.edu.mx addresses (institutional Google Workspace) and log in via Google OAuth fine; parents whose email_padre is a Gmail/Workspace account also log in via Google. The truly-locked-out set is parents whose registered email is a NON-Google mailbox (hotmail/yahoo/ISP/company) — common in Mexico, so a meaningful subset, but not the majority. Only workaround is admin-setting each password in Django admin by hand. Downgraded blocker→major (login works for the Google cohort; full flow is gated on the known-pending SMTP infra item). Approaches blocker only if the actual parent population skews heavily non-Google._  

**2. No account self-service UI — PATCH /accounts/me/ exists but is never called**  
`UI/UX` - status: _incomplete_ - evidence: `backend/apps/accounts/views.py:288-294 (CurrentUserView = RetrieveUpdateAPIView); serializers.py:11-12 (writable first_name/last_name/whatsapp/avatar; read_only id/email/role); frontend/src/services/api.ts:108 (authApi.me is GET only); grep: no PATCH to /accounts/me/ anywhere in frontend/src; App.tsx has no profile/perfil/cuenta route; AccountMenu.tsx:60-77 (only 'Mi panel' for all + 'Ajustes'→/admin/ajustes for admin)`  
Backend exposes an editable profile but the SPA only ever GETs it. AccountMenu's 'Ajustes' (admin-only) links to the site CMS (AdminSettings), not a personal profile. Parents/students/staff cannot correct their name or WhatsApp after CSV import.  
**Done when:** A profile page reachable from AccountMenu for all roles that GET/PATCHes /accounts/me/ (name, whatsapp) with save/loading/error/success states; the PATCH is exercised by the UI and covered by a component test.  
_Triage: Evidence holds exactly. The PATCH half of CurrentUserView is dead surface; no role has any way to view/edit their own name or WhatsApp number. WhatsApp is load-bearing (booking + notifications), which keeps this at major rather than minor._  

### `admissions`

**3. No rate limit on public pre-register / register-create POST → spam + email abuse**  
`Backend` - status: _incomplete_ - evidence: `backend/apps/admissions/views.py:80-99 (PreRegistrationListCreateView POST = AllowAny, no @ratelimit) and views.py:209-233 (RegistrationListCreateView POST = AllowAny); only the open-school signup carries @method_decorator(ratelimit('booking-create',...)) at views.py:481. config/settings/base.py has NO DEFAULT_THROTTLE_CLASSES (grep: 'NO DRF THROTTLE CONFIGURED').`  
Public pre-register and walk-in register endpoints accept unlimited anonymous POSTs, each creating a DB row and sending 1-2 emails to caller-supplied addresses.  
**Done when:** Both public POST endpoints share an anonymous rate-limit bucket (e.g. a small N/min per IP, mirroring booking-create); over-limit requests get 429 and send no email / create no row.  
_Triage: Added in triage. The session added a rate-limit to the open-school signup but left the two higher-traffic public admissions POSTs unthrottled. perform_create fires _send_confirmation to the attacker-controlled parent_email and _notify_admin to the school inbox, so an unauthenticated caller can (a) mass-create junk PreRegistration/Registration rows and (b) relay Interlaken-branded confirmation emails to arbitrary addresses while flooding the admin inbox. register-create also mints an invite token per call._  

### `cafeteria`

**4. Parent cafeteria transaction history is not paginated — older movements unreachable**  
`UI/UX` - status: _works-but-rough_ - evidence: `frontend/src/pages/parent/CafeteriaPage.tsx:56-66 (queryFn returns data.results ?? data, no page state) and lines 325-364 render the list flat with no Pagination/load-more; api.ts:209-216 getTransactions accepts a page param that is never passed; backend MyTransactionsView is a paginated ListAPIView (backend/apps/cafeteria/views.py:78) at PAGE_SIZE 20.`  
**Done when:** Parent history shows a Pagination control (page state threaded into getTransactions) or infinite/load-more so every historical movement is reachable, and the count text reflects the total, not the 20-row page length.  
_Triage: Evidence holds exactly. The page reads only the first page; date filters partially mitigate but cannot page within a >20-row range. Major is honest._  

**5. Online top-up return page (money-in confirmation) has zero test coverage**  
`Test` - status: _missing_ - evidence: `frontend/src/pages/parent/CafeteriaTopupReturn.tsx (polling state machine: MAX_POLLS=5, POLL_MS=2000, four outcomes, missing-payment_id -> failed, unmount cleanup). No matching test file exists — only CafeteriaPage.test.tsx and PaymentsPage.test.tsx are present under src/pages/parent.`  
**Done when:** A CafeteriaTopupReturn.test.tsx covers: missing payment_id -> failed; status=success -> success screen+toast; status=failed/refunded -> failed; polling exhausted while pending -> pending; and that the timer is cleared on unmount.  
_Triage: Confirmed no test file. This is the last-mile UX of a real-money flow; a regression in the polling loop or the missing-id guard would ship silently. Major is appropriate for a test-coverage gap on a money path (the component itself is tsc-clean)._  

**6. Reconciliation makes N sequential blocking Loyverse GETs in one request — times out at real roster size**  
`Backend` - status: _works-but-rough_ - evidence: `backend/apps/cafeteria/services.py:887-910 reconcile_balances() iterates every active StudentProfile with a loyverse_id and calls get_customer_by_id() per student synchronously; each resolves to _get() (services.py:74-84) doing one blocking HTTPS GET with _TIMEOUT + retry adapter. No cap, batching, or time budget. Driven by AdminReconcileView GET (views.py:460-484).`  
**Done when:** Reconciliation completes reliably for the full roster: bounded per-request work (paginate/limit + continue token), a time budget returning partial 'checked X of N' results, or an async/management-command path the console polls — so an admin always gets a complete, non-timing-out drift report.  
_Triage: Evidence verified line-for-line. On the target GoDaddy/Passenger shared host, hundreds of sequential round-trips exceed the proxy/request timeout, so the button never returns for a whole-school roster. Works in demo, fails at go-live scale. Major (admin diagnostic tool, not money-wrong) — not a blocker._  

### `finance-payments`

**7. Parent payment history renders every successful payment as "Pendiente"**  
`UI/UX` - status: _broken_ - evidence: `frontend/src/pages/parent/PaymentsPage.tsx:23-29 statusMeta keyed 'completed'; backend Payment.Status.SUCCESS='success' (backend/apps/payments/models.py:14) serialized verbatim by PaymentSerializer (backend/apps/payments/serializers.py:12-15). Line 82 does statusMeta[p.status] ?? statusMeta.pending.`  
Rename the 'completed' key to 'success' (or add a 'success' entry mapping to label 'Completado', variant 'success', CheckCircle).  
**Done when:** A SUCCESS payment in /portal/pagos shows a green 'Completado' badge with a check icon; a test asserts the rendered label for a success payment.  
_Triage: Evidence holds exactly. No 'success' key exists, so a SUCCESS payment falls back to the pending entry — green paid payment shown as yellow 'Pendiente'/clock in the parent's own /portal/pagos history. pending/failed/processing/refunded all match; 'success' is the only mislabel. Real money-state misrepresentation to families; major is right._  

**8. No refund path — REFUNDED status unreachable and overpayments only log a warning (no staff surface)**  
`Backend` - status: _missing_ - evidence: `Payment.Status.REFUNDED defined (backend/apps/payments/models.py:16) but grep across finance+payments shows it set nowhere except FINAL_STATUSES membership (backend/apps/payments/views.py:30). Overpayment handled only by logger.warning at backend/apps/finance/services.py:366-370. AdminFinance.tsx renders balance_due (lines 296, 364) but no overpaid/credit filter or refund control.`  
Either an audited refund admin action (set REFUNDED + credit via InvoiceAdjustment) surfaced for balance_due<0, or an explicit documented manual-refund policy PLUS an 'overpaid/credit' count/filter in AdminFinance so logged overpayments are actionable.  
**Done when:** Overpaid invoices (balance_due<0) are visible and filterable in AdminFinance; either a working refund action transitions the payment to REFUNDED and credits the invoice, or a documented manual-refund decision exists with the dashboard signal in place.  
_Triage: Evidence holds. Note the overpayment is now correctly RECORDED (amount_paid past amount, balance_due<0) — the money is no longer dropped; the remaining gap is (a) no in-app refund action that sets REFUNDED / reverses an InvoicePayment, and (b) overpaid invoices are invisible to staff (log-only). Refunds may legitimately be offline/cash for a school, so the honest ask is at minimum a dashboard signal; kept major._  

**9. adjust_invoice / cancel_invoice / receipt PDF / bulk action have no test coverage**  
`Test` - status: _missing_ - evidence: `backend/apps/finance/tests.py covers generation, late fees, webhook (incl. overpayment + per-payment idempotency), dashboard, mark_paid, parent scoping only. No test references adjust_invoice (services.py:440-488), cancel_invoice (services.py:491-509), InvoiceReceiptView (views.py:141-153), or AdminBulkActionView (views.py:295-330).`  
Add tests for the listed paths.  
**Done when:** Tests cover adjust_invoice credit and charge, the PAID→OVERDUE/PENDING re-derivation and negative-total guard; cancel_invoice on pending vs already-paid; InvoiceReceiptView 200/application-pdf for a paid invoice and 400 for unpaid; AdminBulkActionView mark_paid/cancel/remind done/failed counts and rejection of bad action / empty ids.  
_Triage: Verified against the full test file — none of the four are exercised. adjust_invoice's PAID→OVERDUE/PENDING re-derivation (services.py:466-471) and negative-total guard (462-463) are non-trivial money logic with zero coverage; cancel_invoice's already-paid ValueError (497-498), receipt 400-when-unpaid (views.py:149-151), and bulk done/failed accounting are all untested go-live admin money paths. Major is fair._  

**10. Payment gateways ship with placeholder sandbox checkout URLs (credential-gated)**  
`Integration` - status: _incomplete_ - evidence: `backend/apps/payments/gateways/banorte.py and global_payments.py create_checkout build a deterministic URL and fall back to FRONTEND_URL/pago/simulado when *_CHECKOUT_URL/*_HPP_URL is unset; no real HPP-session API call. Webhook HMAC verification is real and fails closed until *_WEBHOOK_SECRET is set.`  
Config/credential-gated: provision real merchant credentials, live HPP/checkout URLs, and webhook secrets; swap create_checkout to the provider's real HPP-session call; point the provider notification URL at the gateway webhook.  
**Done when:** GLOBAL_PAYMENTS_HPP_URL/APP_ID/APP_KEY, BANORTE_CHECKOUT_URL/MERCHANT_ID, and both *_WEBHOOK_SECRET set from real credentials; create_checkout issues the provider's real session call; one end-to-end sandbox/live charge verified before go-live.  
_Triage: This is the known, documented credential/config-gated pending item (Banorte placeholder sandbox URL until merchant credentials). Kept on the list as integration/incomplete per instructions; not a code defect — no real money can move until live URLs, app keys, and webhook secrets are provisioned and create_checkout swaps to the provider's real HPP-session request._  

### `bookings`

**11. Admin bookings list is unpaginated; frontend pager is inert and mislabels counts**  
`Backend` - status: _broken_ - evidence: `backend/apps/bookings/views.py:198-219 returns bare list, no pagination_class; frontend/src/pages/admin/AdminBookings.tsx:221-231 (page passed) & 377 (Pagination uses full count); frontend/src/lib/pagination.ts:14-19`  
AdminBookingsView (backend/apps/bookings/views.py:198-219) is a plain APIView that returns Response(BookingSerializer(qs, many=True).data) — a bare list of EVERY matching booking, with no pagination_class and no honoring of ?page. It queries Booking.objects.all() (all-time, not just upcoming), so it crosses 20 rows quickly for a real school. The frontend (AdminBookings.tsx:221-231) passes page and runs the response through toPaged() (lib/pagination.ts:14-19), which for a bare array sets count = results.length = the FULL total. The Pagination control (AdminBookings.tsx:377) then computes a range like '21-40 de 45' while all 45 rows are already rendered, and Anterior/Siguiente refetch the identical full list (page ignored). Every other admin table uses real DRF PageNumberPagination; this endpoint diverges.  
**Done when:** GET /api/v1/bookings/admin/bookings/ returns DRF paginated {count,next,previous,results} honoring ?page (ListAPIView/pagination_class), the table shows PAGE_SIZE rows per page, the 'x-y de N' label matches what's rendered, and Anterior/Siguiente move between pages. Regression test asserts page 2 returns a different, correctly-sized slice.  
_Triage: Evidence holds exactly. Endpoint returns bare list, ignores ?page; frontend pager mislabels and does nothing across pages. Major is fair since the query is all-time bookings and will exceed PAGE_SIZE._  

**12. Slot generator weekday convention mismatch: frontend Lun=1/Dom=0 vs backend Python weekday() Mon=0 — slots land one day off** — ✅ **FIXED 2026-07-18** (backend now converts each date to the frontend's JS getDay() scheme; regression test added)  
`Backend` - status: _broken_ - evidence: `frontend/src/pages/admin/AdminBookings.tsx:28-36 (WEEKDAYS Lun=1..Dom=0) & :48 default [1,2,3,4,5] & :54 weekdays sent raw; backend/apps/bookings/views.py:97 (current.weekday() in d['weekdays']); backend/apps/bookings/serializers.py:107-111 help_text '0=Lunes'. Grep confirms no weekday conversion anywhere in frontend/src.`  
The admin 'Publicar disponibilidad' generator sends weekday integers straight to the backend with no conversion. The frontend WEEKDAYS constant (AdminBookings.tsx:28-36) uses the JS getDay() convention: Lun=1, Mar=2, Mié=3, Jue=4, Vie=5, Sáb=6, Dom=0. The default selection is [1,2,3,4,5] (intended Mon-Fri). But the backend generator (views.py:97) matches with Python's date.weekday(), where Mon=0, Tue=1 … Sun=6, and the serializer help_text (serializers.py:110) explicitly declares '0=Lunes … 6=Domingo'. So the frontend value for 'Lun' (1) matches backend Tuesday, and the whole selection is shifted one day: default Lun-Vie actually generates Tue-Sat (including an unwanted Saturday), and 'Dom' (0) generates Monday slots. Compounded by finding #4 (no in-console slot list), an admin cannot easily notice the wrong days were published. No test exists for the generator, so this shipped silently.  
**Done when:** Selecting Mon-Fri in the admin generator produces slots on Mon-Fri only. Frontend and backend agree on the weekday encoding (e.g. frontend WEEKDAYS uses Python's Mon=0..Sun=6, or the backend converts), and a regression test asserts a given weekday selection yields slots only on those exact dates.  
_Triage: added in triage — auditor missed this. Verified end-to-end: no conversion between the frontend button values and the request body, and the two ends use different weekday origins. Off-by-one is real and hits the default path._  

**13. Admin console cannot view, edit, deactivate, or delete published availability slots**  
`UI/UX` - status: _incomplete_ - evidence: `frontend/src/pages/admin/AdminBookings.tsx:38-169 (SlotGenerator only calls generateSlots); backend/apps/bookings/urls.py:7 & 13-14 (only availability POST generate + admin bookings list/action — no slot list/update/delete route)`  
The 'Publicar disponibilidad' card can only bulk-CREATE slots (SlotGenerator calls generateSlots only). urls.py exposes only availability POST (generate) plus the public availability GET — there is no slot list/detail/update/delete endpoint. So the styled admin console cannot show which slots are published, how full each is, edit a slot's capacity/time, or deactivate/delete a slot. A mistaken bulk generation (wrong range/capacity — or the wrong weekdays per the mismatch finding) can only be undone via the developer-facing Django/Unfold AvailabilitySlotAdmin, not the school-facing console.  
**Done when:** The admin bookings page lists upcoming availability slots with date/time/capacity/booked-count/active status and lets an admin toggle is_active and delete/edit a slot (backed by slot list + update/delete endpoints), so a mistaken bulk generation can be reviewed and undone without dropping to the Django admin.  
_Triage: Evidence holds. Publish works, manage does not, in the styled console. Django admin fallback exists (AvailabilitySlotAdmin) so it is not a full blocker; major is honest given the operational impact for go-live, made worse by the weekday mismatch above._  

**14. Admin booking endpoints (list, status actions, slot generation) have zero test coverage**  
`Test` - status: _missing_ - evidence: `backend/apps/bookings/tests.py:1-240 (no reverse('bookings-admin-list'), 'bookings-admin-action', or AvailabilityView POST tests present)`  
tests.py covers the public path thoroughly (capacity race, cancel frees slot, owner/IDOR access control, calendar fail-soft, past-slot guard, open-school signup) but has NO test that reverses 'bookings-admin-list' or 'bookings-admin-action', and no AvailabilityView POST (generator) test. Untested: AdminBookingsView permission gating + filters; AdminBookingActionView (confirm sends email + creates calendar event once via confirmation_sent guard; cancel deletes event; attended/no_show transitions; the 'Acción no válida' 400 branch); and the slot generator (weekday stepping, get_or_create dedupe, end_date<start_date and window_end<=window_start validation). These mutate state and fire email/calendar side effects and are IsAdmin-only. The weekday mismatch bug above is exactly the kind of regression this missing coverage let ship.  
**Done when:** Tests cover: non-admin 403 / admin 200 on the admin list and action endpoints; each action ('confirm','cancel','attended','no_show') sets the expected status (confirm triggers confirmation_sent once, cancel is idempotent-safe); an invalid action returns 400; and the generator produces the expected count for a given weekday/window/interval on the correct calendar days, skips duplicates on re-run, and rejects end_date<start_date and window_end<=window_start.  
_Triage: Confirmed by reading the full test file. No admin-facing or generator tests exist._  

### `portal-cms`

**15. Web-push never displays: service worker has no push/notificationclick handler**  
`UI/UX` - status: _broken_ - evidence: `frontend/vite.config.ts:14-58 (VitePWA in generateSW mode: no strategies:'injectManifest', no custom src/sw.ts); grep across frontend/src finds zero 'push'/'notificationclick'/'showNotification' listeners and no *sw*/*service-worker* source file; backend send path backend/apps/portal/push.py:35-68`  
Real, definite defect once push is configured: subscription is stored server-side and PushOptIn shows 'Notificaciones activadas', but the SW never calls self.registration.showNotification() so no OS notification appears and taps route nowhere.  
**Done when:** A service worker with a 'push' listener that parses {title, body, url} and calls showNotification, plus a 'notificationclick' handler that focuses/opens url — via injectManifest + custom src/sw.ts (or a registered companion SW). Verified end-to-end: a push to a subscribed device shows an OS notification and clicking opens the given portal route. VAPID config documented as a deploy prerequisite.  
_Triage: Evidence holds: the SW is stock Workbox precache/runtime-cache with no push event or notificationclick handler, so a delivered push wakes the SW but nothing is ever shown. Downgraded blocker->major: the whole push feature is deploy-gated inert. push.ts:15-22 isPushSupported() returns false without VITE_VAPID_PUBLIC_KEY, so PushOptIn renders nothing and backend push_configured() is False without VAPID keys — nothing is visibly broken at go-live unless someone configures VAPID and turns push on, at which point subscribing shows a success toast but no notification ever displays (misleading). Not on a money/data path._  

**16. Publishing an announcement fans out nothing (no in-app/email/push to the audience)**  
`Backend` - status: _incomplete_ - evidence: `backend/apps/portal/views.py:149-150 (perform_create only saves created_by); grep shows notify() callers are only cafeteria/finance, never Announcement; no apps/portal/signals.py; PushOptIn.tsx:44 promises 'comunicados en este dispositivo'`  
AnnouncementAdminListCreateView.perform_create just persists the row; nothing enqueues delivery to the resolved audience.  
**Done when:** Publishing/activating an active announcement enqueues delivery to the resolved audience: a Notification per eligible user and best-effort email + web-push, respecting the audience filter (all/parents/students/staff) and skipping inactive ones. Fan-out is fail-soft (never blocks the save) and idempotent (re-activating doesn't re-notify). Covered by a test asserting recipients per audience.  
_Triage: Evidence holds. Announcements are surfaced only passively (dashboard/list on login). No Notification rows, no email, no push are produced on publish/activate — even email, a configured channel, never fires for comunicados. For time-sensitive notices ('Suspensión de clases') families who don't log in miss them, and the push opt-in copy promise is unfulfilled. Contrast cafeteria/finance which route through portal.services.notify()._  

### `integrations`

**17. Global Payments hosted checkout is a sandbox placeholder — no real HPP session is created**  
`Integration` - status: _incomplete_ - evidence: `backend/apps/payments/gateways/global_payments.py:26-42 (create_checkout builds a query-string URL, falling back to FRONTEND_URL/pago/simulado when GLOBAL_PAYMENTS_HPP_URL is unset); default GLOBAL_PAYMENTS_HPP_URL='' in settings; the mock settle endpoint SandboxCompleteView is DEV-ONLY (backend/apps/payments/views.py:207-229, returns 404 unless DEBUG/SQLITE_LOCAL).`  
create_checkout calls no Global Payments SDK/HPP-session API; it deterministically assembles a redirect URL. With no live GLOBAL_PAYMENTS_HPP_URL it points the browser at the local mock /pago/simulado. Critically, in production (no DEBUG/SQLITE_LOCAL) the sandbox settle endpoint returns 404, so a parent redirected to the mock cannot settle anything — online card payment is entirely non-functional until credentials + a real HPP-session call are wired. The webhook HMAC-SHA256 verification (gateways/base.py:83-97) is real and production-ready. Config/credential-gated (GLOBAL_PAYMENTS_APP_ID/APP_KEY/HPP_URL pending merchant onboarding).  
**Done when:** create_checkout provisions a real Global Payments HPP session using GLOBAL_PAYMENTS_APP_ID/APP_KEY and returns the provider-hosted URL when creds are present; the /pago/simulado fallback is gated to DEBUG/SQLITE_LOCAL only (never reachable in prod); an integration test or documented sandbox run confirms redirect + signed webhook settles a Payment.  
_Triage: Verified against code; evidence holds. Kept major — this blocks all online payment until creds are wired, but it is credential-gated per the go-live known-pending list, not a code bug. Added detail: the sandbox settle path is already DEBUG/SQLITE_LOCAL-gated (returns 404 in prod), so the mock cannot even complete a payment in production._  

**18. Banorte 'Pago en Línea' hosted checkout uses a placeholder sandbox URL — no live checkout wired**  
`Integration` - status: _incomplete_ - evidence: `backend/apps/payments/gateways/banorte.py:16 (_DEFAULT_CHECKOUT_URL='https://gateway.sandbox.banorte.com/pagos/checkout') and :26-42 (falls back to FRONTEND_URL/pago/simulado when BANORTE_CHECKOUT_URL unset); default BANORTE_CHECKOUT_URL='' in settings.`  
Same shape as Global Payments: create_checkout only assembles a query-string redirect and, with no BANORTE_CHECKOUT_URL/BANORTE_MERCHANT_ID configured, sends the browser to the local mock /pago/simulado (which cannot settle in prod — SandboxCompleteView 404s outside DEBUG/SQLITE_LOCAL). The hardcoded host is a sandbox placeholder until Banorte merchant credentials are provisioned. Webhook HMAC verification and status mapping (incl. ISO-8583 '00') are real. Explicitly on the audit's known-pending list.  
**Done when:** BANORTE_CHECKOUT_URL/BANORTE_MERCHANT_ID/BANORTE_WEBHOOK_SECRET set to live values and create_checkout targets the real Banorte checkout endpoint when configured; sandbox-to-live smoke test confirms redirect + signed webhook settles a Payment; /pago/simulado fallback reachable only in DEBUG/SQLITE_LOCAL.  
_Triage: Verified; evidence holds. This one is explicitly named in the go-live known-pending list (Banorte placeholder sandbox URL until merchant creds are wired). Kept major/incomplete, config-gated._  

### `public-site`

**19. Contact email domain is inconsistent (interlaken.com.mx vs interlaken.edu.mx)**  
`UI/UX` - status: _works-but-rough_ - evidence: `ContactPage.tsx:25-27 DIRECTORY = preescolar@/primaria@/secundaria@interlaken.com.mx; AvisoPrivacidadPage.tsx:125 'Ejercerlos' = colegio@interlaken.com.mx while the SAME page's error state at :116 says colegio@interlaken.edu.mx; siteContact.ts:14 default contact_email = colegio@interlaken.edu.mx; siteMeta.ts:38 ORG.email = colegio@interlaken.edu.mx.`  
Two different school email domains ship across the public site. The per-level admissions directory and the ARCO/'Ejercerlos' contact use @interlaken.com.mx; the site-settings default, structured data, and the Aviso's own fallback message use @interlaken.edu.mx. The Aviso de Privacidad page contradicts itself line-to-line (116 .edu.mx vs 125 .com.mx). Whichever domain is not a real monitored mailbox means admissions/ARCO mail bounces — direct lead loss for a school at go-live.  
**Done when:** One canonical domain chosen and used everywhere (mailboxes confirmed to receive); no page mixes .com.mx and .edu.mx; the three per-level directory addresses and the ARCO contact resolve to real, monitored inboxes.  
_Triage: Evidence holds exactly. Kept at major: mailto links technically work, but a page contradicting its own domain plus three hardcoded directory addresses on a non-canonical domain is a real deliverability/lead-loss risk, not cosmetic. Cannot verify from code which mailbox is real — that requires the owner._  

## Minor (25)

### `auth-accounts`

**20. No test coverage for CurrentUserView (/accounts/me/) GET or PATCH**  
`Test` - status: _missing_ - evidence: `backend/apps/accounts/test_auth.py (no /me/ or current-user tests); grep 'current-user|/me/|CurrentUser|RetrieveUpdate' across accounts test files returns nothing`  
**Done when:** Tests asserting: authenticated GET returns the caller's serialized user; anonymous GET is 401; PATCH updates first_name/whatsapp; PATCH attempting email or role is ignored (fields stay read-only per serializers.py:12).  
_Triage: Confirmed absent. /accounts/me/ authorizes the whole SPA (hit on every bootstrap and login). No test asserts the authenticated GET, the anonymous-401, the PATCH update, or that email/role stay read-only — a regression loosening read_only_fields would ship silently._  

**21. Unrestricted Google self-provisioning — any verified Google email gets a parent account + portal session**  
`Backend` - status: _works-but-rough_ - evidence: `backend/apps/accounts/views.py:137-143 (GoogleCallbackView get_or_create, role=PARENT default); views.py:196-202 (GoogleTokenView get_or_create)`  
**Done when:** Google login either only matches pre-existing/invited users (no auto-create), or restricts auto-creation to an approved domain; unrecognized strangers are refused with a clear message instead of silently receiving a portal session. Covered by a test asserting a non-allowlisted new email is rejected.  
_Triage: Accurate, and the auditor's own severity (minor/works-but-rough) is honest — no inflation needed. Both Google entry points create a PARENT for ANY email_verified address with no domain allowlist or roster/invite check. Exposure is low (a parent with no linked children sees an empty portal), but it is open account creation on a school system and pollutes the user table._  

### `admissions`

**22. RegisterPage.finish() re-uploads every document on retry → duplicate RegistrationDocument rows**  
`UI/UX` - status: _works-but-rough_ - evidence: `frontend/src/pages/public/RegisterPage.tsx:177-203 (finish: updateRegistration → for-loop uploadDocument → submitRegistration, single try/catch); backend DocumentUploadView.post always RegistrationDocument.objects.create (views.py:447-453); RegistrationDocument.Meta (models.py:178-180) has NO unique_together — dup rows are possible.`  
If one upload in the loop throws, the earlier successes aren't tracked; clicking 'Enviar inscripción' again re-uploads them, producing duplicate rows. The applicant also gets no per-file indication of which document failed.  
**Done when:** Uploads are idempotent on retry: track which docType already uploaded and skip it, or upload each file with its own try/catch surfacing a per-file error. No duplicate RegistrationDocument rows from a retried submit.  
_Triage: Real gap, severity overstated. The backend-dedup and no-per-file-error claims hold (verified: no unique_together, generic catch). But impact is bounded: documents are all optional, the medical PATCH and submit are idempotent (submit 400s once status!=DRAFT), and the only artifact is duplicate optional-doc rows an admin sees after a mid-loop upload failure + manual retry. Not 'broken' on the happy path — downgraded major→minor / works-but-rough._  

**23. No client-side file-size / type guard before upload; user gets an opaque failure**  
`UI/UX` - status: _works-but-rough_ - evidence: `frontend/src/pages/public/RegisterPage.tsx:450 (input accept='.pdf,.jpg,.jpeg,.png' only) and finish() upload loop 192-194; backend cap at views.py:440-445 (MAX_DOCUMENT_UPLOAD_SIZE=10MB, base.py:391).`  
onPick performs no size validation; a large phone photo triggers a backend 400 that surfaces as the generic 'No se pudo enviar la inscripción' toast with no mention of the limit or which file.  
**Done when:** onPick rejects files over 10MB (and non-allowed extensions) at selection time with an inline message naming the limit, so the file never reaches the submit loop.  
_Triage: Evidence holds — FileRow does no size check and finish() uploads blindly, so a >10MB photo surfaces only as the generic toast (compounded by the retry issue above). Severity minor is honest._  

**24. Email notifications are never asserted by any admissions test despite five mail paths**  
`Test` - status: _missing_ - evidence: `grep of backend/apps/admissions/test_*.py for mail.outbox/outbox → zero hits. Senders: _send_confirmation/_notify_admin (views.py:101-129), _email_invite (192-206), submit confirmation (395-406), _email_outcome (255-271) — all fail_silently=True. test_registration_admin.py:98-106 patches to 'approved' but never checks outbox.`  
The approve-path test asserts status/notes but not that exactly one outcome email fires; no test covers the notes-only PATCH firing zero emails, nor the pre-register/invite/submit confirmations.  
**Done when:** Tests assert mail.outbox after a pre-register POST (confirmation + admin), an invite POST, a submit POST, and a status PATCH to approved/rejected (exactly one outcome email) vs a notes-only PATCH (zero outcome emails).  
_Triage: Evidence holds. Because every send is fail_silently=True, a wrong recipient, template crash, or mis-gated trigger (e.g. outcome email firing on a notes-only re-save) would pass CI silently. Minor severity — these are notifications, not data integrity._  

**25. Registration review modal never surfaces privacy / photo-media consent record**  
`UI/UX` - status: _incomplete_ - evidence: `frontend/src/components/admin/RegistrationReviewModal.tsx:102-134 renders status/student/guardians/emergency/medical/documents but no consent fields; the Reg interface (lines 20-29) omits privacy_accepted_at entirely; serializer exposes consent_photos_media + privacy_accepted_at (serializers.py:177).`  
The payload carries the compliance record but the modal shows none of it.  
**Done when:** The modal shows a consent block: privacy accepted (with date/notice version) and photo-media consent yes/no.  
_Triage: Evidence holds — the modal ignores consent_photos_media and privacy_accepted_at (the latter isn't even in the TS type, so it's dropped). Admissions staff cannot evidence the LFPDPPP privacy acceptance or photo-media authorization from the review UI. Minor._  

**26. child_dob accepts future / implausible dates on both public forms**  
`Backend` - status: _incomplete_ - evidence: `PublicPreRegistrationSerializer.child_dob = DateField() with no validator (serializers.py:37); RegistrationSerializer child_dob is the model DateField, writable, no bound (serializers.py:171, models.py:95); frontend date inputs RegisterPage.tsx:311 / PreRegisterPage.tsx:110 set no max.`  
Required field with no bounds on either the pre-registration or registration path.  
**Done when:** Serializers reject a child_dob in the future (optionally outside a sane school-age window) with a field error; the date inputs set max=today.  
_Triage: Evidence holds — no serializer validator or input max anywhere. A future/typo'd DOB is stored verbatim and any downstream age/grade derivation is wrong. Data-quality gap, minor._  

**27. Non-invited step-1 failure after create leaves an orphan draft and duplicates on retry**  
`UI/UX` - status: _works-but-rough_ - evidence: `frontend/src/pages/public/RegisterPage.tsx:141-148 — createRegistration then exchangeAccess; regId/session set only after BOTH succeed. On exchangeAccess failure the catch (150-152) shows a generic toast and regId stays null.`  
Accumulates junk draft Registration rows that appear in the admin Inscripciones list.  
**Done when:** On a step-1 retry the existing draft is reused (capture regId right after create, or make create+exchange atomically retried) so repeated failures don't spawn multiple drafts.  
_Triage: Evidence holds. If exchangeAccess throws, the just-created draft is orphaned and pressing 'Siguiente' again re-calls createRegistration → another orphan draft each retry. Failure window is narrow (exchange runs immediately after create with the returned token), so minor / works-but-rough is right._  

**28. Submit-time medical-consent gate omits estatura/peso encrypted fields**  
`Backend` - status: _incomplete_ - evidence: `backend/apps/admissions/views.py:387 has_medical = any([reg.blood_type, reg.allergies, reg.medical_notes]) — excludes estatura & peso, which ARE EncryptedTextField medical fields (models.py:123-124) and ARE in MEDICAL_FIELDS for read-gating (serializers.py:162).`  
The read-side gate and the submit-side gate use different field lists for what counts as medical data.  
**Done when:** has_medical includes estatura and peso (ideally derived from the serializer's MEDICAL_FIELDS) so any populated health field requires consent_medical_data at submit.  
_Triage: Added in triage. The submit-time consent_medical_data check (views.py:386-391) treats estatura/peso as non-medical, so a caller who sets those two encrypted health fields (via the API — the current UI doesn't collect them) can submit without MEDICAL_DATA consent, contradicting the B4 gating those same fields get on read. Low impact today but an internal inconsistency in the LFPDPPP consent gate. Minor._  

### `cafeteria`

**29. Top-up 'Máximo $2,000' is advisory only — larger amounts submit successfully**  
`UI/UX` - status: _works-but-rough_ - evidence: `frontend/src/pages/parent/CafeteriaPage.tsx:204 copy 'Mínimo $50 · Máximo $2,000' and input max=2000 (line 198); submit guard checks only the floor: disabled={!topupAmount || parseFloat(topupAmount) < 50} (line 247). HTML max does not block typing. Serializer ceiling is 50000 (serializers.py:50).`  
**Done when:** Submit is disabled with an inline message when the amount is below $50 or above the stated maximum, and the stated maximum matches what is enforced client- and server-side.  
_Triage: Confirmed. A typed 5000 passes the guard and the serializer accepts it (max 50000). Copy and enforcement disagree. Minor is honest — for online top-ups the actual charge is what the parent authorizes at the gateway, so it is a UX/consistency defect, not money-wrong._  

### `finance-payments`

**30. Duplicate serializer class definitions silently shadow the first pair**  
`Backend` - status: _works-but-rough_ - evidence: `backend/apps/finance/serializers.py:10 & 128 (FeeScheduleSerializer), :20 & 136 (DiscountSerializer).`  
Delete the shadowed first definitions (lines 10-26); keep the intended fields on the single surviving definition, deciding whether created_at/updated_at should be exposed.  
**Done when:** Exactly one FeeScheduleSerializer and one DiscountSerializer in the module, with the intended field set (kind_display retained).  
_Triage: Evidence holds. Python binds the second definition, so the effective FeeScheduleSerializer drops 'updated_at'+read_only_fields and the effective DiscountSerializer drops 'created_at'/read_only_fields (but gains kind_display, which is the version the frontend relies on). No runtime bug today (auto_now/read-only fields aren't writable anyway), but editing the top definition is silently dead — a maintenance landmine. Minor is correct._  

**31. Bulk 'remind' action reminds already-paid/cancelled invoices ($0.00 saldo)**  
`Backend` - status: _works-but-rough_ - evidence: `backend/apps/finance/views.py:312-326 — AdminBulkActionView filters invoices by pk__in=ids only, then the 'remind' branch (320-326) fans out a WhatsApp/email notice with '...tiene un saldo de ${invoice.balance_due:.2f}' unconditionally. No is_settled / status guard, unlike send_payment_reminders (services.py:252-253) which skips settled invoices.`  
In the 'remind' branch, skip invoices where invoice.is_settled or status in (PAID, CANCELLED) (count them separately or as skipped), mirroring send_payment_reminders.  
**Done when:** Bulk 'remind' on a set that includes paid/cancelled invoices sends reminders only to invoices with an outstanding balance; a test asserts a paid invoice in the set receives no reminder.  
_Triage: added in triage. If an admin bulk-selects a range and clicks 'remind', PAID invoices (balance_due 0) and CANCELLED invoices get a parent-facing 'le recordamos que ... tiene un saldo de $0.00' WhatsApp — an embarrassing wrong-dunning message. mark_paid/cancel branches guard via ValueError, but remind has no guard and still counts as done. Minor._  

### `bookings`

**32. Admin console shows no visit-type column/filter and lists open_class bookings despite claiming 'individual visits only'**  
`UI/UX` - status: _works-but-rough_ - evidence: `frontend/src/pages/admin/AdminBookings.tsx:52 (visit_type:'individual' hardcoded), :221-231 (getAdminBookings sends no type), :327-336 (table has no visit-type column), :247-250 & 253 (copy 'visitas individuales'); backend/apps/bookings/views.py:204-206 (?type supported)`  
The generator hardcodes visit_type:'individual' (AdminBookings.tsx:52), and the page copy now scopes itself to individual visits ('gestione las visitas individuales', 'para visitas individuales') — so the generator being individual-only is consistent with the copy, NOT a defect. The remaining real gap: the bookings table sends no ?type filter, so it lists BOTH individual and open_class bookings mixed together with no visit-type column, badge, or filter to distinguish them — contradicting the page's individual-only framing. The backend already supports ?type= (views.py:204-206) which the UI never exposes.  
**Done when:** Either the admin table filters to individual bookings (send ?type=individual) to match the page copy, or it adds a visit-type badge/column and a type filter wired to the existing ?type= param.  
_Triage: Overstated. The generator being individual-only is now consistent with the page copy, so 'conflates visit types' is half-wrong. The genuine residual gap is that the table still surfaces open_class bookings with no type indicator/filter while the page claims to manage individual visits. Downgraded to minor._  

**33. Dead frontend getBooking/cancelBooking methods; no self-service booking management (by design, copy is honest)**  
`UI/UX` - status: _incomplete_ - evidence: `backend/apps/bookings/views.py:153-195 (auth + email-match); frontend/src/services/api.ts:402-406 (getBooking/cancelBooking) unused — grep found only these definitions; backend/apps/bookings/services/notifications.py:46-47 & services/ics.py:69 ('comuníquese con el colegio' — contact-only)`  
Public bookings are created with no user account, while BookingDetailView/BookingCancelView require IsAuthenticated and match the account email to booking.parent_email (views.py:153-195) — so only a parent who happens to own a portal account with the identical email can view/cancel via API (verified by BookingAccessControlTests). getBooking/cancelBooking exist in api.ts (402-406) but are imported/called by NO component (grep-confirmed: only definitions). However the auditor's 'advertised self-service cancel path' framing is wrong: the confirmation email (notifications.py:46-47) and the .ics (ics.py:69) both tell the parent to contact/reply the school to cancel or reschedule — they do NOT promise self-service. So the copy already matches reality; the only concrete actionable remnant is the two dead client methods (wire up a manage-booking page or remove them).  
**Done when:** Either a tokenized emailed manage-booking link opens a frontend page that hits a token-authorized cancel endpoint, OR the unused getBooking/cancelBooking client methods are removed and the contact-only cancellation copy is left as the single source of truth.  
_Triage: Overstated to major. No false advertising — email/ics already say cancellation is by contacting the school. Endpoints work for portal-account owners (tested). Real residual = dead api.ts methods + no anonymous manage-booking flow (a product choice, not a bug). Downgraded to minor._  

**34. Reschedule feature is unbuilt: no endpoint/UI, and calendar.update_event is dead code**  
`Backend` - status: _missing_ - evidence: `backend/apps/bookings/services/calendar.py:144-167 (update_event — grep-confirmed zero callers in backend); backend/apps/bookings/urls.py (no reschedule path); notifications.py:46-47 & ics.py:69 ('reprogramar … comuníquese con el colegio')`  
calendar.update_event() (calendar.py:144-167) exists to patch an event's date/time on reschedule but has ZERO callers (grep across backend returns only the def). There is no reschedule endpoint in urls.py and no admin or parent UI that moves a booking to a different slot. The confirmation email and .ics both mention 'reprogramar' but immediately direct the parent to contact the school — so, contrary to the auditor's note, the copy does NOT promise self-service rescheduling; it is already honest. The concrete residual is the unused update_event helper plus an unimplemented feature surface.  
**Done when:** Either a reschedule action exists (endpoint + admin/user UI that reassigns the slot atomically, frees the old slot's capacity, calls calendar.update_event, and re-notifies), covered by a test; or the dead update_event helper is removed.  
_Triage: Real but the 'copy promises reschedule' half is wrong — copy says contact the school. Minor is correct. Actionable items reduce to: implement reschedule end-to-end, or remove the dead update_event helper._  

### `portal-cms`

**35. 'Marcar todas' issues N individual PATCH requests; no bulk mark-read endpoint**  
`UI/UX` - status: _works-but-rough_ - evidence: `frontend/src/components/layout/NotificationsMenu.tsx:44-49 (Promise.all over each unread, markAll has no onError); backend exposes only /notifications/<pk>/read/ (backend/apps/portal/urls.py:15)`  
Burst of N round-trips on mark-all; single failure silently leaves some unread.  
**Done when:** A single POST/PATCH endpoint (e.g. /notifications/mark-all-read/) marking all the caller's unread notifications read in one query, with the menu calling it once and showing an error toast on failure.  
_Triage: Evidence holds. markAll maps each unread to a separate PATCH fired in parallel; the mutation has no onError so a partial failure leaves a partially-read state with no user feedback. No bulk mark-all endpoint exists._  

**36. Dashboard endpoint returns an empty payload for a pure STAFF user (and for a parent with no linked students)**  
`Backend` - status: _works-but-rough_ - evidence: `backend/apps/portal/views.py:40-119 — branches cover PARENT/STUDENT-with-family (48), STUDENT (86), ADMIN (100); STAFF and a PARENT whose family_students is empty both fall through to data={} + common announcements/unread`  
No STAFF branch and no fallback for a childless parent; both get {} plus announcements + unread count.  
**Done when:** Either meaningful branches (or a documented redirect/pointer to /staff for STAFF) and a friendly empty-family state for childless parents, or an explicit documented decision with the frontend routing these roles away from this endpoint.  
_Triage: Evidence holds and scope is slightly broader: not only a pure STAFF account but also a PARENT with no linked StudentProfile lands on data={} because the first branch requires family_students.exists(). Impact low (staff have /staff), but the family dashboard route returns a near-empty object for these accounts._  

**37. Site-settings editor shows only a generic error toast on validation failure**  
`UI/UX` - status: _works-but-rough_ - evidence: `frontend/src/pages/admin/AdminSettings.tsx:35 (onError -> single generic toast 'No se pudieron guardar los ajustes'); URL inputs (maps_url/facebook_url/instagram_url/youtube_url, lines 61,69-71) have no type/pattern; only contact_email uses type='email'; backend AdminSiteSettingsSerializer validates URLField/EmailField`  
Invalid URL/email PATCH returns 400 but UI gives no actionable per-field feedback.  
**Done when:** Field-level error state on each input driven by the 400 response body (per-field messages), and/or client-side URL/email validation before submit, so the admin can see and fix the offending field.  
_Triage: Evidence holds. A 400 with per-field errors collapses to one generic toast; no field is highlighted and the serializer message is not shown. URL fields also lack client-side validation, so the admin gets no inline guidance on which field is wrong._  

**38. No test coverage that a published announcement reaches its audience**  
`Test` - status: _missing_ - evidence: `backend/apps/portal/test_announcements_admin.py (CRUD/toggle/permissions only); test_push.py:60-66 asserts only that notify() invokes webpush for a direct call, not that announcements notify anyone`  
Admin announcement tests verify CRUD/permissions but nothing about delivery to the audience.  
**Done when:** A test creating an active announcement for a specific audience asserting the correct set of recipients get Notification rows (and best-effort email/push) while users outside the audience get none, plus an inactive announcement produces no fan-out.  
_Triage: Evidence holds; this is a direct consequence of the missing fan-out (finding #2) — there is no delivery path to test today. Must be covered once fan-out is implemented._  

### `integrations`

**39. Finance WhatsApp reminders are inert — notify(whatsapp=True) only logs, never routes to the working Cloud API sender**  
`Integration` - status: _incomplete_ - evidence: `backend/apps/portal/services.py:79-81 (whatsapp branch only logs 'not yet enabled'); callers backend/apps/finance/services.py:266 & :281 and finance/views.py:326 pass whatsapp=True via _notify_invoice (finance/services.py:551-559). A working fail-soft Cloud API sender exists: backend/apps/whatsapp/services.py send_text/_post (gated on WHATSAPP_TOKEN/WHATSAPP_PHONE_ID).`  
notify(..., whatsapp=True) creates the in-app Notification and emails the guardian, then merely logs the WhatsApp intent; it never calls whatsapp.services.send_text. So the WhatsApp channel for tuition pre-due/overdue reminders and the admin bulk 'remind' action does nothing. Docstrings (portal/services.py:8-9,56) explicitly mark this as a deferred 'Prompt 14' placeholder. No data/money impact — email + in-app still deliver.  
**Done when:** Either (a) notify() routes whatsapp=True through whatsapp.services.send_text addressed to user.whatsapp (fail-soft like email), with a test asserting a send is attempted when creds are configured; or (b) remove the whatsapp=True flag from all callers and delete the dead branch so no caller believes WhatsApp is sent.  
_Triage: Core gap CONFIRMED (whatsapp branch only logs; callers expect delivery). But the auditor's evidence is partly wrong: a guardian wa_id IS stored — User.whatsapp (accounts/models.py:50), so 'nowhere to address a message' is false and wiring is a small change. Downgraded major→minor: it is a deliberately deferred, documented feature and email + in-app already notify families; no functional break at go-live._  

### `public-site`

**40. Static index.html SEO description + JSON-LD hardcode a stale '40 años' (rendered app computes 45)**  
`UI/UX` - status: _works-but-rough_ - evidence: `index.html:15 meta description and index.html:30 JSON-LD description both hardcode '40 años de trayectoria'; siteMeta.ts:17-18 SCHOOL_YEARS = year - 1981 = 45 in 2026; DEFAULT_DESCRIPTION (:29-30) and rendered pages use SCHOOL_YEARS.`  
Non-JS crawlers/social scrapers reading the raw HTML get '40 años' in both the primary meta description and the LocalBusiness structured data, while the React-rendered content and runtime Helmet description say 45. Founded 1981 so 45 is correct in 2026; the static value is wrong today and drifts further each year.  
**Done when:** Static index.html meta description and JSON-LD omit the fixed year count (or are generated in sync with SCHOOL_YEARS), so crawlers and the rendered page present the same current number.  
_Triage: Evidence holds. Severity minor is correct — SEO/social-preview accuracy, not a functional break._  

**41. Instagram social icon renders a dead href="#" link (target=_blank) when the profile URL is not configured**  
`Integration` - status: _incomplete_ - evidence: `PublicLayout.tsx:147-149 displaySocials appends {key:'instagram', href: settings.instagram_url || '#'} whenever Instagram isn't already present; rendered in the preheader (177-188) and footer (339-353) with target="_blank". SITE_DEFAULTS.instagram_url = '' (siteContact.ts:20), and socialEntries() (siteContact.ts:36-43) correctly filters empty URLs — PublicLayout deliberately overrides that filter for Instagram only.`  
With the Instagram URL still pending from the client, the icon shows on every public page in both preheader and footer, and because href='#' has target='_blank', clicking opens a blank new tab pointing at the current page — a visibly broken affordance. Facebook/YouTube correctly hide when unset.  
**Done when:** Either the client Instagram URL is wired into site settings, or the icon is hidden until a real URL exists (matching Facebook/YouTube). No social icon ever renders href="#", and none uses target=_blank without a real destination.  
_Triage: Evidence holds. Code comment (PublicLayout.tsx:144-145) shows this is a deliberate 'show Instagram always until client delivers URL' request, so the missing URL itself is config/credential-gated (report as integration/incomplete). But the href='#' + target=_blank fallback is a real broken control regardless of the URL — the fix (hide until real URL, or never emit href='#') is independent of the client deliverable._  

**42. Costos page shows two empty card shells when the CMS returns zero cost rows**  
`UI/UX` - status: _incomplete_ - evidence: `CostosPage.tsx:32 rows = data ?? []; the two cards at :77-86 and :100-107 both map over rows with no length guard; only isError (:57-61) and isLoading (:62-66) branches short-circuit.`  
A successful fetch returning an empty array — the expected state at go-live before admin publishes costs — renders both card headers ('Inscripción y reinscripción', 'Colegiaturas') over empty lists, so the visitor sees two blank boxes with no explanation. Loading and error states are handled; the empty state is not.  
**Done when:** When rows.length === 0 the page shows a friendly 'costos por publicar / contáctenos' message instead of empty cards, and the info note + CTA still render.  
_Triage: Evidence holds; severity minor is correct._  

**43. Cookie consent 'Más información' link points to /contacto instead of the privacy notice**  
`UI/UX` - status: _works-but-rough_ - evidence: `CookieConsent.tsx:50 — 'Más información' is <Link to="/contacto">; the Aviso de Privacidad (which covers data/cookie use under LFPDPPP) already exists at /aviso-de-privacidad (route present in siteMeta.ts:104 and linked from the footer, PublicLayout.tsx:407).`  
The banner's 'more information' link, which should reach the document describing what data is collected and how, instead opens the contact form. UX mismatch that weakens the consent/transparency posture the banner exists to provide.  
**Done when:** 'Más información' links to /aviso-de-privacidad, where cookie/data-use details live.  
_Triage: Evidence holds; severity minor is correct._  

**44. Static index.html JSON-LD sameAs hardcodes placeholder bare-domain social URLs**  
`UI/UX` - status: _works-but-rough_ - evidence: `index.html:46-50 sameAs = ['https://facebook.com','https://instagram.com','https://youtube.com'] (generic homepages, not school profiles). The runtime graph does this correctly: siteMeta.ts:47-49 ORG.sameAs = [] and organizationJsonLd() (:141) emits the empty list, so the home page injects a second School/@id graph whose sameAs is empty while the static one carries the placeholders.`  
The static structured data the crawler sees first claims the school's social profiles are the bare facebook/instagram/youtube homepages — false references Google may flag, and they also conflict with the runtime JSON-LD (same @id '#organization', different sameAs). The real Facebook URL exists in site settings (siteContact.ts:19) but is never fed into the static markup.  
**Done when:** index.html JSON-LD sameAs either omits socials or lists only real, confirmed profile URLs; the static and runtime organization graphs agree (single source of truth), and no placeholder bare-domain social URLs ship.  
_Triage: Added in triage — auditor missed it. Same file/area as finding #2 (static index.html drift). Minor SEO/structured-data correctness issue._  

## Polish (6)

### `auth-accounts`

**45. OAuth return shows the login form with no loading state while the session is minted**  
`UI/UX` - status: _works-but-rough_ - evidence: `frontend/src/pages/auth/LoginPage.tsx:30-43 (login=ok effect runs bootstrapSession→me→navigate, but the component still renders the full form meanwhile)`  
**Done when:** When params.get('login')==='ok', LoginPage renders a loading state (spinner / 'Iniciando sesión…') instead of the form until the redirect or the error toast resolves.  
_Triage: Confirmed. On ?login=ok the effect runs asynchronously while the full email/password form is still rendered; the returning user briefly sees (and could start typing into) the form before the redirect fires. Cosmetic only._  

**46. Logout only revokes the current device's refresh token — no sign-out-everywhere**  
`Backend` - status: _works-but-rough_ - evidence: `backend/apps/accounts/views.py:218-221 (LogoutView blacklists only the cookie's refresh token)`  
**Done when:** An optional logout-all that blacklists all outstanding refresh tokens for the user (or bumps a per-user token version), surfaced in the account menu.  
_Triage: Accurate and correctly rated polish. Standard SimpleJWT rotation behavior; other devices stay valid until their own refresh tokens expire. Given the shared student==family account model (LoginPage ROLE_PATHS), a 'cerrar sesión en todos los dispositivos' option is a reasonable nicety, not a go-live gap._  

**47. GoogleTokenView (credential/ID-token flow) is wired and tested backend-side but never called by the frontend**  
`Integration` - status: _works-but-rough_ - evidence: `backend/apps/accounts/api_urls.py:12 (google/token/ → GoogleTokenView); frontend grep for 'google/token|credential|id_token|googleToken' across frontend/src finds no caller (authApi.googleLogin uses the redirect flow to /auth/google/ only, api.ts:105-107)`  
**Done when:** Either a frontend caller exists (One-Tap button POSTing the credential to /accounts/google/token/), or the unused endpoint is removed; no orphaned public auth endpoint remains.  
_Triage: Added in triage. Not a defect — the endpoint is fully implemented, local-verifies the ID token, and is covered by TestGoogleTokenExchange — but it is dead frontend surface: the SPA only uses the server-side redirect flow. Either wire a Google One-Tap/credential button to it or drop the endpoint to reduce unused auth attack surface. Polish._  

### `admissions`

**48. Dead OpenSchoolDay model / admin / serializers left after migration to bookings**  
`Backend` - status: _incomplete_ - evidence: `OpenSchoolDay model (models.py:186-227); OpenSchoolDayAdmin registered (admin.py:49-57); OpenSchoolDaySerializer + OpenSchoolDayEventSerializer (serializers.py:207-223). The live views read bookings.AvailabilitySlot/Booking and use bookings.OpenClassEventSerializer (views.py:458-527) — the two local serializers are imported by NO view.`  
Legacy model/admin/serializers superseded by the unified bookings model but never removed.  
**Done when:** Unused OpenSchoolDay model/admin/serializers are removed (with a migration) or a comment documents why they're retained; the admin no longer surfaces the dead table.  
_Triage: Evidence holds. The Django admin still shows a 'Puertas Abiertas' table that can never receive data and the two serializers are unreferenced. Stale surface only — polish._  

### `cafeteria`

**49. Low-balance highlight uses strict < in parent view but <= everywhere else, and ignores the serializer's is_low_balance**  
`UI/UX` - status: _works-but-rough_ - evidence: `frontend/src/pages/parent/CafeteriaPage.tsx:139 recomputes locally with parseFloat(b.balance) < parseFloat(b.low_balance_threshold ?? '50'); admin uses <= (AdminCafeteria.tsx); model is_low_balance uses balance <= threshold (models.py:34). The serializer already exposes is_low_balance (serializers.py:25,29) which the parent card does not use.`  
**Done when:** The parent card consumes the backend-provided is_low_balance field (or at least uses <=), so low-balance status is identical across parent, admin, report, and alert surfaces.  
_Triage: Confirmed and slightly widened: the real issue is the parent recomputes the flag client-side with a stricter operator while the API already hands it is_low_balance. A balance exactly at threshold shows normal on the parent card but 'Saldo bajo' everywhere else. Polish._  

**50. Toggling 'Solo diferencias' silently clears reconciliation results**  
`UI/UX` - status: _works-but-rough_ - evidence: `frontend/src/pages/admin/AdminCafeteria.tsx:356-388 — ReconcileTab query keyed on onlyDrift with enabled:false; flipping the checkbox switches queryKey to an entry that was never fetched, so the view falls to the '!data' empty state ('Ejecuta la reconciliación').`  
**Done when:** Changing 'Solo diferencias' filters already-loaded results in place or transparently re-runs the query, never dropping the admin back to the pre-run empty state without feedback.  
_Triage: Confirmed. Kept at polish, but note it compounds finding 3: the discarded results can only be regenerated by re-running the expensive, potentially-timing-out reconcile. Applying the drift filter client-side to the full fetched result would fix both the blanking and the redundant remote work._  
