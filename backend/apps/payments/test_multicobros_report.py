"""«Subir reporte de MultiCobros» (payments.multicobros_report).

Staff export the day's transactions from MultiCobros and upload the file; every
matching approval is verified in one step through ``verify_approval``, the rule
of the per-payment «Verificar en MultiCobros» dialog. These tests pin:

- the parser: the 43-column export (accents, NBSP, case and spaces in the
  headers; a lone space as empty; int and float amounts; leading zeros), CSV
  in UTF-8 or latin-1 with commas or semicolons, the caps, the formats it
  refuses and a report of another afiliación;
- one outcome per row (and ``no_aparece`` for what the file leaves out),
  never a verification for anything but ``verificar``;
- the commit: same rule as the dialog, idempotent, audited, applied after it
  committed, inside a time budget, the file kept in memory, no card data out.

Every value here is invented: control numbers, referencias, authorization
codes, card digits and names.
"""

import csv
import io
import json
from datetime import timedelta
from decimal import Decimal
from unittest.mock import patch

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from django.urls import reverse
from django.utils import timezone
from openpyxl import Workbook

from apps.accounts.factories import ParentFactory, UserFactory
from apps.cafeteria import services as cafeteria_services
from apps.cafeteria.models import CafeteriaBalance, CafeteriaTransaction, TopUpRequest
from apps.core.models import AuditLog
from apps.payments import multicobros_report as mr
from apps.payments import test_verify_approval as tv
from apps.payments.models import BanorteCheckout, Payment
from apps.payments.multicobros import verify_approval
from apps.payments.test_verify_approval import card_payment

pytestmark = pytest.mark.django_db

# An admin signed in (fixture shared with the shared-rule tests).
admin = tv.admin

URL = "admin-payment-multicobros-upload"
LOYVERSE = "apps.cafeteria.services.get_customer_by_id"
MERCHANT = "7000002"

# The export's 43 headers, exactly as MultiCobros writes them (NBSP included).
HEADERS = [
    "Afiliación",
    "Fecha de Transacción",
    "Hora de Transacción",
    "Número de Control",
    "Código de Autorización",
    "Número de Tarjeta",
    "Tipo de Transacción",
    "Modo de Transacción",
    "Monto",
    "Referencia",
    "Referencia Siguiente",
    "Referencia Previa",
    "Estado",
    "Lote",
    "Tipo de Plan",
    "Número de Pagos",
    "Resultado Payworks",
    "Descripción",
    "Banco Emisor",
    "Marca de Tarjeta",
    "Tipo de Tarjeta",
    "Información DCC",
    "Información 3D Secure",
    "Información Cybersource\xa0",
    "Diferimiento",
    "Monto Cashback",
    "Autorizador",
    "Afiliación AMEX",
    "Método de autorización",
    "Tipo de plástico",
    "Referencia 1",
    "Referencia 2",
    "Referencia 3",
    "Referencia 4",
    "Referencia 5",
    "ECI",
    "XID",
    "CAVV",
    "Token 20",
    "Resultado Autorizador",
    "ID Agregador",
    "Sub Afiliación",
    "Referencia Original",
]
assert len(HEADERS) == 43

# Invented card-side values that must never come back in a response.
CARD = "4000009876"
SECRETS = ("CAVVINVENTADO0001", "XIDINVENTADO0001", "TOKENINVENTADO20")


@pytest.fixture(autouse=True)
def merchant(settings):
    settings.BANORTE_MERCHANT_ID = MERCHANT


