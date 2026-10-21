"""
Banorte "Ventana de Comercio Electrónico Cifrada" (manual v1.7).

* Crypto: pinned to the worked example printed in the manual, plus a full
  round trip against a throwaway RSA key (proves the OAEP SHA-256/MGF1-SHA-1
  parameters and the PBKDF2/AES-CTR derivation end to end).
* Keystream reuse: Banorte answers under the request's key+IV, so the
  credentials must sit beyond any byte a response can cover.
* Checkout: lightbox start, PRD only when live, fail closed on missing or
  expired configuration, no configuration detail leaked to families.
* Result: only the server-side decryption decides; anything that does not
  decrypt and match stays pending; approvals need staff verification before
  the POS load.
"""

import base64
import hashlib
import json
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from io import StringIO

import pytest
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.x509.oid import NameOID
from django.core.management import CommandError, call_command
from django.db import connection
from django.urls import reverse

from apps.accounts.factories import AdminFactory, ParentFactory, StudentProfileFactory
from apps.cafeteria.models import CafeteriaBalance, TopUpRequest
from apps.payments.gateways import banorte_crypto as bc
from apps.payments.gateways.banorte import _parse_certificate
from apps.payments.models import BanorteCheckout, Payment
from apps.portal.models import Notification

# ── the manual's worked example (Anexo B, pp. 17-27) ─────────

MANUAL_MATERIAL = bc.KeyMaterial(
    vi_hex="7434316130317A753068723272746569",
    salt_hex="3076356C346F7366387675337A316171",
    passphrase="g-T=Kq81GSgxRhc%",
)
MANUAL_RESPONSE_DATA = (
    "XxsiFPMZjPSOjJyanlLHARoa/+lIdegR3lUczOcD4qGa4a4InjrkeL+QY6PpGpJwDoimBOgbB/0E03YQBxNKMI"
    "RX8fZvKxszHcsZ16IgyB/gZHhv+/sguHFMYC0Ccu5hHQejZzX0/5OmXeGkMm6XhlxLKlOhbzcNCaEOQru23sn"
    "BrIfvoJN8lWC+q4FlQKIGS3TiFLGQGSBahB3ePnysGAiGD4eWrvtRmUM8NdiWJ6AEWKYFtnhAshTc3NprUIj"
    "A7IGrqrHaOtQUw/Zrz7s5ng/Fjj9CI9bE+UyPpjGzPwGtRkkg4G1jGZWPuyJw7yH5tb/q7MboZX8zb5nbVuikD"
    "yDhQw=="
)
# First bytes of the manual's encrypted REQUEST (p. 22), same key and IV.
MANUAL_REQUEST_PREFIX = (
    "XxsmFcAcjfmJmbaX0wbHDB0a/+lId/gR3kkYx+dTve29uvwaljrgcbWBfLShTNg6Scv2Dr9MQMot831PQUUG"
)

MERCHANT_ID = "7000002"


def _make_cert(days_valid=365, start_days_ago=1):
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "multicobroskey.test")])
    now = datetime.now(timezone.utc)
    cert = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - timedelta(days=start_days_ago))
        .not_valid_after(now + timedelta(days=days_valid))
        .sign(key, hashes.SHA256())
    )
    pem = cert.public_bytes(serialization.Encoding.PEM)
    return key, cert, b"#CN=multicobroskey.test,OU=Seguridad\n" + pem


@pytest.fixture(scope="module")
def cert_bundle():
    return _make_cert()


@pytest.fixture
def banorte(settings, cert_bundle):
    """Complete (fake) Banorte configuration in simulation mode."""
    _parse_certificate.cache_clear()
    _, _, pem = cert_bundle
    settings.BANORTE_MERCHANT_ID = MERCHANT_ID
    settings.BANORTE_USER = "EJECUCION01"
    settings.BANORTE_PASSWORD = "Ab12$#cd!?"
    settings.BANORTE_TERMINAL_ID = "12348"
    settings.BANORTE_MERCHANT_NAME = "Colegio Interlaken"
    settings.BANORTE_MERCHANT_CITY = "Ciudad de México"
    settings.BANORTE_MODE = "AUT"
    settings.BANORTE_CERT = pem.decode()
    settings.PAYMENTS_LIVE = False
    # Tests that flip PAYMENTS_LIVE mean the open stage; the certification
    # stage has its own tests (TestOnlineAvailability).
    settings.PAYMENTS_OPEN_TO_ALL = True
    return settings


def _decrypt_envelope(private_key, envelope):
    sub1, sub2 = envelope.split(":::")
    keys = private_key.decrypt(
        base64.b64decode(sub1),
        padding.OAEP(
            mgf=padding.MGF1(algorithm=hashes.SHA1()), algorithm=hashes.SHA256(), label=None
        ),
    ).decode()
    material = bc.KeyMaterial.deserialize(keys)
    return material, bc.aes_decrypt(material, sub2)


# ── crypto ───────────────────────────────────────────────────


