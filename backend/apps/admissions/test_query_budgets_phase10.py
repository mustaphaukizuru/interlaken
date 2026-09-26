"""Data Ops Phase 10 query budgets: admisiones exports and the pipeline board.

Each test parametrizes a small and a large row count and asserts the SAME
pinned constant, so a per-row query (N+1) fails the budget. Exports are
consumed inside the assert block so the streamed rows and the audit insert
are counted.
"""

import pytest
from django.core.files.base import ContentFile
from django.urls import reverse

from apps.accounts.factories import AdminFactory
from apps.admissions.models import PreRegistration, Registration, RegistrationDocument
from apps.content.models import SiteSettings

pytestmark = pytest.mark.django_db

# count + rows + audit insert.
PREREG_EXPORT_BUDGET = 3
# count + rows + documents prefetch + audit insert.
REG_EXPORT_BUDGET = 4
# registrations (student profile joined) + documents prefetch + site settings
# (the singleton row already exists, as in production). Was 1 + N before
# Phase 10: the reverse one-to-one ``student_profile`` was read per card.
PIPELINE_BUDGET = 3


def _body(resp) -> bytes:
    return b"".join(resp.streaming_content) if resp.streaming else resp.content


def _csv_lines(resp) -> list[str]:
    return [line for line in _body(resp).decode("utf-8-sig").split("\r\n")[1:] if line]


def _pre(i):
    return PreRegistration.objects.create(
        child_first_name=f"Ana{i}",
        child_last_name="Pérez",
        child_dob="2019-01-01",
        level=PreRegistration.Level.PRIMARY,
        grade_applying="Primaria 1°",
        parent_name="Luis Pérez",
        parent_email=f"luis{i}@test.mx",
        parent_phone="5550000000",
    )


def _reg(i, status=Registration.Status.SUBMITTED):
    reg = Registration.objects.create(
        child_first_name=f"Beto{i}",
        child_last_name="Ruiz",
        child_dob="2018-01-01",
        level="primaria",
        grade_applying="Primaria 2°",
        parent1_name="Marta Ruiz",
        parent1_email=f"marta{i}@test.mx",
        parent1_phone="5551111111",
        status=status,
    )
    doc = RegistrationDocument(registration=reg, doc_type="photo", filename="photo.pdf")
    doc.file.save("photo.pdf", ContentFile(b"x"), save=False)
    doc.save()
    return reg


@pytest.fixture
def admin(api_client, settings, tmp_path):
    settings.MEDIA_ROOT = str(tmp_path)
    api_client.force_authenticate(AdminFactory())
    return api_client


@pytest.mark.parametrize("n", [1, 12])
def test_preregistration_export(admin, django_assert_num_queries, n):
    for i in range(n):
        _pre(i)
    with django_assert_num_queries(PREREG_EXPORT_BUDGET):
        resp = admin.get(reverse("pre-register-export"))
        assert len(_csv_lines(resp)) == n


@pytest.mark.parametrize("n", [1, 12])
def test_registration_export(admin, django_assert_num_queries, n):
    for i in range(n):
        _reg(i)
    with django_assert_num_queries(REG_EXPORT_BUDGET):
        resp = admin.get(reverse("register-export"))
        assert len(_csv_lines(resp)) == n


@pytest.mark.parametrize("n", [1, 12])
def test_pipeline(admin, django_assert_num_queries, n):
    statuses = [Registration.Status.SUBMITTED, Registration.Status.REVIEWING]
    for i in range(n):
        _reg(i, status=statuses[i % 2])
    SiteSettings.load()
    with django_assert_num_queries(PIPELINE_BUDGET):
        resp = admin.get(reverse("admissions-pipeline"))
    assert resp.status_code == 200
    assert sum(len(c["cards"]) for c in resp.data["columns"]) == n
