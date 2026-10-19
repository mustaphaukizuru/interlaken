# Banorte online payments

Banorte is the only payment gateway (decision of 2026-10-13; Global Payments was
removed). Families top up the cafetería wallet with a card inside Banorte's
**Ventana de Comercio Electrónico Cifrada** (VCE), integration manual v1.8
(24 March 2026; the encryption is unchanged since v1.7).
Card data, 3D Secure and the charge never touch our servers.

This document is the reference for engineers, for whoever runs the VPS and for
staff who verify payments.

## 1. How a payment flows

```
Parent          Our SPA                 Our API                       Banorte
  | Recargar ->  POST /cafeteria/topup/ -> Payment + BanorteCheckout
  |                                        params = RSA:::AES(JSON)  
  |             <- checkout{lightbox}  <-
  |             loads checkoutV2.js from multicobros.banorte.com
  |             Payment.startPayment(params) --------------------------> lightbox:
  |  card + 3DS inside Banorte's iframe ---------------------------->   charge
  |             <- onSuccess(response{data: AES(result)}) <---------------
  |             POST /payments/banorte/result/ -> decrypt data with stored key
  |                                              settle (top-up PAID, notify)
  |             -> /portal/cafeteria/recarga/retorno (shows the outcome)
  ...
Staff, 07:30 ->  type the amount into the student's Loyverse customer
  |             mirror_pos_topups (5 min / webhook) sees exactly that gap
  |                                              -> credit ledger, top-up COMPLETED, notify
```