class TestCrypto:
    def test_decrypts_the_manual_example_response(self):
        result = bc.decrypt_result(MANUAL_MATERIAL, MANUAL_RESPONSE_DATA)
        assert result == {
            "idAfiliacion": 7000002,
            "referencia": 248233587990,
            "numeroControl": "PBA22042709695XXFA36H01",
            "fechaReqCte": "2022-04-28T13:41:18.558",
            "fechaRspCte": "2022-04-28T13:41:18.684",
            "resultadoPayw": "A",
            "codigoAut": "214414",
            "texto": "Aprobada por Payworks (modo prueba)",
        }

    def test_manual_example_shows_request_and_response_share_the_keystream(self):
        """Why the credentials are moved: the response key also opens the request."""
        raw = base64.b64decode(MANUAL_REQUEST_PREFIX)
        ctx = Cipher(
            algorithms.AES(bc._aes_key(MANUAL_MATERIAL)),
            modes.CTR(bytes.fromhex(MANUAL_MATERIAL.vi_hex)),
        ).decryptor()
        assert ctx.update(raw).startswith(b'{"merchantId":"7000002","name":')

    def test_key_material_has_the_manual_shape(self):
        m = bc.generate_key_material()
        assert len(m.vi_hex) == len(m.salt_hex) == 32
        assert m.vi_hex == m.vi_hex.upper()
        assert all(c in bc.VI_SALT_ALPHABET for c in bytes.fromhex(m.vi_hex).decode())
        assert len(m.passphrase) == 16
        assert all(c in bc.PASSPHRASE_ALPHABET for c in m.passphrase)
        assert bc.KeyMaterial.deserialize(m.serialize()) == m
        assert bc.generate_key_material() != m

    def test_envelope_round_trip_with_the_certificate_key(self, cert_bundle):
        key, _, pem = cert_bundle
        cert = bc.load_certificate(pem)
        params = {
            "merchantId": MERCHANT_ID,
            "name": "U",
            "password": "P",
            "mode": "AUT",
            "amount": "150.00",
            "customerRef2": "",
        }
        envelope, material = bc.build_envelope(params, cert)
        got_material, plaintext = _decrypt_envelope(key, envelope)
        assert got_material == material
        decoded = json.loads(plaintext)
        assert decoded == {
            "merchantId": MERCHANT_ID,
            "name": "U",
            "password": "P",
            "mode": "AUT",
            "amount": "150.00",
        }  # blank value dropped

    def test_credentials_sit_past_the_offset_and_last(self):
        params = {
            "merchantId": MERCHANT_ID,
            "name": "EJECUCION01",
            "password": "Ab12$#cd",
            "mode": "AUT",
            "controlNumber": "IK1ABC",
            "amount": "1.00",
        }
        text = bc.build_params_json(params)
        for key in ('"merchantId"', '"name"', '"password"'):
            assert text.index(key) >= bc.DEFAULT_CREDENTIAL_OFFSET
        assert text.index('"mode"') < 100
        assert json.loads(text) == params
        compact = bc.build_params_json(params, credential_offset=0)
        assert " " not in compact and json.loads(compact) == params

    def test_a_response_never_uncovers_the_password(self, cert_bundle):
        """Simulate the attack: XOR the two ciphertexts with a fully known response."""
        _, _, pem = cert_bundle
        cert = bc.load_certificate(pem)
        params = {
            "merchantId": MERCHANT_ID,
            "name": "EJECUCION01",
            "password": "S3cr3t$#Pw",
            "mode": "AUT",
            "controlNumber": "IK1ABCDEFGHIJ",
            "amount": "100.00",
        }
        envelope, material = bc.build_envelope(params, cert)
        c_req = base64.b64decode(envelope.split(":::")[1])
        # A worst-case long answer: every field filled, 200-char texto with accents.
        response = json.dumps(
            {
                "idAfiliacion": 7000002,
                "referencia": 123456789012,
                "numeroControl": "X" * 30,
                "fechaReqCte": "x" * 23,
                "fechaReqAut": "x" * 23,
                "fechaRspAut": "x" * 23,
                "fechaRspCte": "x" * 23,
                "resultadoPayw": "D",
                "resultadoAut": "x" * 10,
                "codigoPayw": "PAYW-9999",
                "codigoAut": "",
                "texto": "é" * 200,
                "bancoEmisor": "x" * 20,
                "marcaTarjeta": "x" * 20,
                "tipoTarjeta": "x" * 20,
            },
            ensure_ascii=False,
        ).encode()
        c_resp = base64.b64decode(bc.aes_encrypt(material, response.decode()))
        recovered = bytes(a ^ b ^ c for a, b, c in zip(c_req, c_resp, response, strict=False))
        assert b"mode" in recovered  # the attack itself works…
        assert b"S3cr3t" not in recovered  # …but never reaches the credentials
        assert b"EJECUCION01" not in recovered

    def test_clean_text_removes_forbidden_characters(self):
        assert bc.clean_text('Ñandú & Café (Méx.) #1 / "a"', 40) == "Nandu Cafe Mex. 1 a"
        assert bc.clean_text("x" * 50, 25) == "x" * 25
        assert bc.clean_text(None, 10) == ""

    def test_certificate_formats_and_expiry(self, cert_bundle):
        _, cert, pem = cert_bundle
        der = cert.public_bytes(serialization.Encoding.DER)
        body = base64.b64encode(der).decode()
        for raw in (pem, pem.decode(), body, der):
            loaded = bc.load_certificate(raw)
            assert loaded.fingerprint == hashlib.sha256(der).hexdigest()
            assert not loaded.is_expired() and loaded.days_left() > 360
        _, _, old_pem = _make_cert(days_valid=-1, start_days_ago=400)
        assert bc.load_certificate(old_pem).is_expired()
        with pytest.raises(bc.BanorteCryptoError):
            bc.load_certificate("not a certificate")

    def test_tampered_or_garbage_data_is_rejected(self):
        with pytest.raises(bc.BanorteCryptoError):
            bc.decrypt_result(MANUAL_MATERIAL, "!!!not-base64!!!")
        with pytest.raises(bc.BanorteCryptoError):
            bc.decrypt_result(MANUAL_MATERIAL, base64.b64encode(b"\x00" * 40).decode())