def sale(checkout=None, **over):
    """One export row for ``checkout`` (or a sale of another channel)."""
    when = timezone.localtime(checkout.created_at) if checkout else timezone.localtime()
    row = dict.fromkeys(HEADERS, " ")
    row.update(
        {
            "Afiliación": f"0{MERCHANT}",
            "Fecha de Transacción": when.strftime("%d/%m/%Y"),
            "Hora de Transacción": when.strftime("%H:%M:%S"),
            "Número de Control": checkout.control_number if checkout else "OTRO0000000001",
            "Código de Autorización": checkout.codigo_aut if checkout else "999999",
            "Número de Tarjeta": CARD,
            "Tipo de Transacción": "Venta",
            "Modo de Transacción": "PRD",
            "Monto": int(checkout.payment.amount) if checkout else 50,
            "Referencia": checkout.referencia if checkout else "800000000001",
            "Estado": "C",
            "Resultado Payworks": "A",
            "Descripción": "Aprobado",
            "Marca de Tarjeta": "VISA      ",
            "Referencia 1": f"PAGO{checkout.payment_id}" if checkout else " ",
            "Referencia 2": "00000",
            "Referencia 3": "CAFETERIA",
            "Referencia 4": "VCE",
            "XID": SECRETS[1],
            "CAVV": SECRETS[0],
            "Token 20": SECRETS[2],
        }
    )
    row.update(over)
    return row


def xlsx(rows, headers=HEADERS, name="MovimientosPayworks_export_1.xlsx", sheet="data"):
    wb = Workbook()
    ws = wb.active
    ws.title = sheet
    ws.append(headers)
    for r in rows:
        ws.append([r.get(h, " ") for h in headers])
    buf = io.BytesIO()
    wb.save(buf)
    return SimpleUploadedFile(
        name,
        buf.getvalue(),
        content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )


def csv_file(rows, *, delimiter=",", encoding="utf-8-sig", headers=HEADERS, name="reporte.csv"):
    out = io.StringIO()
    writer = csv.writer(out, delimiter=delimiter)
    writer.writerow(headers)
    for r in rows:
        writer.writerow([r.get(h, " ") for h in headers])
    return SimpleUploadedFile(name, out.getvalue().encode(encoding), content_type="text/csv")


def upload(api_client, file, *, dry_run=True):
    file.seek(0)
    return api_client.post(
        reverse(URL), {"file": file, "dry_run": "1" if dry_run else "0"}, format="multipart"
    )


def outcome_of(resp, control):
    return next(r for r in resp.data["rows"] if r["control_number"] == control)


# ── the parser ───────────────────────────────────────────────


