# Bitácora: requests from the school owner (WhatsApp, 2026-10-19/20)

Source: WhatsApp messages and screenshots from the school owner after
testing the live portal with a real family account and the admin console. Each point is checked against the code and, where it
is a bug, against the production logs.

Team view: **FE** frontend, **UX** design and copy, **BE** backend,
**DB** database, **PAY** Banorte integration, **OPS** server and configuration.

Priority: **P0** blocks go-live or is broken now · **P1** asked before go-live ·
**P2** improvement asked, can follow.

---

## A. Card top-up wizard (Recargar cafetería → step 2 "Método de pago")

Evidence: photos of step 2 with orange crosses and a green circle; messages at
11:49, 11:57, 13:29, 13:30, 13:35.

| # | Request | What changes | Team | Priority |
|---|---|---|---|---|
| A1 | Remove **"Pago en caja escolar"** (crossed out). "Only the first one." | Parents get one method: card. Step 2 becomes the card option plus the notices (or the step is folded into "Revisar"). Office top-ups stay in the admin console (cash at the POS is unchanged). | FE, UX | P1 |
| A2 | Remove the **"Tarjeta de crédito o débito / Visa · Mastercard · Pago seguro Banorte"** box (crossed out). | Drop that card from step 2. Keep the green "Se abrirá la ventana segura de Banorte…" note (not crossed). | FE | P1 |
| A3 | Rename the option: **"Pago en línea con tarjeta (Visa y Mastercard)"** instead of "(Banorte)". | Label change in the wizard, return page and receipts where "Banorte" is shown to families. | FE, UX | P1 |
| A4 | Under "El saldo se aplica mañana miércoles…", add **"No se acepta American Express."** | One extra sentence in the option description and in step 3 "Revisar". | FE, UX | P1 |
| A5 | "We don't accept American Express, only Visa or Mastercard. I don't know why the Banorte image has the Amex logo." | The logo is inside **Banorte's own window**: we cannot edit it. The manual says Amex needs its own affiliation, which the school does not have. Ask Banorte to hide Amex in the lightbox for afiliación 7069217; meanwhile A4 warns families. If an Amex card is tried, show "Tarjeta no aceptada: use Visa o Mastercard" instead of the generic decline. | PAY, FE | P1 |
| A6 | Remove the **"$1 (prueba)"** amount: "everything is working perfect". | Remove the tester floor (`TOPUP_TESTER_MIN_AMOUNT`, the `[1, …]` preset) so the minimum is $20 for everyone, and empty `PAYMENTS_TEST_EMAILS` in production. | FE, BE, OPS | P1 |

## B. Family portal, Pagos page (`/portal/pagos`)

| # | Request | What changes | Team | Priority |
|---|---|---|---|---|
| B1 | "On this page remove **Colegiaturas y boletas**" (green circle on the "PRÓXIMAMENTE" card). | Remove the card. Pagos keeps "Recargar cafetería" and the payment history. This reverses the 2026-10-13 "Próximamente" decision (bitácora punto 10). | FE | P1 |

## C. Notifications and email

Evidence: message at 12:01; production log 2026-10-20 shows family emails
going to the student address (`ci0XXXX@interlaken.com.mx`) and failing with
"please run connect() first".

| # | Request | What changes | Team | Priority |
|---|---|---|---|---|
| C1 | "Can parents add a **personal email for notifications**? Every notification goes to the student's email." | Yes. New optional field "Correo para avisos" on the family profile, confirmed by a verification link before use. Notifications go to the school address **and** the personal one. The profile is locked for edits (punto 10), so only this field is opened, with an audit row. | DB, BE, FE, UX | P2 |
| C2 | (Blocker for C1 and for all email) | Production SMTP is empty: no email is delivered today. Needs the sender mailbox login (`EMAIL_HOST`, `EMAIL_HOST_USER`, app password). | OPS | P0 |

## D. "Who paid?" (operations)

Evidence: messages at 12:04, 12:34 ("where can I check the students who paid??"),
13:21.