# ── checkout ─────────────────────────────────────────────────


def _family(loyverse=True):
    parent = ParentFactory()
    student = StudentProfileFactory(parents=[parent])
    if not loyverse:
        student.loyverse_id = ""
        student.save(update_fields=["loyverse_id"])
    return parent, student


# A complete cardholder, as the wizard's "Titular de la tarjeta" step sends it.
BILLING = {
    "first_name": "Ana María", "last_name": "Núñez Peña", "street": "Av. Hidalgo #12",
    "street_number": "197", "street_number_2": "", "colonia": "Narvarte",
    "municipio": "Benito Juárez", "city": "Ciudad de México", "state": "df",
    "postal_code": "03 020", "phone": "(55) 1234-5678", "email": "Ana@Example.mx",
}


def _start(api_client, parent, student, amount="200.00", billing=BILLING):
    api_client.force_authenticate(user=parent)
    body = {"student": student.id, "amount": amount, "method": "online"}
    if billing is not None:
        body["billing"] = billing
    return api_client.post(reverse("cafeteria-topup"), body, format="json")


@pytest.mark.django_db
class TestCheckout:
    def test_lightbox_start_with_encrypted_params(self, api_client, banorte, cert_bundle):
        parent, student = _family()
        resp = _start(api_client, parent, student)
        assert resp.status_code == 201, resp.data
        checkout = resp.data["checkout"]
        assert checkout["kind"] == "lightbox"
        assert checkout["env"] == "pro"
        assert checkout["script_url"] == (
            "https://multicobros.banorte.com/orquestador/lightbox/checkoutV2.js"
        )
        assert "redirect_url" not in resp.data

        row = BanorteCheckout.objects.get(payment_id=resp.data["payment_id"])
        assert row.mode == "AUT"
        assert row.control_number == checkout["control_number"]

        key, _, _ = cert_bundle
        material, plaintext = _decrypt_envelope(key, checkout["params"])
        assert row.key_material == material.serialize()
        params = json.loads(plaintext)
        assert params["amount"] == "200.00"
        assert params["mode"] == "AUT"
        assert params["controlNumber"] == row.control_number
        assert params["merchantCity"] == "Ciudad de Mexico"
        assert params["customerRef1"] == f'PAGO{resp.data["payment_id"]}'
        assert params["password"] == "Ab12$#cd!?"

    def test_key_material_is_encrypted_at_rest(self, api_client, banorte):
        parent, student = _family()
        resp = _start(api_client, parent, student)
        row = BanorteCheckout.objects.get(payment_id=resp.data["payment_id"])
        with connection.cursor() as cur:
            cur.execute("SELECT key_material FROM payments_banortecheckout WHERE id = %s", [row.pk])
            stored = cur.fetchone()[0]
        assert row.key_material and row.key_material not in stored
        assert bc.KeyMaterial.deserialize(row.key_material).passphrase not in stored

    def test_live_always_sends_prd(self, api_client, banorte):
        banorte.PAYMENTS_LIVE = True
        parent, student = _family()
        resp = _start(api_client, parent, student)
        assert resp.status_code == 201, resp.data
        assert BanorteCheckout.objects.get(payment_id=resp.data["payment_id"]).mode == "PRD"

    def test_prd_is_ignored_when_not_live(self, api_client, banorte):
        banorte.BANORTE_MODE = "PRD"
        parent, student = _family()
        resp = _start(api_client, parent, student)
        assert BanorteCheckout.objects.get(payment_id=resp.data["payment_id"]).mode == "AUT"

    def test_live_without_configuration_fails_closed_without_leaking(self, api_client, settings):
        settings.PAYMENTS_LIVE = True
        settings.PAYMENTS_OPEN_TO_ALL = True
        parent, student = _family()
        resp = _start(api_client, parent, student)
        assert resp.status_code == 502
        assert "BANORTE" not in json.dumps(resp.data)
        payment = Payment.objects.get(related_topup__student=student)
        assert payment.status == Payment.Status.FAILED
        assert payment.related_topup.status == TopUpRequest.Status.FAILED

    def test_expired_certificate_fails_closed(self, api_client, banorte):
        _, _, old_pem = _make_cert(days_valid=-1, start_days_ago=400)
        banorte.BANORTE_CERT = old_pem.decode()
        parent, student = _family()
        resp = _start(api_client, parent, student)
        assert resp.status_code == 502
        assert not BanorteCheckout.objects.exists()

    def test_retired_gateway_is_rejected(self, api_client, banorte):
        parent, student = _family()
        api_client.force_authenticate(user=parent)
        resp = api_client.post(
            reverse("cafeteria-topup"),
            {
                "student": student.id,
                "amount": "100.00",
                "method": "online",
                "gateway": "global_payments",
            },
            format="json",
        )
        assert resp.status_code == 400
        assert not Payment.objects.exists()