class TestParser:
    def test_the_export_as_multicobros_writes_it(self, api_client, admin):
        checkout = card_payment()
        resp = upload(api_client, xlsx([sale(checkout)]))
        assert resp.status_code == 200, resp.data
        assert resp.data["dry_run"] is True
        row = outcome_of(resp, checkout.control_number)
        assert row["outcome"] == "verificar"
        assert row["amount"] == "200.00" and row["card_last4"] == "9876"
        assert row["pago_id"] == checkout.payment_id
        assert row["date"] == timezone.localdate().isoformat()
        assert resp.data["counts"]["verificar"] == 1

    def test_headers_without_accents_in_other_case_with_spaces(self, api_client, admin):
        checkout = card_payment()
        plain = [
            " numero de CONTROL ",
            "monto",
            "REFERENCIA",
            "resultado  payworks",
            "Modo de transaccion",
            "tipo de transaccion",
            "fecha de transaccion",
            "codigo de autorizacion",
        ]
        values = sale(checkout)
        row = dict(
            zip(
                plain,
                [
                    values[h]
                    for h in (
                        "Número de Control",
                        "Monto",
                        "Referencia",
                        "Resultado Payworks",
                        "Modo de Transacción",
                        "Tipo de Transacción",
                        "Fecha de Transacción",
                        "Código de Autorización",
                    )
                ],
                strict=True,
            )
        )
        resp = upload(api_client, xlsx([row], headers=plain))
        assert resp.status_code == 200, resp.data
        assert outcome_of(resp, checkout.control_number)["outcome"] == "verificar"

    def test_lone_spaces_padding_float_amounts_and_leading_zeros(self, api_client, admin):
        checkout = card_payment("244.50", codigo_aut="000123")
        resp = upload(
            api_client,
            xlsx(
                [
                    sale(
                        checkout,
                        **{
                            "Monto": 244.5,
                            "Número de Control": f" {checkout.control_number}  ",
                            "Referencia": f"{checkout.referencia} ",
                            "Referencia 1": " ",
                            "Estado": " ",
                        },
                    )
                ]
            ),
        )
        row = outcome_of(resp, checkout.control_number)
        assert row["outcome"] == "verificar", row
        assert row["amount"] == "244.50"

    def test_an_authorization_code_that_lost_its_zeros_still_matches(self, api_client, admin):
        checkout = card_payment(codigo_aut="000123")
        resp = upload(api_client, xlsx([sale(checkout, **{"Código de Autorización": 123})]))
        assert outcome_of(resp, checkout.control_number)["outcome"] == "verificar"

    def test_csv_latin1_with_semicolons_and_decimal_comma(self, api_client, admin):
        checkout = card_payment("150.50")
        f = csv_file([sale(checkout, Monto="150,50")], delimiter=";", encoding="latin-1")
        resp = upload(api_client, f)
        assert resp.status_code == 200, resp.data
        assert outcome_of(resp, checkout.control_number)["outcome"] == "verificar"

    def test_csv_utf8_with_bom_and_commas(self, api_client, admin):
        checkout = card_payment()
        resp = upload(api_client, csv_file([sale(checkout, Monto="200.00")]))
        assert resp.status_code == 200, resp.data
        assert outcome_of(resp, checkout.control_number)["outcome"] == "verificar"

    def test_more_than_2_mb_is_refused(self, api_client, admin):
        big = SimpleUploadedFile("reporte.csv", b"x" * (mr.MAX_BYTES + 1), content_type="text/csv")
        resp = upload(api_client, big)
        assert resp.status_code == 413
        assert "2 MB" in resp.data["detail"]

    def test_more_than_5000_rows_is_refused(self, api_client, admin, monkeypatch):
        monkeypatch.setattr(mr, "MAX_ROWS", 3)
        rows = [sale(None, **{"Número de Control": f"OTRO{i:010d}"}) for i in range(4)]
        assert upload(api_client, xlsx(rows)).status_code == 413
        assert upload(api_client, xlsx(rows[:3])).status_code == 200

    def test_the_real_cap_is_5000_rows(self):
        assert mr.MAX_ROWS == 5_000 and mr.MAX_BYTES == 2 * 1024 * 1024

    @pytest.mark.parametrize(
        "name, data, code",
        [
            ("MovimientosPayworks_export_1.xls", b"\xd0\xcf\x11\xe0legacy", "unsupported_format"),
            ("reporte.xlsx", b"\xd0\xcf\x11\xe0legacy", "unsupported_format"),
            ("reporte.pdf", b"%PDF-1.4", "unsupported_format"),
            ("reporte.txt", b"a,b,c", "unsupported_format"),
            ("reporte.xlsx", b"not a zip at all", "unreadable"),
        ],
    )
    def test_other_formats_are_refused_with_a_clear_message(
        self, api_client, admin, name, data, code
    ):
        resp = upload(api_client, SimpleUploadedFile(name, data))
        assert resp.status_code == 400
        assert resp.data["code"] == code
        assert ".xlsx" in resp.data["detail"]

    def test_xls_message_says_what_to_do(self, api_client, admin):
        resp = upload(api_client, SimpleUploadedFile("export.xls", b"\xd0\xcf\x11\xe0"))
        assert "Excel 97-2003" in resp.data["detail"]

    def test_a_report_of_another_afiliacion_is_refused_whole(self, api_client, admin):
        checkout = card_payment()
        resp = upload(
            api_client, xlsx([sale(checkout), sale(checkout, **{"Afiliación": "09999999"})])
        )
        assert resp.status_code == 400
        assert resp.data["code"] == "other_merchant"
        assert resp.data["detail"].startswith("Este reporte es de otra afiliación")
        # Nothing was verified, not even the row of ours.
        upload(
            api_client,
            xlsx([sale(checkout), sale(checkout, **{"Afiliación": "09999999"})]),
            dry_run=False,
        )
        checkout.refresh_from_db()
        assert checkout.verified_at is None

    def test_afiliacion_is_not_checked_when_not_configured(self, api_client, admin, settings):
        settings.BANORTE_MERCHANT_ID = ""
        checkout = card_payment()
        resp = upload(api_client, xlsx([sale(checkout, **{"Afiliación": "09999999"})]))
        assert resp.status_code == 200

    def test_missing_columns_are_named(self, api_client, admin):
        headers = [h for h in HEADERS if h not in ("Monto", "Código de Autorización")]
        resp = upload(api_client, xlsx([sale(card_payment())], headers=headers))
        assert resp.status_code == 400 and resp.data["code"] == "missing_columns"
        assert "Monto" in resp.data["detail"] and "Código de Autorización" in resp.data["detail"]

    def test_empty_file_and_no_file(self, api_client, admin):
        assert upload(api_client, xlsx([])).data["code"] == "empty_report"
        resp = api_client.post(reverse(URL), {"dry_run": "1"}, format="multipart")
        assert resp.status_code == 400 and resp.data["code"] == "file_required"

    def test_the_first_sheet_is_read_when_there_is_no_data_sheet(self, api_client, admin):
        checkout = card_payment()
        resp = upload(api_client, xlsx([sale(checkout)], sheet="Hoja1"))
        assert outcome_of(resp, checkout.control_number)["outcome"] == "verificar"


