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
  |                                              settle (credit ledger, notify)
  |             -> /portal/cafeteria/recarga/retorno (shows the outcome)
```

Code map:

| Piece | File |
|---|---|
| Envelope crypto (RSA-OAEP, PBKDF2, AES-CTR) | `backend/apps/payments/gateways/banorte_crypto.py` |
| Gateway: configuration, checkout, result interpretation | `backend/apps/payments/gateways/banorte.py` |
| One attempt per payment (control number, encrypted key, result) | `BanorteCheckout` in `backend/apps/payments/models.py` |
| Money movement (idempotent, locked) | `backend/apps/payments/settlement.py` |
| Result endpoint, staff verification endpoint | `backend/apps/payments/views.py` |
| Lightbox loader | `frontend/src/lib/banorteCheckout.ts` |
| Parent top-up | `frontend/src/pages/parent/CafeteriaPage.tsx` |
| Staff verification in the POS queue | `frontend/src/pages/admin/AdminCafeteria.tsx` |
| Config check and certificate expiry | `manage.py check_banorte` |

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
- A simulated approval (`mode` AUT/RND) is never credited while `PAYMENTS_LIVE=true`.
- A real approval is credited to the local wallet so the family sees it, but
  **staff must verify it in MultiCobros before loading it into the POS**
  (section 6). The single and the bulk "Cargado en Loyverse" actions refuse an
  unverified Banorte approval.

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
- Configuration errors are logged, never shown to families.

## 3. Configuration

Set in `deploy/.env` on the VPS (never in a local `.env`, never in chat):

| Banorte delivers | Setting |
|---|---|
| Afiliación (7 digits) | `BANORTE_MERCHANT_ID` |
| Usuario: the **Nick of the "usuario de motor"** (manual v1.8), created by the MultiCobros administrator in Administración → Administración de usuarios → Usuarios → Usuarios de motor. Not the administrator user. | `BANORTE_USER` |
| Contraseña of that engine user (8 to 12 characters) | `BANORTE_PASSWORD` (single-quoted if it has `$`) |
| TERMINAL_ID, exactly as in Banorte's welcome email (for this afiliación it equals the afiliación number) | `BANORTE_TERMINAL_ID` |
| Nombre de afiliación (max 25 characters) | `BANORTE_MERCHANT_NAME` |
| Municipio (max 40 characters) | `BANORTE_MERCHANT_CITY` |
| Certificate `.cer` (renewed within the first three months of each year) | `BANORTE_CERT`: the Base64 body on one line |

To produce `BANORTE_CERT` from the `.cer` file:

```bash
grep -v '^#' multicobros.cer | grep -v CERTIFICATE | tr -d '\r\n'
```

Modes:

| `PAYMENTS_LIVE` | Credentials | Behaviour |
|---|---|---|
| `false` | empty | `/pago/simulado` mock page (local development) |
| `false` | complete | Real Banorte lightbox, Payworks simulation `BANORTE_MODE` (AUT approves, DEC declines, RND random). No money moves. |
| `true` | complete | `mode=PRD`, real charges |
| `true` | incomplete or expired certificate | Top-up refuses to open (families see "no disponible") |

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

**Matriz de pruebas**: three transactions in `PRD` mode with real cards
(set `PAYMENTS_LIVE=true` only for this window, small amounts):

| Row | How | Where to read the values |
|---|---|---|
| MasterCard, Venta | Top up with a Mastercard | POS queue row: Control, Ref., Aut.; date and time from the payment |
| Visa, Venta | Top up with a Visa | same |
| 423 (3D Secure) | Enter a card, press Continuar, then **Cancelar** in the 3D Secure window | Payment fails without a charge; Banorte reports status 3D Secure 423 (expected in `BanorteCheckout.status_3d`; confirm on the first run) |

The matrix (Matriz de Pruebas Ventana de Comercio Electrónico Cifrado) asks for
afiliación, fecha y hora, monto, número de control, referencia Payworks and the
card's **first 8 and last 2 digits**. Banorte never sends card digits to us:
take them from the card used, or from MultiCobros (Transacciones Payworks 2). All three are also in Django admin →
Operaciones Banorte. Refund the two real sales from MultiCobros afterwards (and
with the cafetería "Devolver" action so the wallet matches).

## 6. Daily operation for staff

Every approved online top-up appears in **Cafetería → POS Loyverse → Cargar en POS**.

1. If it says **Sin verificar**, press **Verificar en MultiCobros**. In
   MultiCobros go to Analítica → Reportes → Transacciones Payworks 2, search the
   número de control and confirm it is *Aprobada* for the same amount. Only
   then press "Sí, aparece aprobada".
2. Load the amount in the Loyverse POS and press **Cargado en Loyverse**.
3. If the operation does not appear in MultiCobros, do not load it. Report it:
   the wallet credit must be reversed with an adjustment.

Refunds are made in MultiCobros; then use **Devolver** on the cafetería
movement so the wallet and the POS queue follow.

A payment can stay **pending** when the parent closed the window before
Banorte answered, or when the answer was not trustworthy (see
`BanorteCheckout.last_error`). Pending checkouts expire after 45 minutes
(`expire_stale_payments`). If MultiCobros shows such an operation as approved,
credit it with a manual adjustment that cites the referencia.

Every morning `banorte_pending_report` (daily cron) emails the admins the
real-money operations of the last 26 hours that need that check: still
pending, expired without an answer, bank timeout (Payworks `T`) or an answer
that was not trusted. Cancellations and authentication errors are left out
(nothing was charged). No email when there is nothing to check.

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
