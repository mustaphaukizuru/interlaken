"""Allergies at the cafetería (2026-11-24): Ajustes → «La cafetería ve las
alergias», a school decision, off by default.

Off: no console endpoint sends an allergy key, to anyone. On: the console
(balances, low balance, the per-student page) carries ``allergies`` (that
field only) for the children whose family authorised health data, under the
rule ``accounts.medical`` already applies to a guardian; ``allergies_shared``
says which. Admins keep the full student file whatever the switch says, and
only an admin can change it (audited).
"""

from datetime import timedelta
from decimal import Decimal

import pytest
from django.urls import reverse
from django.utils import timezone

from apps.accounts.factories import (
    AdminFactory,
    ParentFactory,
    StudentProfileFactory,
    UserFactory,
)
from apps.accounts.medical import family_authorised_ids, medical_access
from apps.accounts.models import Family, User
from apps.cafeteria.models import CafeteriaBalance, CafeteriaTransaction
from apps.cafeteria.serializers import CONSOLE_HIDDEN_STUDENT_FIELDS
from apps.content.models import SiteSettings
from apps.core.models import AuditLog
from apps.legal.models import ConsentPurpose, ConsentRecord, PrivacyNoticeVersion
from apps.legal.services import record_consent

pytestmark = pytest.mark.django_db

SETTINGS_URL = reverse("admin-site-settings")
NEVER = (
    "blood_type",
    "medical_notes",
    "curp",
    "birth_date",
    "age",
    "emergency_name",
    "emergency_phone",
    "emergency_rel",
)


def _switch(on: bool):
    s = SiteSettings.load()
    s.cafeteria_shows_allergies = on
    s.save()


def _kid(parent=None, allergies="Nueces", family=None):
    kid = StudentProfileFactory(
        parents=[parent] if parent else None,
        family=family,
        allergies=allergies,
        blood_type="O+",
        medical_notes="Asma leve",
        curp="PEGA100101HDFRRN09",
    )
    CafeteriaBalance.objects.create(
        student=kid, balance=Decimal("5"), low_balance_threshold=Decimal("50")
    )
    # A recent purchase puts the wallet on the low-balance report too.
    CafeteriaTransaction.objects.create(
        student=kid,
        transaction_type=CafeteriaTransaction.TxType.PURCHASE,
        amount=Decimal("10"),
        loyverse_receipt_id=f"alg-{kid.pk}",
        date=timezone.now(),
    )
    return kid


def _grant(guardian, kid=None, granted=True, at=None):
    if at is None:
        return record_consent(
            guardian=guardian, purpose=ConsentPurpose.MEDICAL_DATA, granted=granted, student=kid
        )
    # Records are immutable: an explicit time keeps «latest wins» independent
    # of the clock's resolution.
    return ConsentRecord.objects.create(
        guardian=guardian,
        student=kid,
        purpose=ConsentPurpose.MEDICAL_DATA,
        granted=granted,
        notice_version=PrivacyNoticeVersion.current(),
        captured_at=at,
    )


def _cashier():
    return UserFactory(role=User.Role.STAFF, staff_areas=["cafeteria"])


def _console_rows(client, kid):
    """The kid's student payload on each console screen."""
    detail = client.get(reverse("admin-student-detail", args=[kid.pk]), {"ledger": 0})
    assert detail.status_code == 200, detail.data
    rows = client.get(reverse("admin-balances")).data["results"]
    low = client.get(reverse("admin-low-balance")).data["results"]
    return {
        "detail": detail.data["balance"]["student"],
        "balances": next(r["student"] for r in rows if r["student"]["id"] == kid.pk),
        "low": next(r["student"] for r in low if r["student"]["id"] == kid.pk),
    }


class TestSwitchOff:
    @pytest.mark.parametrize("who", ["cashier", "admin"])
    def test_no_allergy_key_even_for_an_authorised_child(self, api_client, who):
        parent = ParentFactory()
        kid = _kid(parent)
        _grant(parent)
        api_client.force_authenticate(_cashier() if who == "cashier" else AdminFactory())
        for screen, student in _console_rows(api_client, kid).items():
            assert "allergies" not in student, screen
            assert "allergies_shared" not in student, screen
            assert not set(CONSOLE_HIDDEN_STUDENT_FIELDS) & set(student), screen

    def test_the_switch_is_off_by_default(self, api_client):
        assert SiteSettings.load().cafeteria_shows_allergies is False
        assert api_client.get(reverse("site-settings")).data["cafeteria_shows_allergies"] is False