# ── one outcome per row ──────────────────────────────────────


class TestOutcomes:
    def test_every_outcome_in_one_file(self, api_client, admin):
        ok = card_payment()
        done = card_payment()
        BanorteCheckout.objects.filter(pk=done.pk).update(
            verified_at=timezone.now(), verified_by=admin
        )
        wrong_amount = card_payment("300.00")
        expired = card_payment(resultado="", settled=False, referencia="", codigo_aut="")
        Payment.objects.get(pk=expired.payment_id).mark_failed("t", stage="expire")
        declined_there = card_payment()
        refunded = card_payment()
        declined_both = card_payment(resultado="D", settled=False)
        Payment.objects.get(pk=declined_both.payment_id).mark_failed("declinada")
        simulated = card_payment(mode="AUT")
        missing = card_payment()

        rows = [
            sale(ok),
            sale(done),
            sale(wrong_amount, Monto=30),
            sale(expired, Referencia="700000000009", **{"Código de Autorización": "554433"}),
            sale(declined_there, **{"Resultado Payworks": "D", "Descripción": "Declinada"}),
            sale(refunded),
            sale(
                None,
                **{
                    "Número de Control": "MC0000000000REF",
                    "Tipo de Transacción": "Devolución",
                    "Referencia Original": refunded.referencia,
                    "Referencia 1": " ",
                },
            ),
            sale(declined_both, **{"Resultado Payworks": "D"}),
            sale(None),
            sale(simulated, **{"Modo de Transacción": "AUT"}),
        ]
        resp = upload(api_client, xlsx(rows))
        assert resp.status_code == 200, resp.data
        got = {r["line"]: r["outcome"] for r in resp.data["rows"] if r["line"]}
        assert [got[i] for i in range(2, 2 + len(rows))] == [
            "verificar",
            "ya_verificada",
            "diferencia",
            "por_conciliar",
            "no_aprobada_en_multicobros",
            "devolucion",
            "devolucion",
            "rechazada",
            "sin_pago",
            "simulacion",
        ]
        absent = outcome_of(resp, missing.control_number)
        assert absent["outcome"] == "no_aparece" and absent["line"] is None
        assert "no lo cargue en el POS" in absent["message"]
        counts = resp.data["counts"]
        assert counts["no_aparece"] == 1 and counts["devolucion"] == 2
        assert sum(counts.values()) == len(rows) + 1
        assert resp.data["total_rows"] == len(rows)

        # Student and matrícula come from OUR database, never from the file.
        mine = outcome_of(resp, ok.control_number)
        student = ok.payment.related_topup.student
        assert mine["student_name"] == student.user.full_name
        assert mine["student_code"] == student.student_id

        # The dry run changed nothing.
        assert (
            not BanorteCheckout.objects.filter(verified_by__isnull=False)
            .exclude(pk=done.pk)
            .exists()
        )

    @pytest.mark.parametrize(
        "field, value, says",
        [
            ("Monto", 199, "El monto no coincide: MultiCobros $199.00, plataforma $200.00"),
            ("Referencia", "111111111111", "La referencia no coincide: MultiCobros 111111111111"),
            (
                "Código de Autorización",
                "999999",
                "El número de autorización no coincide: MultiCobros 999999",
            ),
            ("Referencia 1", "PAGO999999", "La Referencia 1 no coincide: MultiCobros PAGO999999"),
            ("Estado", "R", "estado «R»"),
        ],
    )
    def test_a_difference_is_never_verified(self, api_client, admin, field, value, says):
        checkout = card_payment()
        f = xlsx([sale(checkout, **{field: value})])
        row = outcome_of(upload(api_client, f), checkout.control_number)
        assert row["outcome"] == "diferencia"
        assert says in row["message"] and "avise a dirección" in row["message"]
        resp = upload(api_client, f, dry_run=False)
        assert resp.data["verified"] == 0
        checkout.refresh_from_db()
        assert checkout.verified_at is None

    def test_por_conciliar_is_listed_with_the_files_values_never_settled(self, api_client, admin):
        checkout = card_payment("180.00", resultado="", settled=False, codigo_aut="", referencia="")
        BanorteCheckout.objects.filter(pk=checkout.pk).update(referencia="")
        Payment.objects.get(pk=checkout.payment_id).mark_failed("t", stage="bank_timeout")
        f = xlsx(
            [
                sale(
                    checkout,
                    Referencia="700000000123",
                    **{"Código de Autorización": "0A1B2C", "Monto": 180},
                )
            ]
        )
        row = outcome_of(upload(api_client, f), checkout.control_number)
        assert row["outcome"] == "por_conciliar"
        assert row["prefill"] == {
            "referencia": "700000000123",
            "codigo_aut": "0A1B2C",
            "amount": "180.00",
        }
        assert row["reconcile"]["control_number"] == checkout.control_number
        assert "banco" in row["reconcile"]["review_reason"]

        resp = upload(api_client, f, dry_run=False)
        assert resp.data["verified"] == 0
        payment = Payment.objects.get(pk=checkout.payment_id)
        assert payment.status == Payment.Status.FAILED
        assert not CafeteriaTransaction.objects.exists()

    def test_a_hard_declined_payment_approved_in_multicobros_is_a_difference(
        self, api_client, admin
    ):
        checkout = card_payment(resultado="D", settled=False)
        Payment.objects.get(pk=checkout.payment_id).mark_failed("declinada")
        row = outcome_of(upload(api_client, xlsx([sale(checkout)])), checkout.control_number)
        assert row["outcome"] == "diferencia"
        assert "Fallido" in row["message"]

    def test_a_sale_and_its_cancellation_with_the_same_control_number(self, api_client, admin):
        checkout = card_payment()
        f = xlsx([sale(checkout), sale(checkout, **{"Tipo de Transacción": "Cancelación"})])
        resp = upload(api_client, f)
        assert [r["outcome"] for r in resp.data["rows"]] == ["devolucion", "devolucion"]
        upload(api_client, f, dry_run=False)
        checkout.refresh_from_db()
        assert checkout.verified_at is None

    def test_a_refund_found_by_its_referencia_1(self, api_client, admin):
        checkout = card_payment()
        refund = sale(
            None,
            **{
                "Número de Control": "MC0000000000XYZ",
                "Tipo de Transacción": "Devolución",
                "Referencia 1": f"PAGO{checkout.payment_id}",
            },
        )
        resp = upload(api_client, xlsx([refund]))
        assert resp.data["rows"][0]["outcome"] == "devolucion"
        assert resp.data["rows"][0]["pago_id"] == checkout.payment_id

    def test_a_declined_retry_next_to_its_approval_is_not_an_alarm(self, api_client, admin):
        checkout = card_payment()
        resp = upload(
            api_client, xlsx([sale(checkout, **{"Resultado Payworks": "D"}), sale(checkout)])
        )
        assert [r["outcome"] for r in resp.data["rows"]] == ["rechazada", "verificar"]

    def test_two_different_approvals_with_one_control_number(self, api_client, admin):
        checkout = card_payment()
        resp = upload(api_client, xlsx([sale(checkout), sale(checkout, Referencia="123412341234")]))
        assert {r["outcome"] for r in resp.data["rows"]} == {"diferencia"}

    def test_no_aparece_only_inside_the_files_dates(self, api_client, admin):
        old = card_payment(when=timezone.now() - timedelta(days=3))
        today = card_payment()
        other = card_payment()
        resp = upload(api_client, xlsx([sale(other)]))
        absent = {r["control_number"] for r in resp.data["rows"] if r["outcome"] == "no_aparece"}
        assert absent == {today.control_number}
        assert old.control_number not in absent
        assert resp.data["date_from"] == resp.data["date_to"] == timezone.localdate().isoformat()

    def test_no_card_data_ever_leaves(self, api_client, admin):
        checkout = card_payment()
        f = xlsx([sale(checkout), sale(None)])
        for dry_run in (True, False):
            body = json.dumps(upload(api_client, f, dry_run=dry_run).data, default=str)
            assert CARD not in body and CARD[:6] not in body
            for secret in SECRETS:
                assert secret not in body
            assert "9876" in body
        assert "400000" not in json.dumps(list(AuditLog.objects.values("changes")), default=str)