# ── result ───────────────────────────────────────────────────


def _bank_answer(checkout, **overrides):
    """What Banorte's iframe hands the browser: ``data`` encrypted under the
    checkout's own key, plus cleartext extras."""
    material = bc.KeyMaterial.deserialize(checkout.key_material)
    result = {
        "idAfiliacion": int(MERCHANT_ID),
        "referencia": 248233587990,
        "numeroControl": checkout.control_number,
        "fechaReqCte": "2026-10-14T10:00:00.000",
        "fechaRspCte": "2026-10-14T10:00:01.000",
        "resultadoPayw": "A",
        "codigoAut": "214414",
        "texto": "Aprobada",
        "marcaTarjeta": "VISA",
        "tipoTarjeta": "CREDITO",
        "bancoEmisor": "BANORTE",
    }
    result.update(overrides)
    result = {k: v for k, v in result.items() if v is not None}
    return {
        "data": bc.aes_encrypt(material, json.dumps(result)),
        "status3D": "200",
        "eci": "05",
        "bnteCode": "00",
        "numeroControl": checkout.control_number,
    }


def _report(api_client, payment_id, event, response):
    return api_client.post(
        reverse("payment-banorte-result"),
        {"payment_id": payment_id, "event": event, "response": response},
        format="json",
    )


@pytest.fixture
def opened(api_client, banorte):
    parent, student = _family()
    resp = _start(api_client, parent, student)
    assert resp.status_code == 201, resp.data
    checkout = BanorteCheckout.objects.get(payment_id=resp.data["payment_id"])
    return parent, student, checkout