| # | Request | What changes | Team | Priority |
|---|---|---|---|---|
| D1 | "How do I know which parents made a payment yesterday, so I can apply them today?" | **Already built:** Cafetería → POS Loyverse → **Por aplicar** (student, Loyverse code, amount, folio, date) + **Aplicadas hoy**; also Depósitos → Estado "Pagada · por aplicar"; and the 7:05 portal notice. Make it findable: a **"Por aplicar hoy: N ($X)"** card on the admin Dashboard and the Cafetería badge linking straight to that queue. | FE, UX | P1 |
| D2 | "For now you see the student who paid, but it's nice to have **full info**." | Add the payer to the queue and its export: parent name, email, phone, payment date and time, card brand, bank reference and authorisation. | BE, FE | P2 |
| D3 | "When a parent pays it appears as **pendiente**; when I upload the balance to Loyverse it changes to **completed**, right?" | Yes. Correct flow: paid → **"Pagada · por aplicar"** → loaded in Loyverse → within 5 minutes **"Completado"** (applied). Unify the wording so no screen says "Pendiente" for a paid top-up (Pendiente = still paying in Banorte's window). | UX, FE | P1 |

## E. Bugs found

| # | Report | Root cause (verified) | Fix | Team | Priority |
|---|---|---|---|---|---|
| E1 | "I'm trying to access with colegio@interlaken.com.mx with Gmail… **Server Error (500)** just after selecting my mail." | Production log `/auth/google/callback/` 2026-10-20 13:05–13:12: `StringDataRightTruncation: value too long for type character varying(200)`. Google's profile-photo URL is longer than 200 characters and `User.avatar` is a 200-character field. Hits any Google account with a long photo URL. | Widen `avatar` (migration, e.g. 1000) and store it defensively (skip or truncate an over-long URL, never fail the login). Test with a 300-character URL. | DB, BE | **P0** |
| E2 | (found in logs) | 2026-10-20 13:16: `POST /cafeteria/admin/sync-all/` ("Sincronizar todos") — gunicorn worker **SIGKILL, out of memory**, twice. | Profile the request; run the heavy part as the existing cron path, return quickly, cap memory (stream the customer list). | BE, OPS | P1 |

## F. Banorte certification ("Estado" null)

Evidence: messages at 14:19, 17:01, 17:02, 17:13 and the state-code table at 17:25.

| # | Request | What changes | Team | Priority |
|---|---|---|---|---|
| F1 | Banorte: "In variable **Estado** they receive **null**. It's mandatory: the state where the card is issued; uppercase, two letters." | We send **no** cardholder billing data today. Manual v1.8 (Cybersource section) marks these as **required for every transaction**: `billToFirstName`, `billToLastName`, `billToStreet`, `billToStreetNumber`, `billToStreet2Col` (colonia), `billToStreet2Del` (municipio), `billToCity`, **`billToState` (2)**, `billToCountry` (2, `MX`), `billToPhoneNumber`, `billToPostalCode`, `billToEmail`, `billToIpAddress`. "Estado" is only the first one Banorte flagged. | PAY, BE | **P0** |
| F2 | State list (owner's table) | Whitelist exactly: AG, BC, BS, CM, CS, CH, CO, CL, **DF** (Ciudad de México), DG, GT, GR, HG, JA, **EM** (Estado de México), MI, MO, NA, NL, OA, PU, QT, QR, SL, SI, SO, TB, TM, TL, VC, YC, ZA. Server rejects anything else. | BE | P0 |
| F3 | Collect the data | New wizard step **"Datos del titular de la tarjeta"** (name as on the card, street, number, colonia, municipio, city, state dropdown, CP, phone, email), shown before Banorte opens. Saved per parent and pre-filled next time ("Usar mis datos guardados"). Mobile-first form, inline validation, lengths per manual (street 40, number 6, colonia 30, municipio 30, city 50, phone 15 digits, CP 10, email 100). | FE, UX | P0 |
| F4 | Store it safely | New table for the billing profile (per user), **encrypted at rest** like other personal data, covered by the privacy notice; never shown to staff in full; sent only inside the encrypted Banorte envelope. IP from the request (`billToIpAddress`). | DB, BE | P0 |
| F5 | "Every test with Banorte is OK, just waiting for final approval." | After F1-F4 ship, run one more PRD payment so Banorte sees the fields, then send the certification matrix. No other change needed at approval (cards are already open to all). | PAY | P0 |

## G. Go-live

"I guess with these changes the parents portal will be ready to deploy."
Go-live checklist from this bitácora: **E1, F1-F5, C2** (P0), then A1-A6, B1,
D1, D3, E2 (P1). C1 and D2 can follow.

---

## Proposed delivery

1. **PR 1 (P0, today):** E1 login fix + migration.
2. **PR 2 (P0):** Banorte cardholder data: F1-F5 (DB model, validation, wizard step, payload, tests with the manual's sample).
3. **PR 3 (P1):** wizard and Pagos cleanup: A1-A6, B1, D3 wording; D1 dashboard card.
4. **PR 4 (P1/P2):** E2 sync-all memory; D2 payer details; C1 personal notification email (after C2).
5. **OPS (school):** SMTP credentials (C2); ask Banorte to hide Amex (A5); vacations in Calendario.