class TestSwitchOn:
    def test_cashier_sees_only_the_authorised_childs_allergies(self, api_client):
        _switch(True)
        yes_parent, no_parent = ParentFactory(), ParentFactory()
        authorised, other = _kid(yes_parent), _kid(no_parent, allergies="Lácteos")
        _grant(yes_parent)  # household-wide, from Privacidad
        api_client.force_authenticate(_cashier())

        for screen, student in _console_rows(api_client, authorised).items():
            assert student["allergies"] == "Nueces", screen
            assert student["allergies_shared"] is True, screen
            for field in NEVER:
                assert field not in student, (screen, field)
        for screen, student in _console_rows(api_client, other).items():
            assert "allergies" not in student, screen
            assert student["allergies_shared"] is False, screen

    def test_an_authorised_child_without_allergies_says_so(self, api_client):
        _switch(True)
        parent = ParentFactory()
        kid = _kid(parent, allergies="")
        _grant(parent, kid)
        api_client.force_authenticate(_cashier())
        student = _console_rows(api_client, kid)["detail"]
        assert student["allergies_shared"] is True and student["allergies"] == ""

    def test_a_revoked_consent_hides_it_again(self, api_client):
        _switch(True)
        parent = ParentFactory()
        kid = _kid(parent)
        now = timezone.now()
        _grant(parent, at=now - timedelta(days=2))
        _grant(parent, granted=False, at=now - timedelta(days=1))
        assert medical_access(parent, kid) == (False, "consent_required")  # the same rule
        api_client.force_authenticate(_cashier())
        student = _console_rows(api_client, kid)["detail"]
        assert student["allergies_shared"] is False and "allergies" not in student

    def test_admin_in_the_console_follows_the_same_rule(self, api_client):
        _switch(True)
        kid = _kid(ParentFactory())
        api_client.force_authenticate(AdminFactory())
        student = _console_rows(api_client, kid)["detail"]
        assert student["allergies_shared"] is False and "allergies" not in student

    def test_page_reads_stay_constant(self, api_client, django_assert_max_num_queries):
        _switch(True)
        for _ in range(6):
            parent = ParentFactory()
            _kid(parent)
            _grant(parent)
        api_client.force_authenticate(_cashier())
        # count + page + switch + family links + parent logins + consents (+ auth slack)
        with django_assert_max_num_queries(8):
            rows = api_client.get(reverse("admin-balances")).data["results"]
        assert len(rows) == 6 and all(r["student"]["allergies"] == "Nueces" for r in rows)


class TestFamilyRule:
    """``family_authorised_ids`` is ``medical_access`` asked of the family."""

    def _agrees(self, kid, *logins):
        expected = any(medical_access(u, kid)[0] for u in logins if u.role == User.Role.PARENT)
        assert (kid.pk in family_authorised_ids([kid])) is expected
        return expected

    def test_per_student_and_household_consents(self):
        parent = ParentFactory()
        kid = _kid(parent)
        assert self._agrees(kid, parent) is False
        _grant(parent, kid)
        assert self._agrees(kid, parent) is True
        other_parent = ParentFactory()
        other = _kid(other_parent)
        _grant(other_parent)
        assert self._agrees(other, other_parent) is True

    def test_a_siblings_guardian_counts(self):
        family = Family.objects.create(name="Pérez")
        parent = ParentFactory()
        older = _kid(parent, family=family)
        younger = _kid(None, family=family)
        _grant(parent)
        assert self._agrees(younger, parent) is True
        assert family_authorised_ids([older, younger]) == {older.pk, younger.pk}

    def test_strangers_and_student_logins_do_not_count(self):
        stranger = ParentFactory()
        _grant(stranger)
        kid = _kid(None)
        own_login = kid.user  # the student's school login, linked as its own guardian
        assert own_login.role == User.Role.STUDENT
        kid.parents.add(own_login)
        _grant(own_login)
        assert self._agrees(kid, stranger, own_login) is False
        assert family_authorised_ids([]) == set()


class TestAdminsUnaffected:
    @pytest.mark.parametrize("on", [False, True])
    def test_admin_student_file_keeps_every_medical_field(self, admin_client, on):
        _switch(on)
        kid = _kid(ParentFactory())  # no consent at all
        data = admin_client.get(reverse("student-detail", args=[kid.pk])).data
        assert data["allergies"] == "Nueces" and data["medical_notes"] == "Asma leve"
        assert "medical_masked" not in data


class TestOnlyAdminsFlipIt:
    @pytest.mark.parametrize(
        "user",
        [
            lambda: UserFactory(role=User.Role.STAFF, staff_areas=["cafeteria"]),
            lambda: UserFactory(
                role=User.Role.STAFF,
                staff_areas=[
                    "alumnos",
                    "accesos",
                    "admisiones",
                    "visitas",
                    "mensajes",
                    "comunicados",
                    "cafeteria",
                ],
            ),
            ParentFactory,
        ],
    )
    def test_non_admins_are_refused(self, api_client, user):
        api_client.force_authenticate(user())
        resp = api_client.patch(SETTINGS_URL, {"cafeteria_shows_allergies": True}, format="json")
        assert resp.status_code == 403
        assert SiteSettings.load().cafeteria_shows_allergies is False

    def test_admin_turns_it_on_and_it_is_audited(self, admin_client):
        resp = admin_client.patch(SETTINGS_URL, {"cafeteria_shows_allergies": True}, format="json")
        assert resp.status_code == 200, resp.data
        assert resp.data["cafeteria_shows_allergies"] is True
        assert SiteSettings.load().cafeteria_shows_allergies is True
        row = AuditLog.objects.get(
            object_type="content.sitesettings", context="cms: ajustes del sitio"
        )
        assert row.changes == {"cafeteria_shows_allergies": [False, True]}
        assert row.actor is not None
        # The public settings follow at once (the texts that name who sees allergies).
        assert admin_client.get(reverse("site-settings")).data["cafeteria_shows_allergies"] is True