@pytest.mark.django_db
# Credit-on-payment mode (CAFETERIA_TOPUP_APPLY_MODE=instant); the default
# scheduled mode is covered in apps/cafeteria/test_topup_scheduled_apply.py.
@pytest.mark.usefixtures("instant_topups")
class TestResult:
    def test_approval_credits_the_ledger_and_wipes_the_key(self, api_client, opened):
        parent, student, checkout = opened
        resp = _report(api_client, checkout.payment_id, "success", _bank_answer(checkout))
        assert resp.status_code == 200, resp.data
        assert resp.data["status"] == "success"

        payment = Payment.objects.get(pk=checkout.payment_id)
        assert payment.gateway_tx_id == checkout.control_number
        assert payment.gateway_ref == "248233587990"
        assert CafeteriaBalance.objects.get(student=student).balance == Decimal("200.00")
        assert Notification.objects.filter(user=parent).count() == 1

        checkout.refresh_from_db()
        assert checkout.key_material == ""
        assert checkout.resultado_payw == "A"
        assert checkout.codigo_aut == "214414"
        assert checkout.marca_tarjeta == "VISA"
        assert checkout.result_at is not None
        assert not checkout.needs_verification  # AUT simulation: no real money

    def test_replay_does_not_credit_twice(self, api_client, opened):
        _, student, checkout = opened
        answer = _bank_answer(checkout)
        _report(api_client, checkout.payment_id, "success", answer)
        again = _report(api_client, checkout.payment_id, "success", answer)
        assert again.status_code == 200
        assert again.data["detail"] == "already_processed"
        assert CafeteriaBalance.objects.get(student=student).balance == Decimal("200.00")

    def test_decline_is_final(self, api_client, opened):
        _, student, checkout = opened
        resp = _report(
            api_client,
            checkout.payment_id,
            "success",
            _bank_answer(checkout, resultadoPayw="D", codigoAut=None, texto="Declinada"),
        )
        assert resp.data["status"] == "failed"
        payment = Payment.objects.get(pk=checkout.payment_id)
        assert not payment.is_soft_failed()
        assert not CafeteriaBalance.objects.filter(student=student, balance__gt=0).exists()

    def test_cancel_is_soft_and_a_later_approval_still_credits(self, api_client, opened):
        parent, student, checkout = opened
        resp = _report(api_client, checkout.payment_id, "cancel", {"id": 3})
        assert resp.data["status"] == "failed"
        assert Payment.objects.get(pk=checkout.payment_id).is_soft_failed()
        assert not Notification.objects.filter(user=parent).exists()

        checkout.refresh_from_db()
        assert checkout.key_material  # kept: a late answer must still decrypt
        resp = _report(api_client, checkout.payment_id, "success", _bank_answer(checkout))
        assert resp.data["status"] == "success"
        assert CafeteriaBalance.objects.get(student=student).balance == Decimal("200.00")

    def test_timeout_is_a_soft_failure(self, api_client, opened):
        _, _, checkout = opened
        _report(
            api_client,
            checkout.payment_id,
            "success",
            _bank_answer(checkout, resultadoPayw="T", codigoAut=None),
        )
        payment = Payment.objects.get(pk=checkout.payment_id)
        assert payment.status == Payment.Status.FAILED and payment.is_soft_failed()

    def test_authentication_error_fails_quietly(self, api_client, opened):
        parent, _, checkout = opened
        resp = _report(
            api_client,
            checkout.payment_id,
            "error",
            {"id": 4, "message": "Ha ocurrido un error al autenticar usuario"},
        )
        assert resp.data["status"] == "failed"
        checkout.refresh_from_db()
        assert "AUT-10" in checkout.last_error
        assert not Notification.objects.filter(user=parent).exists()

    @pytest.mark.parametrize(
        "mutate",
        [
            lambda c, a: {**a, "data": base64.b64encode(b"garbage-garbage-garbage").decode()},
            lambda c, a: _bank_answer(c, numeroControl="IK999OTHER"),
            lambda c, a: _bank_answer(c, idAfiliacion=1234567),
            lambda c, a: _bank_answer(c, referencia=None),
            lambda c, a: _bank_answer(c, resultadoPayw="Z"),
        ],
        ids=["garbage", "other-control", "other-merchant", "no-reference", "unknown-code"],
    )
    def test_untrusted_answers_stay_pending(self, api_client, opened, mutate):
        _, student, checkout = opened
        resp = _report(
            api_client, checkout.payment_id, "success", mutate(checkout, _bank_answer(checkout))
        )
        assert resp.status_code == 200
        assert resp.data["status"] == "pending"
        assert not CafeteriaBalance.objects.filter(student=student, balance__gt=0).exists()
        checkout.refresh_from_db()
        assert checkout.last_error
        assert checkout.key_material  # still open for a genuine answer

    def test_cleartext_fields_cannot_approve(self, api_client, opened):
        _, student, checkout = opened
        resp = _report(
            api_client,
            checkout.payment_id,
            "success",
            {
                "bnteCode": "00",
                "decision": "ACCEPT",
                "resultadoPayw": "A",
                "numeroControl": checkout.control_number,
            },
        )
        assert resp.data["status"] == "pending"
        assert not CafeteriaBalance.objects.filter(student=student, balance__gt=0).exists()

    def test_simulated_approval_never_credits_when_live(self, api_client, opened, banorte):
        _, student, checkout = opened  # opened in AUT
        banorte.PAYMENTS_LIVE = True
        resp = _report(api_client, checkout.payment_id, "success", _bank_answer(checkout))
        assert resp.data["status"] == "pending"
        assert not CafeteriaBalance.objects.filter(student=student, balance__gt=0).exists()

    def test_another_family_cannot_report(self, api_client, opened):
        _, _, checkout = opened
        api_client.force_authenticate(user=ParentFactory())
        resp = _report(api_client, checkout.payment_id, "success", _bank_answer(checkout))
        assert resp.status_code == 404
        assert Payment.objects.get(pk=checkout.payment_id).status == Payment.Status.PENDING

    def test_bad_event_is_rejected(self, api_client, opened):
        _, _, checkout = opened
        assert _report(api_client, checkout.payment_id, "hack", {}).status_code == 400


# ── staff verification before the POS load ───────────────────


