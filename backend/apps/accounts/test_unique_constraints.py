"""
Data Ops Phase 10: the partial unique constraints that ``check_data_integrity``
reported clean in production.

* ``StudentProfile.loyverse_id`` is unique when not blank (any number of
  unlinked students keep ``''``).
* ``User.email`` is unique case-insensitively (``Lower('email')``).

Both are portable: SQLite (tests, local) supports partial and expression
indexes, so the same migration runs on Postgres and SQLite.
"""

import pytest
from django.db import IntegrityError, transaction

from apps.accounts.factories import ParentFactory, StudentProfileFactory, UserFactory
from apps.accounts.models import StudentProfile, User
from apps.core.management.commands.check_data_integrity import (
    duplicate_emails,
    duplicate_loyverse_ids,
)

pytestmark = pytest.mark.django_db


class TestStudentLoyverseIdUnique:
    def test_two_students_cannot_share_a_loyverse_customer(self):
        StudentProfileFactory(loyverse_id="cust-abc")
        with pytest.raises(IntegrityError), transaction.atomic():
            StudentProfileFactory(loyverse_id="cust-abc")
        assert StudentProfile.objects.filter(loyverse_id="cust-abc").count() == 1

    def test_any_number_of_unlinked_students(self):
        for _ in range(3):
            StudentProfileFactory(loyverse_id="")
        assert StudentProfile.objects.filter(loyverse_id="").count() == 3

    def test_relinking_through_update_is_refused_too(self):
        StudentProfileFactory(loyverse_id="cust-1")
        other = StudentProfileFactory(loyverse_id="")
        other.loyverse_id = "cust-1"
        with pytest.raises(IntegrityError), transaction.atomic():
            other.save(update_fields=["loyverse_id"])

    def test_integrity_report_stays_empty(self):
        StudentProfileFactory(loyverse_id="cust-2")
        StudentProfileFactory(loyverse_id="")
        assert duplicate_loyverse_ids() == []


class TestUserEmailCaseInsensitiveUnique:
    def test_case_variant_of_an_existing_email_is_refused(self):
        ParentFactory(email="ana.perez@example.com")
        with pytest.raises(IntegrityError), transaction.atomic():
            User.objects.create_user(email="Ana.Perez@example.com", password="x")
        assert User.objects.filter(email__iexact="ana.perez@example.com").count() == 1

    def test_distinct_addresses_are_fine(self):
        UserFactory(email="uno@example.com")
        UserFactory(email="dos@example.com")
        assert duplicate_emails() == []

    def test_changing_case_of_the_same_account_is_allowed(self):
        user = ParentFactory(email="luis@example.com")
        user.email = "Luis@example.com"
        user.save(update_fields=["email"])
        user.refresh_from_db()
        assert user.email == "Luis@example.com"
