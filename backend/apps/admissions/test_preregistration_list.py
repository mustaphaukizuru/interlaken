"""
GET /api/v1/admissions/pre-register/ on the Data Ops list contract: ``q``
(``search`` alias kept for one release), whitelisted ``ordering`` with the
-pk tiebreak, ``page_size`` ≤ 100, and an O(1) query budget.
"""

import pytest
from django.urls import reverse

from apps.accounts.factories import AdminFactory
from apps.admissions.models import PreRegistration

pytestmark = pytest.mark.django_db

URL = reverse("pre-register")


def _pre(**kwargs):
    defaults = dict(
        child_first_name="Ana",
        child_last_name="Pérez",
        child_dob="2019-01-01",
        level=PreRegistration.Level.PRIMARY,
        grade_applying="1°",
        parent_name="Roberto Pérez",
        parent_email="roberto@test.mx",
        parent_phone="5551111111",
    )
    defaults.update(kwargs)
    return PreRegistration.objects.create(**defaults)


@pytest.fixture
def rows():
    return [
        _pre(
            child_first_name="Lucía",
            child_last_name="Gómez",
            parent_email="lucia@test.mx",
            level=PreRegistration.Level.PRESCHOOL,
            status=PreRegistration.Status.CONTACTED,
        ),
        _pre(
            child_first_name="Pedro",
            child_last_name="Ruiz",
            parent_email="pedro@test.mx",
            parent_phone="5553333333",
            parent_name="Marta Ruiz",
        ),
        _pre(
            child_first_name="Ana",
            child_last_name="Alvarado",
            parent_email="ana@test.mx",
            level=PreRegistration.Level.SECONDARY,
        ),
    ]


def _children(resp):
    return [r["child_name"] for r in resp.data["results"]]


class TestSearch:
    def test_q_over_child_parent_email_and_phone(self, admin_client, rows):
        assert _children(admin_client.get(URL, {"q": "gómez"})) == ["Lucía Gómez"]
        assert _children(admin_client.get(URL, {"q": "marta"})) == ["Pedro Ruiz"]
        assert _children(admin_client.get(URL, {"q": "ana@test.mx"})) == ["Ana Alvarado"]
        assert _children(admin_client.get(URL, {"q": "5553333333"})) == ["Pedro Ruiz"]

    def test_legacy_search_alias(self, admin_client, rows):
        assert _children(admin_client.get(URL, {"search": "pedro"})) == ["Pedro Ruiz"]

    def test_terms_are_anded(self, admin_client, rows):
        assert _children(admin_client.get(URL, {"q": "ruiz pedro"})) == ["Pedro Ruiz"]
        assert _children(admin_client.get(URL, {"q": "ruiz lucía"})) == []


class TestOrderingAndPaging:
    def test_default_is_newest_first(self, admin_client, rows):
        assert _children(admin_client.get(URL)) == ["Ana Alvarado", "Pedro Ruiz", "Lucía Gómez"]

    def test_whitelisted_keys(self, admin_client, rows):
        assert _children(admin_client.get(URL, {"ordering": "child"})) == [
            "Ana Alvarado",
            "Lucía Gómez",
            "Pedro Ruiz",
        ]
        assert _children(admin_client.get(URL, {"ordering": "-level"})) == [
            "Ana Alvarado",
            "Pedro Ruiz",
            "Lucía Gómez",
        ]
        assert _children(admin_client.get(URL, {"ordering": "status"})) == [
            "Lucía Gómez",
            "Ana Alvarado",
            "Pedro Ruiz",
        ]
        assert _children(admin_client.get(URL, {"ordering": "parent"})) == [
            "Pedro Ruiz",
            "Ana Alvarado",
            "Lucía Gómez",
        ]

    def test_unknown_key_falls_back(self, admin_client, rows):
        resp = admin_client.get(URL, {"ordering": "registrations__session_token_hash"})
        assert resp.status_code == 200
        assert _children(resp) == ["Ana Alvarado", "Pedro Ruiz", "Lucía Gómez"]

    def test_page_size(self, admin_client, rows):
        resp = admin_client.get(URL, {"page_size": 1, "ordering": "child"})
        assert _children(resp) == ["Ana Alvarado"] and resp.data["count"] == 3


class TestBudget:
    @pytest.mark.parametrize("n_rows", [5, 15])
    def test_constant_queries_regardless_of_size(
        self, api_client, django_assert_num_queries, n_rows
    ):
        for i in range(n_rows):
            _pre(parent_email=f"p{i}@test.mx")
        api_client.force_authenticate(AdminFactory())
        with django_assert_num_queries(2):  # count + page rows
            resp = api_client.get(URL, {"q": "test.mx", "ordering": "-child", "page_size": 50})
        assert resp.status_code == 200 and resp.data["count"] == n_rows