@pytest.mark.django_db
# Credit-on-payment mode (CAFETERIA_TOPUP_APPLY_MODE=instant); the default
# scheduled mode is covered in apps/cafeteria/test_topup_scheduled_apply.py.
@pytest.mark.usefixtures("instant_topups")
class TestVerification:
    @pytest.fixture
    def live_approved(self, api_client, banorte):
        banorte.PAYMENTS_LIVE = True
        parent, student = _family()
        resp = _start(api_client, parent, student)
        checkout = BanorteCheckout.objects.get(payment_id=resp.data["payment_id"])
        assert checkout.mode == "PRD"
        _report(api_client, checkout.payment_id, "success", _bank_answer(checkout))
        checkout.refresh_from_db()
        return checkout

    def test_pos_load_waits_for_multicobros_verification(self, api_client, live_approved):
        checkout = live_approved
        assert checkout.needs_verification
        topup = checkout.payment.related_topup
        admin = AdminFactory()
        api_client.force_authenticate(user=admin)

        blocked = api_client.post(reverse("admin-topup-pos-loaded", args=[topup.pk]))
        assert blocked.status_code == 400
        assert "MultiCobros" in json.dumps(blocked.data)

        ok = api_client.post(
            reverse("admin-payment-banorte-verify", args=[checkout.payment_id]),
            {"referencia": checkout.referencia, "amount": "200.00"},
            format="json",
        )
        assert ok.status_code == 200, ok.data
        checkout.refresh_from_db()
        assert checkout.verified_by == admin and not checkout.needs_verification

        loaded = api_client.post(reverse("admin-topup-pos-loaded", args=[topup.pk]))
        assert loaded.status_code == 200, loaded.data

    def test_bulk_pos_load_skips_unverified(self, live_approved):
        from apps.cafeteria.admin_data import _pos_loaded_plan
        from apps.core.bulk import BulkSkip

        topup = TopUpRequest.objects.get(pk=live_approved.payment.related_topup_id)
        with pytest.raises(BulkSkip, match="MultiCobros"):
            _pos_loaded_plan(topup, {})

    def test_deposit_log_exposes_the_bank_references(self, api_client, live_approved):
        api_client.force_authenticate(user=AdminFactory())
        resp = api_client.get(reverse("admin-topups"))
        assert resp.status_code == 200, resp.data
        row = resp.data["results"][0]
        assert row["banorte"]["control_number"] == live_approved.control_number
        assert row["banorte"]["referencia"] == "248233587990"
        assert row["banorte"]["needs_verification"] is True

    def test_only_admins_verify_and_only_approvals(self, api_client, opened):
        parent, _, checkout = opened
        api_client.force_authenticate(user=parent)
        url = reverse("admin-payment-banorte-verify", args=[checkout.payment_id])
        assert api_client.post(url).status_code == 403
        api_client.force_authenticate(user=AdminFactory())
        assert api_client.post(url).status_code == 400  # no result yet


# ── ops command ──────────────────────────────────────────────


@pytest.mark.django_db
class TestCheckCommand:
    def test_ok_with_a_valid_certificate(self, banorte):
        out = StringIO()
        call_command("check_banorte", stdout=out)
        text = out.getvalue()
        assert "Banorte: OK" in text
        assert "Ab12" not in text  # never prints the password

    def test_fails_when_the_certificate_expires_soon(self, banorte):
        _, _, soon = _make_cert(days_valid=10)
        banorte.BANORTE_CERT = soon.decode()
        with pytest.raises(CommandError, match="vence en"):
            call_command("check_banorte", stdout=StringIO())

    def test_fails_live_without_configuration(self, settings):
        settings.PAYMENTS_LIVE = True
        with pytest.raises(CommandError, match="incompleta"):
            call_command("check_banorte", stdout=StringIO())


# ── who may pay online before going live ─────────────────────


@pytest.mark.django_db
class TestOnlineAvailability:
    """A deployed server that is not live runs Banorte's simulation (every card
    approved): families must not reach it, only the listed testers."""

    @pytest.fixture
    def deployed_not_live(self, banorte, monkeypatch):
        monkeypatch.delenv("SQLITE_LOCAL", raising=False)
        banorte.DEBUG = False
        banorte.PAYMENTS_LIVE = False
        banorte.PAYMENTS_TEST_EMAILS = ["Probador@Interlaken.test"]
        return banorte

    def test_families_cannot_pay_online_in_simulation(self, api_client, deployed_not_live):
        parent, student = _family()
        resp = _start(api_client, parent, student)
        assert resp.status_code == 400
        assert resp.data["code"] == "online_unavailable"
        assert not Payment.objects.exists()
        api_client.force_authenticate(user=parent)
        avail = api_client.get(reverse("payment-availability"))
        assert avail.data | {"min_amount": None, "topup_policy": None} == {
            "min_amount": None,
            "topup_policy": None,
            "online": False,
            "test_mode": True,
            "certification": False,
        }

    def test_listed_tester_can(self, api_client, deployed_not_live):
        parent, student = _family()
        parent.email = "probador@interlaken.test"
        parent.save(update_fields=["email"])
        resp = _start(api_client, parent, student)
        assert resp.status_code == 201, resp.data
        assert resp.data["checkout"]["kind"] == "lightbox"
        avail = api_client.get(reverse("payment-availability"))
        assert avail.data | {"min_amount": None, "topup_policy": None} == {
            "min_amount": None,
            "topup_policy": None,
            "online": True,
            "test_mode": True,
            "certification": False,
        }

    def test_families_no_longer_request_cash_top_ups(self, api_client, deployed_not_live):
        """Owner, 2026-10-20: card only in the portal; cash goes to the cafetería POS."""
        parent, student = _family()
        api_client.force_authenticate(user=parent)
        resp = api_client.post(
            reverse("cafeteria-topup"),
            {"student": student.id, "amount": "100.00", "method": "office"},
            format="json",
        )
        assert resp.status_code == 400 and resp.data["code"] == "office_not_available"

    def test_certification_stage_is_real_money_for_testers_only(
        self, api_client, deployed_not_live
    ):
        deployed_not_live.PAYMENTS_LIVE = True
        deployed_not_live.PAYMENTS_OPEN_TO_ALL = False
        family, family_child = _family()
        resp = _start(api_client, family, family_child)
        assert resp.status_code == 400
        assert resp.data["code"] == "online_unavailable"
        assert api_client.get(reverse("payment-availability")).data | {"min_amount": None, "topup_policy": None} == {
            "min_amount": None,
            "topup_policy": None,
            "online": False,
            "test_mode": False,
            "certification": True,
        }

        tester, child = _family()
        tester.email = "probador@interlaken.test"
        tester.save(update_fields=["email"])
        resp = _start(api_client, tester, child)
        assert resp.status_code == 201, resp.data
        assert BanorteCheckout.objects.get(payment_id=resp.data["payment_id"]).mode == "PRD"
        assert api_client.get(reverse("payment-availability")).data | {"min_amount": None, "topup_policy": None} == {
            "min_amount": None,
            "topup_policy": None,
            "online": True,
            "test_mode": False,
            "certification": True,
        }

    def test_everyone_once_open(self, api_client, deployed_not_live):
        deployed_not_live.PAYMENTS_LIVE = True
        deployed_not_live.PAYMENTS_OPEN_TO_ALL = True
        parent, _ = _family()
        api_client.force_authenticate(user=parent)
        avail = api_client.get(reverse("payment-availability"))
        assert avail.data | {"min_amount": None, "topup_policy": None} == {
            "min_amount": None,
            "topup_policy": None,
            "online": True,
            "test_mode": False,
            "certification": False,
        }

    def test_open_flag_alone_never_opens_the_simulation(self, api_client, deployed_not_live):
        deployed_not_live.PAYMENTS_OPEN_TO_ALL = True  # PAYMENTS_LIVE still false
        parent, _ = _family()
        api_client.force_authenticate(user=parent)
        assert api_client.get(reverse("payment-availability")).data["online"] is False


