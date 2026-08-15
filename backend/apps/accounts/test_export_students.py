"""
GET /api/v1/accounts/admin/export/students/ — roster CSV (Admin console v2):
UTF-8 BOM for Excel, es-MX headers with guardians count, honors ?search=.
"""
import pytest
from django.urls import reverse

from apps.accounts.factories import ParentFactory, StudentProfileFactory

pytestmark = pytest.mark.django_db


class TestStudentsRosterExport:
    def test_csv_has_bom_headers_and_guardians_count(self, admin_client):
        p1, p2 = ParentFactory(), ParentFactory()
        StudentProfileFactory(parents=[p1, p2], grade="3° Primaria", group="B")
        StudentProfileFactory()

        resp = admin_client.get(reverse("export-students"))
        assert resp.status_code == 200
        assert resp["Content-Type"].startswith("text/csv")
        assert "attachment" in resp["Content-Disposition"]
        content = resp.content.decode("utf-8")
        assert content.startswith("﻿")
        assert "Alumno,Matrícula,Grado,Grupo,Correo,Tutores,Activo" in content
        # The two-guardian student exports Tutores=2.
        two_guardian_rows = [line for line in content.splitlines() if ",2,Sí" in line]
        assert len(two_guardian_rows) == 1

    def test_search_filters_rows(self, admin_client):
        target = StudentProfileFactory(grade="1° Primaria")
        other = StudentProfileFactory(grade="6° Primaria")

        resp = admin_client.get(reverse("export-students"),
                                {"search": target.student_id})
        content = resp.content.decode("utf-8")
        assert target.student_id in content
        assert other.student_id not in content

    def test_parent_is_403(self, api_client, parent_user):
        api_client.force_authenticate(user=parent_user)
        assert api_client.get(reverse("export-students")).status_code == 403

    def test_anonymous_is_401(self, api_client):
        assert api_client.get(reverse("export-students")).status_code == 401