**When the money reaches the wallet** (`CAFETERIA_TOPUP_APPLY_MODE`, default
`scheduled`, the school's rule since 2026-10-18). Loyverse points cannot be
written by API, so an approved card top-up does not touch the balance: it waits
as **Pagada · por aplicar** (`TopUpRequest.Status.PAID`) with the load time the
family was promised (`apply_due_at`: the next school day at
`CAFETERIA_TOPUP_APPLY_TIME`, 07:30; weekends, LFT statutory holidays and
school-wide "Suspensión de clases"/"Vacaciones" calendar entries are skipped;
a payment at least `CAFETERIA_TOPUP_APPLY_CUTOFF_MINUTES` before 07:30 on a
school day joins that same load). The family sees it under the balance as
"Recarga por aplicar" with the date, the folio (payment id) and a WhatsApp
button to `CAFETERIA_TOPUP_WHATSAPP` for same-day requests. The wallet is
credited once staff have typed it into the POS: the POS mirror applies it when
Loyverse shows exactly that amount, or staff press **Aplicar** (the server
first checks Loyverse holds it). Both use the same `topup-payment-<id>` ledger
key, so it is credited once. `instant` restores the previous behaviour (credit
on payment, load the POS afterwards). Code: `backend/apps/cafeteria/schedule.py`
and `apply_paid_topup` / `mirror_pos_topups` in `backend/apps/cafeteria/services.py`.

Code map:

| Piece | File |
|---|---|
| Envelope crypto (RSA-OAEP, PBKDF2, AES-CTR) | `backend/apps/payments/gateways/banorte_crypto.py` |
| Gateway: configuration, checkout, result interpretation | `backend/apps/payments/gateways/banorte.py` |
| One attempt per payment (control number, encrypted key, result) | `BanorteCheckout` in `backend/apps/payments/models.py` |
| Money movement (idempotent, locked) | `backend/apps/payments/settlement.py` |
| Result endpoint, staff verification and reconciliation endpoints | `backend/apps/payments/views.py` |
| What needs a MultiCobros check, "Conciliar con MultiCobros" | `backend/apps/payments/multicobros.py` |
| Lightbox loader | `frontend/src/lib/banorteCheckout.ts` |
| Parent top-up | `frontend/src/pages/parent/CafeteriaPage.tsx` |
| Staff verification (POS queue) and reconciliation (Depósitos) | `frontend/src/pages/admin/AdminCafeteria.tsx`, `frontend/src/components/admin/BanorteDialogs.tsx` |
| "Por aplicar" queue (apply / refund a paid top-up) | `frontend/src/components/admin/PaidTopUpQueue.tsx` |
| Paid top-ups to load into the POS (07:05 + hourly notice) | `manage.py topup_apply_report` |
| Config check and certificate expiry | `manage.py check_banorte` |
| Operations to look up in MultiCobros (hourly email) | `manage.py banorte_pending_report` |

## 2. Security design

Two properties of Banorte's encryption scheme shape the integration. Both were
verified against the worked example printed in the manual (pages 17 to 27).

**Banorte reuses the AES keystream for its answer.** The request and the
response are encrypted with the same key and IV in CTR mode, and the browser
sees both ciphertexts. Wherever the response text is predictable, combining the
two reveals the request text at the same positions. In the manual's own example
this exposes the Payworks user and password, which sit at the start of the JSON.
Our serializer therefore puts `merchantId`, `name` and `password` last, behind
JSON whitespace, at byte 2048 or later (`BANORTE_CREDENTIAL_OFFSET`). A response
is under 1 KiB, so it can never cover them. `test_a_response_never_uncovers_the_password`
runs the attack and checks that it fails.

**The result has no integrity check and arrives through the browser.** Banorte
sends no server-to-server notification. CTR without a MAC can be altered by
someone who knows the plaintext layout. So:

- Only the server-side decryption of `data` decides. The cleartext fields
  (`bnteCode`, `decision`, `resultadoPayw` outside `data`) are stored for
  support and never trusted.
- A result is accepted only if it decrypts to JSON whose `numeroControl` and
  `idAfiliacion` match ours and, for an approval, carries a numeric `referencia`.
  Anything else leaves the payment pending, with the reason in
  `BanorteCheckout.last_error` and a warning in the log.
- A simulated approval (`mode` AUT/RND) is never credited while `PAYMENTS_LIVE=true`,
  and **a simulated top-up is never loaded into the POS**: no money moved. It
  stays out of the "Cargar en POS" queue, both "Cargado en Loyverse" actions
  refuse it, and the admin shows it as "Simulación (no cargar)".
- A real approval is credited to the local wallet so the family sees it, but
  **staff must verify it in MultiCobros before loading it into the POS**
  (section 6). The single and the bulk "Cargado en Loyverse" actions refuse an
  unverified Banorte approval. Verifying asks staff to type the referencia and
  the amount MultiCobros shows; both must match.

Other measures:

- The per-transaction AES material is stored with `EncryptedTextField`
  (Fernet, `FIELD_ENCRYPTION_KEY`) and wiped once the payment is final.
- Random values come from `secrets` (the manual's sample uses `System.Random`).
- Free text sent to Banorte is folded to its allowed characters (no accents,
  none of the characters the manual forbids); empty values are dropped as the
  manual requires.
- Only the payer's family or an admin may report a result for a payment;
  the endpoint is rate limited.
- CSP allows `https://multicobros.banorte.com` for scripts, styles, XHR, the
  iframe and the form the lightbox posts. No `unsafe-*` was added: Banorte's
  scripts load by URL and none of them uses `eval`.
- Configuration errors are logged, never shown to families. A merchant set-up
  error reported by Banorte (AUT-10, Payworks `R` such as PAYW-3008, Payworks
  `E`) also emails the active admins (`ops_alerts.alert_config_error`: once per
  distinct problem, then weekly; never credentials).

## 3. Configuration

Set in `deploy/.env` on the VPS (never in a local `.env`, never in chat):

| Banorte delivers | Setting |
|---|---|
| Afiliación (7 digits) | `BANORTE_MERCHANT_ID` |
| Usuario: the **Nick of the "usuario de motor"** (manual v1.8), created by the MultiCobros administrator in Administración → Administración de usuarios → Usuarios → Usuarios de motor. Not the administrator user. | `BANORTE_USER` |
| Contraseña of that engine user (8 to 12 characters) | `BANORTE_PASSWORD` (single-quoted if it has `$`) |
| TERMINAL_ID, exactly as in Banorte's welcome email. The Payworks terminal ID is **not necessarily** the afiliación number; a wrong one makes Payworks answer `R` with **PAYW-3008** ("terminal no existe"), which the admins get by email | `BANORTE_TERMINAL_ID` |
| Nombre de afiliación (max 25 characters) | `BANORTE_MERCHANT_NAME` |
| Municipio (max 40 characters) | `BANORTE_MERCHANT_CITY` |
| Certificate `.cer` (renewed within the first three months of each year) | `BANORTE_CERT`: the Base64 body on one line |

To produce `BANORTE_CERT` from the `.cer` file:

```bash
grep -v '^#' multicobros.cer | grep -v CERTIFICATE | tr -d '\r\n'
```

Modes:

| Stage | `PAYMENTS_LIVE` | `PAYMENTS_OPEN_TO_ALL` | Who sees card payment | Charges |
|---|---|---|---|---|
| Local development (no credentials) | `false` | – | everyone | `/pago/simulado` mock page |
| **Simulation** | `false` | – | only `PAYMENTS_TEST_EMAILS` | none: Payworks `BANORTE_MODE` (AUT approves, DEC declines, RND random) |
| **Certification** | `true` | `false` | only `PAYMENTS_TEST_EMAILS` (red "cargo real" banner) | real (`mode=PRD`) |
| **Open** | `true` | `true` | every family | real (`mode=PRD`) |

With `PAYMENTS_LIVE=true` and incomplete configuration or an expired
certificate the top-up refuses to open ("no disponible"). `PAYMENTS_OPEN_TO_ALL`
alone never opens the simulation to families.

Accounts in `PAYMENTS_TEST_EMAILS` may top up from **$1** (a "$1 (prueba)"
button) to try the checkout cheaply; everyone else keeps the $20 minimum,
enforced by the server. This depends only on the list, not on the stage: in
the **Open** stage a listed account can still make real $1 charges, so trim
`PAYMENTS_TEST_EMAILS` after certification if that is not wanted.

Staging always runs `PAYMENTS_LIVE=false` and `BANORTE_MODE=AUT`
(`deploy/docker-compose.staging.yml`).

After changing `.env`:

```bash
docker compose up -d app
docker compose exec app python manage.py migrate
docker compose exec app python manage.py check_banorte
```

`check_banorte` prints the mode, the missing settings and the certificate
expiry (never the password). It fails within 30 days of expiry. The daily cron
runs it with `--notify`, which emails the active admins (the VPS cannot mail
cron output): once when a problem appears or changes, then weekly while it
lasts.

Scheduled jobs (`deploy/crontab.example`; the VPS crontab must be reinstalled
by hand after changing it):

| Job | When | What |
|---|---|---|
| `expire_stale_payments` | every 15 minutes | fails checkouts older than `OPEN_CHECKOUT_TTL_MINUTES` (45) as a soft `expire` |
| `banorte_pending_report` | hourly at :20 | emails the operations to look up in MultiCobros (section 6) |
| `check_banorte --notify` | daily 06:15 | configuration and certificate expiry |

## 4. Testing before certification (no money moves)

1. Set the credentials and the current certificate, keep `PAYMENTS_LIVE=false`,
   `BANORTE_MODE=AUT`, and list the test accounts in `PAYMENTS_TEST_EMAILS`.
   In this mode Banorte approves every card, so a deployed server offers card
   payment ONLY to those accounts; families see "pago en caja" until live.
2. As a listed tester, top up a linked child online. Banorte's window must open.
   If it closes at once with an authentication error, `BanorteCheckout.last_error`
   says AUT-10: wrong credentials, or wrong or expired certificate.
3. Pay with any test card. The return page must show "Pago confirmado" and the
   balance must rise. The operation shows as "Modo prueba (AUT)" in the POS queue.
4. Repeat with `BANORTE_MODE=DEC` (declined) and cancel once inside the window.

### Values that break silently

- **`$` in the password.** Docker Compose expands `$` in `deploy/.env`. Wrap the
  value in single quotes (`BANORTE_PASSWORD='...'`) or Banorte receives a
  different password and answers AUT-10.
- **Spaces in a value.** `deploy.sh` reads `deploy/.env` with bash, so
  `BANORTE_MERCHANT_NAME=COLEGIO INTERLAKEN` aborts the deploy with
  `INTERLAKEN: command not found`. Single-quote it:
  `BANORTE_MERCHANT_NAME='COLEGIO INTERLAKEN'`, `BANORTE_MERCHANT_CITY='TLALNEPANTLA DE BAZ'`.
- **Merchant name.** Max 25 characters and none of the forbidden characters
  (no parentheses); longer or invalid text is folded and cut.

### AUT-10 (resolved 2026-10-14)

Banorte answered `AUT-10, Authentication failed` with `numeroControl: null` while
we used the certificate from `LlaveCifrada2025.zip` (expired 2026-02-21) and a
terminal ID with a typo. With the 2026 certificate from `Llave VCE CIFRADO
2026.zip` (CN `multicobros.unix.banorte.com`, a new key, valid until
2027-02-09) and the terminal ID from Banorte's welcome email, `authenticateV2`
answered HTTP 200 with a session token. That validates the envelope format,
the credential padding, the certificate and the engine user in one call.

If AUT-10 comes back: first the certificate (is it this year's?), then the
terminal ID and afiliación against the welcome email, then the engine user's
Nick and password (single quotes around a password with `$`).

## 5. Certification with Banorte

Banorte's Payworks lab certifies every in-house integration before production.
Charging cards before the certification letter means Banorte does not cover
integration failures, chargebacks or settlement of those sales.

Send to `L.Payworks_ComercioElectronico@banorte.com` (or through the bank
executive):

**Formato de Solicitud de Certificación**, suggested answers:

| Field | Answer |
|---|---|
| Número de afiliación / Nombre del comercio | 7069217 / COLEGIO INTERLAKEN |
| ¿Integración a través de proveedor o gateway? | NO (desarrollo propio) |
| Vencimiento del certificado TLS 1.2 | Let's Encrypt, renewed automatically every 90 days by Caddy; current one valid until 2026-11-19 (check with `openssl s_client` before sending) |
| URL de página de ventas | `https://interlaken.edu.mx/portal/cafeteria` |
| IP origen del servidor | Public IP of the Hostinger VPS |
| Servidor web y sistema operativo | Caddy + Gunicorn in Docker on Ubuntu 24.04 (Hostinger VPS) |
| Lenguajes y APIs | Python 3 / Django REST Framework (backend), React + TypeScript (frontend), `cryptography` library for RSA-OAEP / PBKDF2 / AES-CTR |
| Método de cifrado / descifrado (screenshot) | `build_envelope` and `decrypt_result` in `backend/apps/payments/gateways/banorte_crypto.py` |
| Normatividad MIT y CIT: ¿almacena datos de tarjetas o clientes? | NO. Card data is captured only inside Banorte's window; we store the Payworks result (referencia, autorización, card brand and type), never card numbers |
| Diagrama de esquema de conexión | The flow in section 1 of this document |
| Manual | Manual de Integración Ventana de Comercio Electrónico Cifrado_v1.8 (already marked in form v1.3) |
| Producto de pago | Ventana de Comercio Electrónico con 3D Secure (or "con Cybersource y 3D Secure" if contracted; see section 8) |
| Tipos de transacciones | Venta |

**Matriz de pruebas**: three transactions in `PRD` mode with real cards, in
the **certification** stage (`PAYMENTS_LIVE=true`, `PAYMENTS_OPEN_TO_ALL=false`,
your account in `PAYMENTS_TEST_EMAILS`, small amounts on the test student).
Families do not see card payment during this stage. After Banorte's
certification letter, set `PAYMENTS_OPEN_TO_ALL=true` and restart `app`:

| Row | How | Where to read the values |
|---|---|---|
| MasterCard, Venta | Top up with a Mastercard | POS queue row: Control, Ref., Aut.; date and time from the payment |
| Visa, Venta | Top up with a Visa | same |
| 423 (3D Secure) | Enter a card, press Continuar, then **Cancelar** in the 3D Secure window | Payment fails without a charge; Banorte reports status 3D Secure 423 (kept in `BanorteCheckout.status_3d`). A callback without encrypted `data` and `status3D` 423 is handled as a cancellation (soft: a later genuine approval would still be credited); the family sees "Cancelado". Confirm on the first run |

The matrix (Matriz de Pruebas Ventana de Comercio Electrónico Cifrado) asks for
afiliación, fecha y hora, monto, número de control, referencia Payworks and the
card's **first 8 and last 2 digits**. Banorte never sends card digits to us:
take them from the card used, or from MultiCobros (Transacciones Payworks 2). All three are also in Django admin →
Operaciones Banorte. Refund the two real sales from MultiCobros afterwards, then
use the cafetería "Devolver" action (confirming the MultiCobros refund) so the
wallet matches.

## 6. Daily operation for staff

**Every school day at 07:30.** Paid card top-ups are listed in **Cafetería →
POS Loyverse → Por aplicar (carga de las 7:30)**, oldest promise first, with
the student's Loyverse customer code, the amount and the folio. At 07:05 (and
hourly until 14:40 while something is overdue) every admin gets the same list
as a portal notification and by email (`topup_apply_report`).

1. If a row says **Sin verificar**, press **Verificar en MultiCobros**. The
   dialog shows the date, the Referencia 1 (`PAGO<id>`) and the número de
   control. In MultiCobros go to Analítica → Reportes → Transacciones Payworks
   2, search it and confirm it is *Aprobada*. Type the referencia and the amount
   MultiCobros shows; the server checks both against the payment.
2. Type the amount into the student's customer in the Loyverse POS. Within a
   few minutes the app sees it and applies it by itself (the row disappears and
   the family is told the money is available). Or press **Aplicar**: the server
   checks that Loyverse holds the money before crediting it. If Loyverse does not
   show it yet (a purchase landed in between, or it was not loaded), the dialog
   says so with both numbers; **Aplicar sin verificar** requires a reason and
   leaves the top-up in **Cargar en POS** until it is marked loaded.
3. If the operation does not appear in MultiCobros, or the amount differs, do
   not load it and tell the direction.
4. **Same-day requests.** A family that needs the money today sends its
   comprobante by WhatsApp. Search the folio in Depósitos (`folio 123` or just
   `123`), load it in Loyverse right away and it applies within minutes.
5. **Refund before it was applied.** Refund the charge in MultiCobros, then
   press **Devolver** in "Por aplicar": confirm the MultiCobros refund and that
   the amount is not in the POS (or was removed). The wallet does not move.

The mirror never credits a Loyverse gap as a cash recarga while a student has
a paid top-up waiting: an exact match (one or several of their paid top-ups) is
applied, anything else is held and counted in the 07:35 wallet check
(`check_wallet_drift`). "Corregir" in Reconciliación is refused for those
students until the top-up is applied.

**Cargar en POS** keeps the card top-ups that are in the wallet but not yet in
Loyverse: those credited on payment (`instant` mode, or before 2026-10-18) and
those applied without the Loyverse check. Load them and press **Cargado en
Loyverse** (simulations never appear there).

**Refunds.** The card refund is made in MultiCobros. Then use **Devolver** on
the cafetería movement: for a card top-up the dialog asks to confirm that the
MultiCobros refund was already made (the server refuses it otherwise) and
records that confirmation in the refund's reason and the audit log. "Devolver"
only reverses the wallet and the POS queue; it never moves money on the card.

**Operations without a trustworthy answer.** A payment can stay **pending**
when the parent closed the window before Banorte answered, or when the answer
was not trustworthy (see `BanorteCheckout.last_error`). Pending checkouts expire
after 45 minutes (`expire_stale_payments`, every 15 minutes), and a new attempt
supersedes an open one. Any of these may hide a real charge. They are listed in
**Cafetería → Depósitos**, filter **Revisión: Por revisar en MultiCobros**, and
each has a **Conciliar con MultiCobros** button:

- If MultiCobros shows it **Aprobada**: choose "Aparece Aprobada" and type the
  referencia Payworks, the número de autorización and the amount. The payment is
  settled through the normal settlement path: the payment is recorded exactly
  once (the top-up becomes "Por aplicar", or is credited in `instant` mode), the
  operation is marked verified (it can go straight to the POS) and a later
  answer from the parent's browser changes nothing.
- If it does **not appear** (or appears declined): choose "No aparece" and write
  a note. It is closed as "No aparece en MultiCobros" without moving money. If a
  genuine approval from Banorte still arrives later, it is recorded as paid.

**Never fix these with a manual balance adjustment.** The adjustment left the
payment open, so a late answer from the browser credited the wallet a second
time.

`banorte_pending_report` runs hourly and emails the admins the real-money
operations of the last 72 hours that need that check: pending past the 45-minute
window, an answer that was not trusted, expired or superseded without an
answer, or a bank timeout (Payworks `T`). Cancellations, authentication errors
and operations already closed with "Conciliar con MultiCobros" are left out. It
emails only when an operation appears that the previous email did not list,
plus one reminder a day while any stays open.

**Failure labels.** A failed payment says why, for staff and families:
Cancelado por el usuario (in Banorte's window or its 3D Secure step), Expirado,
Reemplazado por otro intento, Rechazado por el banco (Payworks `D`/`N`), Sin
respuesta del banco (`T`), Error de configuración (`R`/`E`, AUT-10, checkout not
opened) and No aparece en MultiCobros. The admin "Rechazados / reembolsados" tile
does not count cancelled, expired or superseded attempts.

## 7. Yearly certificate rotation

Banorte renews the merchant certificate within the first three months of each
year and the old key stops working (proven in 2026: the 2025 key gets AUT-10).
When `check_banorte` warns, or by mid-January:

1. Ask the Banorte executive for the new `Llave VCE CIFRADO <year>.zip`.
2. Replace `BANORTE_CERT` in `deploy/.env` (section 3), restart `app`, run
   `check_banorte`.
3. Make one AUT test top-up from a staging copy, or watch the first live
   top-up's `BanorteCheckout.last_error`.

Current: `Llave VCE CIFRADO 2026.zip`, valid until 2027-02-09.

## 8. Open points

- **Cybersource.** If the afiliación has Cybersource contracted, Banorte
  requires the cardholder's billing address and IP (`billTo*` fields, manual
  p. 9). Not implemented: it needs a billing step in the top-up form. Confirm
  with Banorte before certification.
- **American Express** needs a separate Amex affiliation; the notice says Visa
  and Mastercard only.
- **Months without interest (Q6)** is not offered (single sales only).