# ── alerts to the admins ─────────────────────────────────────


@pytest.mark.django_db
class TestAdminAlerts:
    def _admin(self):
        return AdminFactory(email="direccion@interlaken.test")

    def test_expiring_certificate_emails_once_then_weekly(self, banorte, mailoutbox):
        from datetime import datetime, timedelta
        from datetime import timezone as dt_timezone

        from apps.core.models import OpsStatus

        self._admin()
        _, _, soon = _make_cert(days_valid=10)
        banorte.BANORTE_CERT = soon.decode()
        for _ in range(2):
            with pytest.raises(CommandError):
                call_command("check_banorte", "--notify", stdout=StringIO())
        assert len(mailoutbox) == 1
        assert "direccion@interlaken.test" in mailoutbox[0].to
        assert "Ab12" not in mailoutbox[0].body

        # A week later the unchanged problem is sent again.
        state = OpsStatus.get("banorte_check")
        old = datetime.now(dt_timezone.utc) - timedelta(days=8)
        OpsStatus.set("banorte_check", {**state, "alerted_at": old.isoformat()})
        with pytest.raises(CommandError):
            call_command("check_banorte", "--notify", stdout=StringIO())
        assert len(mailoutbox) == 2

    def test_healthy_check_clears_the_alert(self, banorte, mailoutbox):
        from apps.core.models import OpsStatus

        self._admin()
        OpsStatus.set("banorte_check", {"fingerprint": "x", "alerted_at": "2026-01-01T00:00:00"})
        call_command("check_banorte", "--notify", stdout=StringIO())
        assert OpsStatus.get("banorte_check") == {}
        assert mailoutbox == []

    def test_pending_report_lists_only_operations_to_check(self, api_client, banorte, mailoutbox):
        self._admin()
        banorte.PAYMENTS_LIVE = True
        made = []
        for _ in range(4):
            parent, student = _family()
            resp = _start(api_client, parent, student)
            made.append(BanorteCheckout.objects.get(payment_id=resp.data["payment_id"]))
        pending, cancelled, approved, expired = made
        # Past the checkout window: no longer a parent still paying.
        Payment.objects.filter(pk=pending.payment_id).update(
            created_at=pending.created_at - timedelta(hours=2)
        )
        api_client.force_authenticate(user=cancelled.payment.user)
        _report(api_client, cancelled.payment_id, "cancel", {})
        api_client.force_authenticate(user=approved.payment.user)
        _report(api_client, approved.payment_id, "success", _bank_answer(approved))
        from apps.payments.services import fail_checkout_if_still_open

        assert fail_checkout_if_still_open(expired.payment_id, reason="test", stage="expire")

        out = StringIO()
        call_command("banorte_pending_report", stdout=out)
        text = out.getvalue()
        assert pending.control_number in text
        assert expired.control_number in text
        assert cancelled.control_number not in text
        assert approved.control_number not in text
        reports = [m for m in mailoutbox if "por revisar en MultiCobros" in m.subject]
        assert len(reports) == 1
        assert "2 pago(s)" in reports[0].subject
        assert "direccion@interlaken.test" in reports[0].to

    def test_pending_report_skips_simulations_and_stays_quiet(
        self, api_client, banorte, mailoutbox
    ):
        self._admin()
        parent, student = _family()
        _start(api_client, parent, student)  # AUT mode
        out = StringIO()
        call_command("banorte_pending_report", stdout=out)
        assert "nothing to check" in out.getvalue()
        assert mailoutbox == []


