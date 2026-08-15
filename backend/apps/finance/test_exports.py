"""
GET /api/v1/finance/admin/invoices/export/ — CSV export (Admin console v2):
UTF-8 BOM for Excel, es-MX headers, respects the list filters, admin-only.
"""
from decimal import Decimal

import pytest
from django.urls import reverse

from apps.accounts.factories import StudentProfileFactory
from apps.finance import services
from apps.finance.models import FeeSchedule, Invoice

pytestmark = pytest.mark.django_db

PERIOD = "2026-08"


@pytest.fixture
def invoices(db):
    FeeSchedule.objects.create(
        name="Base", grade="", monthly_amount=Decimal("3000.00"), due_day=5, active=True)
    a, b = StudentProfileFactory(), StudentProfileFactory()
    services.generate_invoices(PERIOD)
    paid = Invoice.objects.get(student=a, period=PERIOD)
    services.mark_invoice_paid(paid, reason="Caja")
    return {"paid": paid, "pending": Invoice.objects.get(student=b, period=PERIOD)}


class TestInvoiceExport:
    def test_csv_has_bom_and_headers(self, admin_client, invoices):
        resp = admin_client.get(reverse("finance-admin-invoices-export"))
        assert resp.status_code == 200
        assert resp["Content-Type"].startswith("text/csv")
        assert "attachment" in resp["Content-Disposition"]
        content = resp.content.decode("utf-8")
        assert content.startswith("﻿")
        assert "Alumno,Matrícula,Grado,Periodo,Vence,Monto,Pagado,Saldo,Estado" in content

    def test_respects_status_filter(self, admin_client, invoices):
        resp = admin_client.get(reverse("finance-admin-invoices-export"), {"status": "paid"})
        content = resp.content.decode("utf-8")
        assert invoices["paid"].student.student_id in content
        assert invoices["pending"].student.student_id not in content

    def test_parent_is_403(self, api_client, parent_user, invoices):
        api_client.force_authenticate(user=parent_user)
        assert api_client.get(reverse("finance-admin-invoices-export")).status_code == 403

    def test_anonymous_is_401(self, api_client, invoices):
        assert api_client.get(reverse("finance-admin-invoices-export")).status_code == 401
