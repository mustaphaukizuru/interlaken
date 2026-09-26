"""
GET /api/v1/accounts/students/ on the Data Ops list contract: ``q`` (with the
``search`` alias kept for one release), whitelisted ``ordering`` with the -pk
tiebreak, ``page_size`` ≤ 100, role scoping unchanged, O(1) queries.
"""

import pytest
from django.urls import reverse

from apps.accounts.factories import AdminFactory, ParentFactory, StudentProfileFactory

pytestmark = pytest.mark.django_db

URL = reverse("students")


@pytest.fixture
def roster():
    return [
        StudentProfileFactory(
            user__first_name="Ana",
            user__last_name="Zuñiga",
            student_id="09931",
            grade="1° Primaria",
            group="A",
        ),
        StudentProfileFactory(
            user__first_name="Beto",
            user__last_name="Alvarado",
            student_id="09932",
            grade="2° Primaria",
            group="B",
        ),
        StudentProfileFactory(
            user__first_name="Carla",
            user__last_name="Mora",
            student_id="09933",
            grade="1° Primaria",
            group="B",
            user__email="carla.mora@alumnos.test",
        ),
    ]


def _names(resp):
    return [r["user"]["first_name"] for r in resp.data["results"]]


class TestSearch:
    def test_q_matches_name_matricula_and_email(self, admin_client, roster):
        assert _names(admin_client.get(URL, {"q": "alvarado"})) == ["Beto"]
        assert _names(admin_client.get(URL, {"q": "09933"})) == ["Carla"]
        assert _names(admin_client.get(URL, {"q": "carla.mora@"})) == ["Carla"]

    def test_legacy_search_alias_still_works(self, admin_client, roster):
        assert _names(admin_client.get(URL, {"search": "Zuñiga"})) == ["Ana"]

    def test_loyverse_spelling_finds_the_stored_digits(self, admin_client, roster):
        # Decision C3.1 (Phase 0): ci09932 and 09932 are one matrícula; the
        # mixin's normalize_search_term hook carries search_key over to ``q``.
        assert _names(admin_client.get(URL, {"q": "ci09932"})) == ["Beto"]
        assert _names(admin_client.get(URL, {"q": "CI09932 primaria"})) == ["Beto"]
        # A name that merely starts with "ci" is not a Loyverse code.
        assert _names(admin_client.get(URL, {"q": "carla"})) == ["Carla"]

    def test_terms_are_anded(self, admin_client, roster):
        assert _names(admin_client.get(URL, {"q": "primaria 09932"})) == ["Beto"]
        assert _names(admin_client.get(URL, {"q": "ana alvarado"})) == []

    def test_parent_search_stays_scoped_to_own_children(self, api_client, roster):
        parent = ParentFactory()
        roster[0].parents.add(parent)
        api_client.force_authenticate(parent)
        assert _names(api_client.get(URL, {"q": "a"})) == ["Ana"]
        assert api_client.get(URL, {"q": "alvarado"}).data["count"] == 0


class TestOrderingAndPaging:
    def test_default_is_last_name_then_first_name(self, admin_client, roster):
        assert _names(admin_client.get(URL)) == ["Beto", "Carla", "Ana"]

    def test_whitelisted_keys(self, admin_client, roster):
        assert _names(admin_client.get(URL, {"ordering": "student_id"})) == ["Ana", "Beto", "Carla"]
        assert _names(admin_client.get(URL, {"ordering": "-student_id"})) == [
            "Carla",
            "Beto",
            "Ana",
        ]
        assert _names(admin_client.get(URL, {"ordering": "grade"})) == ["Ana", "Carla", "Beto"]
        assert _names(admin_client.get(URL, {"ordering": "-name"})) == ["Ana", "Carla", "Beto"]

    def test_unknown_key_falls_back_and_relation_probe_is_harmless(self, admin_client, roster):
        resp = admin_client.get(URL, {"ordering": "user__password"})
        assert resp.status_code == 200
        assert _names(resp) == ["Beto", "Carla", "Ana"]

    def test_page_size(self, admin_client, roster):
        resp = admin_client.get(URL, {"page_size": 2})
        assert len(resp.data["results"]) == 2 and resp.data["count"] == 3
        assert resp.data["next"] and "page=2" in resp.data["next"]

    def test_filters_still_apply_with_search(self, admin_client, roster):
        assert _names(
            admin_client.get(URL, {"q": "primaria", "grupo": "b", "ordering": "name"})
        ) == ["Beto", "Carla"]


class TestBudget:
    @pytest.mark.parametrize("n_students", [6, 18])
    def test_search_and_ordering_keep_the_query_count_constant(
        self, api_client, django_assert_num_queries, n_students
    ):
        for _ in range(n_students):
            StudentProfileFactory()
        api_client.force_authenticate(AdminFactory())
        with django_assert_num_queries(2):  # count + page rows (user joined)
            resp = api_client.get(URL, {"q": "test", "ordering": "-name", "page_size": 50})
        assert resp.status_code == 200 and resp.data["count"] == n_students