# ── $1 top-ups for test accounts ─────────────────────────────


@pytest.mark.django_db
class TestTwentyPesoMinimum:
    """The $1 test amount was removed on 2026-10-20: $20 for everyone, testers too."""

    def _post(self, api_client, user, student, amount):
        api_client.force_authenticate(user=user)
        return api_client.post(
            reverse("cafeteria-topup"),
            {"student": student.id, "amount": amount, "method": "online", "billing": BILLING},
            format="json",
        )

    def test_nobody_tops_up_below_twenty(self, api_client, banorte):
        banorte.PAYMENTS_TEST_EMAILS = ["probador@interlaken.test"]
        tester, child = _family()
        tester.email = "probador@interlaken.test"
        tester.save(update_fields=["email"])
        resp = self._post(api_client, tester, child, "1.00")
        assert resp.status_code == 400 and "20" in str(resp.data["amount"])
        assert api_client.get(reverse("payment-availability")).data["min_amount"] == "20.00"
        assert self._post(api_client, tester, child, "20.00").status_code == 201


# ── cardholder data for Cybersource (owner, 2026-10-20: "Estado" was null) ──
@pytest.mark.django_db
class TestCardholderData:
    def test_billto_fields_reach_banorte_clean_and_complete(self, api_client, banorte, cert_bundle):
        parent, student = _family()
        resp = _start(api_client, parent, student)
        assert resp.status_code == 201, resp.data
        key, _, _ = cert_bundle
        _, plaintext = _decrypt_envelope(key, resp.data["checkout"]["params"])
        params = json.loads(plaintext)
        assert params["billToState"] == "DF"                 # uppercase, 2 letters
        assert params["billToCountry"] == "MX"
        assert params["billToFirstName"] == "Ana Maria"       # accents folded
        assert params["billToLastName"] == "Nunez Pena"
        assert params["billToStreet"] == "Av. Hidalgo 12"     # '#' is forbidden
        assert params["billToStreetNumber"] == "197"
        assert params["billToStreet2Col"] == "Narvarte"
        assert params["billToStreet2Del"] == "Benito Juarez"
        assert params["billToCity"] == "Ciudad de Mexico"
        assert params["billToPostalCode"] == "03020"
        assert params["billToPhoneNumber"] == "5512345678"
        assert params["billToEmail"] == "ana@example.mx"
        assert params["billToIpAddress"]
        assert "billToStreetNumbe2" not in params             # optional and empty: not sent

    def test_real_money_without_cardholder_is_refused_before_banorte(self, api_client, banorte):
        banorte.PAYMENTS_LIVE = True
        parent, student = _family()
        resp = _start(api_client, parent, student, billing=None)
        assert resp.status_code == 400
        assert "titular de la tarjeta" in resp.data["detail"]
        assert not BanorteCheckout.objects.exists()

    @pytest.mark.parametrize("field, value", [
        ("state", "XX"), ("state", "Ciudad de México"), ("postal_code", "123"),
        ("phone", "55-12"), ("email", "no-es-correo"), ("street", "###"),
    ])
    def test_invalid_cardholder_data_is_refused_with_field_errors(self, api_client, banorte, field, value):
        parent, student = _family()
        resp = _start(api_client, parent, student, billing={**BILLING, field: value})
        assert resp.status_code == 400
        assert resp.data["code"] == "billing_invalid" and field in resp.data["billing"]
        assert not Payment.objects.exists()

    def test_the_data_is_remembered_encrypted_and_only_for_its_owner(self, api_client, banorte):
        from apps.payments.billing import BillingProfile

        parent, student = _family()
        _start(api_client, parent, student)
        profile = BillingProfile.objects.get(user=parent)
        with connection.cursor() as cur:
            cur.execute("SELECT data FROM payments_billingprofile WHERE id = %s", [profile.pk])
            stored = cur.fetchone()[0]
        assert "Narvarte" not in stored                       # encrypted at rest

        r = api_client.get(reverse("payment-billing-profile"))
        assert r.data["data"]["colonia"] == "Narvarte" and r.data["data"]["state"] == "DF"
        assert len(r.data["states"]) == 32

        stranger = ParentFactory()
        api_client.force_authenticate(user=stranger)
        assert api_client.get(reverse("payment-billing-profile")).data["data"] == {}

    def test_billing_profile_can_be_saved_directly(self, api_client):
        parent = ParentFactory()
        api_client.force_authenticate(user=parent)
        r = api_client.put(reverse("payment-billing-profile"), BILLING, format="json")
        assert r.status_code == 200 and r.data["data"]["postal_code"] == "03020"
        bad = api_client.put(reverse("payment-billing-profile"), {**BILLING, "state": "ZZ"}, format="json")
        assert bad.status_code == 400