# ── the commit ───────────────────────────────────────────────


class TestCommit:
    def test_verifies_through_the_shared_rule_audits_and_is_idempotent(self, api_client, admin):
        a, b = card_payment(), card_payment("120.00")
        f = xlsx([sale(a), sale(b)])
        with patch(
            "apps.payments.multicobros_report.verify_approval", wraps=verify_approval
        ) as rule:
            resp = upload(api_client, f, dry_run=False)
        assert resp.status_code == 200, resp.data
        assert rule.call_count == 2
        assert {c.kwargs["via"] for c in rule.call_args_list} == {"multicobros-upload"}
        assert resp.data["dry_run"] is False and resp.data["verified"] == 2
        for checkout in (a, b):
            checkout.refresh_from_db()
            assert checkout.verified_by == admin and not checkout.needs_verification

        verifications = AuditLog.objects.filter(context="payments.banorte.verify")
        assert verifications.count() == 2
        for log in verifications:
            assert log.changes["via"] == "multicobros-upload"
            assert log.changes["banorte_verified"] is True
        [summary] = AuditLog.objects.filter(context=mr.AUDIT_CONTEXT)
        assert summary.object_type == "import:multicobros"
        assert summary.changes["counts"]["verificar"] == 2
        assert summary.changes["counts"]["verificadas"] == 2
        assert set(summary.changes) == {"dry_run", "counts"}  # counts only

        again = upload(api_client, f, dry_run=False)
        assert again.data["verified"] == 0
        assert {r["outcome"] for r in again.data["rows"]} == {"ya_verificada"}
        assert AuditLog.objects.filter(context="payments.banorte.verify").count() == 2

    def test_the_same_sale_twice_in_the_file_is_verified_once(self, api_client, admin):
        checkout = card_payment()
        resp = upload(api_client, xlsx([sale(checkout), sale(checkout)]), dry_run=False)
        assert resp.data["verified"] == 1
        assert [r["outcome"] for r in resp.data["rows"]] == ["verificar", "ya_verificada"]
        assert AuditLog.objects.filter(context="payments.banorte.verify").count() == 1

    def test_applies_right_away_when_loyverse_already_has_it(self, api_client, admin):
        checkout = card_payment()
        student = checkout.payment.related_topup.student
        CafeteriaBalance.objects.create(
            student=student, balance=Decimal("3"), last_synced=timezone.now()
        )
        budgets = []

        def loyverse(customer_id):
            budgets.append(cafeteria_services._READ_BUDGET.get())
            return {"id": customer_id, "total_points": 203}

        with patch(LOYVERSE, side_effect=loyverse):
            resp = upload(api_client, xlsx([sale(checkout)]), dry_run=False)
        row = outcome_of(resp, checkout.control_number)
        assert row["apply_state"] == "applied" and "$203.00" in row["message"]
        assert resp.data["applied"] == 1 and resp.data["waiting"] == 0
        # One short attempt, never the retrying ~83 s session.
        assert budgets == [cafeteria_services._GUARD_TIMEOUT]
        topup = TopUpRequest.objects.get(pk=checkout.payment.related_topup_id)
        assert topup.status == TopUpRequest.Status.COMPLETED
        assert CafeteriaBalance.objects.get(student=student).balance == Decimal("203")

    def test_not_in_loyverse_yet_waits_verified(self, api_client, admin):
        checkout = card_payment()
        CafeteriaBalance.objects.create(
            student=checkout.payment.related_topup.student,
            balance=Decimal("3"),
            last_synced=timezone.now(),
        )
        with patch(LOYVERSE, return_value={"id": "x", "total_points": 3}):
            resp = upload(api_client, xlsx([sale(checkout)]), dry_run=False)
        assert outcome_of(resp, checkout.control_number)["apply_state"] == "waiting_pos"
        assert resp.data["waiting"] == 1 and resp.data["applied"] == 0
        assert TopUpRequest.objects.get(pk=checkout.payment.related_topup_id).status == "paid"

    def test_two_top_ups_of_one_student_go_in_together(self, api_client, admin):
        """The 2026-11-18 case ($200 + $244 loaded together): verified in one
        upload, the first apply call sees both verified and applies both."""
        first = card_payment("200.00")
        student = first.payment.related_topup.student
        second = card_payment("244.00", student=student)
        CafeteriaBalance.objects.create(
            student=student, balance=Decimal("3"), last_synced=timezone.now()
        )
        with patch(LOYVERSE, return_value={"id": student.loyverse_id, "total_points": 447}) as read:
            resp = upload(api_client, xlsx([sale(first), sale(second)]), dry_run=False)
        assert read.call_count == 1
        assert [outcome_of(resp, c.control_number)["apply_state"] for c in (first, second)] == [
            "applied",
            "applied",
        ]
        assert CafeteriaBalance.objects.get(student=student).balance == Decimal("447")

    def test_out_of_time_the_mirror_applies_the_rest(self, api_client, admin, monkeypatch):
        monkeypatch.setattr(mr, "APPLY_BUDGET_SECONDS", -1)
        checkout = card_payment()
        with patch(LOYVERSE) as read:
            resp = upload(api_client, xlsx([sale(checkout)]), dry_run=False)
        read.assert_not_called()
        row = outcome_of(resp, checkout.control_number)
        assert row["apply_state"] == "pending_sync" and resp.data["waiting"] == 1
        checkout.refresh_from_db()
        assert checkout.verified_at is not None

    def test_a_change_since_the_preview_is_left_for_a_person(self, api_client, admin):
        checkout = card_payment()
        report = mr.analyze(mr.parse_report(xlsx([sale(checkout)])))
        Payment.objects.filter(pk=checkout.payment_id).update(status=Payment.Status.REFUNDED)
        out = mr.commit(report, admin)
        assert out.verified == 0
        assert out.outcomes[0].outcome == "diferencia"
        assert "No se verificó" in out.outcomes[0].message

    def test_the_file_never_touches_the_disk(self, api_client, admin):
        checkout = card_payment()
        with (
            override_settings(FILE_UPLOAD_MAX_MEMORY_SIZE=1),
            patch(
                "django.core.files.uploadhandler.TemporaryFileUploadHandler.new_file",
                side_effect=AssertionError("written to a temporary file"),
            ),
        ):
            resp = upload(api_client, xlsx([sale(checkout)]))
        assert resp.status_code == 200, resp.data

    def test_an_oversized_body_is_refused_before_it_is_read(self, api_client, admin):
        resp = api_client.post(
            reverse(URL),
            data=b"x",
            content_type="multipart/form-data; boundary=x",
            CONTENT_LENGTH=str(mr.MAX_BODY_BYTES + 1),
        )
        assert resp.status_code == 413

    def test_only_cafeteria_staff(self, api_client):
        f = xlsx([sale(card_payment())])
        api_client.force_authenticate(user=ParentFactory())
        assert upload(api_client, f).status_code == 403
        api_client.force_authenticate(user=UserFactory(role="staff", staff_areas=["visitas"]))
        assert upload(api_client, f).status_code == 403
        api_client.force_authenticate(user=UserFactory(role="staff", staff_areas=["cafeteria"]))
        assert upload(api_client, f).status_code == 200

    def test_throttled_like_the_other_admin_uploads(self):
        from apps.payments.views import AdminMulticobrosUploadView

        assert AdminMulticobrosUploadView.throttle_scope == "admin-import"
        assert AdminMulticobrosUploadView.admin_area == "cafeteria"
