"""
apps.core.listing — the list contract (Data Ops C1): date bounds in
America/Mexico_City (DST and month ends), ``q`` search, ``page_size``,
whitelisted ordering with the -pk tiebreak, FilterSet support and the
``queryset_for_filters`` hook the bulk contract reuses.
"""

from datetime import date, datetime
from zoneinfo import ZoneInfo

import django_filters
import pytest
from django.conf import settings
from rest_framework import generics
from rest_framework.test import APIRequestFactory, force_authenticate

from apps.accounts.factories import AdminFactory
from apps.core.listing import (
    AdminListMixin,
    ListPagination,
    apply_date_range,
    date_bounds,
    day_end_exclusive,
    day_start,
    search_q,
    split_terms,
)
from apps.core.models import ContactMessage
from apps.core.serializers import ContactMessageAdminSerializer

MX = ZoneInfo("America/Mexico_City")
UTC = ZoneInfo("UTC")


class TestDateBounds:
    def test_inclusive_to_becomes_exclusive_next_midnight(self):
        start, end = date_bounds("2026-03-01", "2026-03-31")
        assert start == datetime(2026, 3, 1, tzinfo=MX)
        assert end == datetime(2026, 4, 1, tzinfo=MX)
        assert start.utcoffset() is not None and end.utcoffset() is not None

    def test_dst_spring_forward_is_a_23_hour_day(self):
        # Mexico City observed DST until 2022; 2022-04-03 sprang forward at 02:00.
        start, end = date_bounds("2022-04-03", "2022-04-03")
        assert start.astimezone(UTC) == datetime(2022, 4, 3, 6, tzinfo=UTC)
        assert end.astimezone(UTC) == datetime(2022, 4, 4, 5, tzinfo=UTC)
        # Same-tzinfo subtraction ignores offsets; compare on the UTC timeline.
        assert (end.astimezone(UTC) - start.astimezone(UTC)).total_seconds() == 23 * 3600

    def test_dst_fall_back_is_a_25_hour_day(self):
        start, end = date_bounds("2022-10-30", "2022-10-30")
        assert start.astimezone(UTC) == datetime(2022, 10, 30, 5, tzinfo=UTC)
        assert end.astimezone(UTC) == datetime(2022, 10, 31, 6, tzinfo=UTC)
        assert (end.astimezone(UTC) - start.astimezone(UTC)).total_seconds() == 25 * 3600

    @pytest.mark.parametrize(
        "day, next_day",
        [
            ("2026-02-28", date(2026, 3, 1)),  # non-leap February
            ("2024-02-29", date(2024, 3, 1)),  # leap day
            ("2026-12-31", date(2027, 1, 1)),  # year end
            ("2026-04-30", date(2026, 5, 1)),
        ],
    )
    def test_month_and_year_ends(self, day, next_day):
        _, end = date_bounds(None, day)
        assert end == datetime.combine(next_day, datetime.min.time(), tzinfo=MX)

    def test_invalid_or_missing_values_are_ignored(self):
        assert date_bounds("garbage", "") == (None, None)
        assert date_bounds(None, None) == (None, None)
        start, end = date_bounds("2026-01-05", "nope")
        assert start == day_start(date(2026, 1, 5)) and end is None

    def test_accepts_date_and_datetime_objects(self):
        start, end = date_bounds(date(2026, 1, 5), datetime(2026, 1, 6, 15, 30, tzinfo=MX))
        assert start == day_start(date(2026, 1, 5))
        assert end == day_end_exclusive(date(2026, 1, 6))

    @pytest.mark.django_db
    def test_apply_date_range_is_inclusive_on_to_in_local_time(self):
        inside = ContactMessage.objects.create(name="a", email="a@x.mx", subject="s", message="m")
        outside = ContactMessage.objects.create(name="b", email="b@x.mx", subject="s", message="m")
        ContactMessage.objects.filter(pk=inside.pk).update(
            created_at=datetime(2026, 3, 31, 23, 30, tzinfo=MX)
        )
        ContactMessage.objects.filter(pk=outside.pk).update(
            created_at=datetime(2026, 4, 1, 0, 10, tzinfo=MX)
        )
        qs = apply_date_range(
            ContactMessage.objects.all(), "created_at", "2026-03-01", "2026-03-31"
        )
        assert list(qs.values_list("pk", flat=True)) == [inside.pk]


class TestSearch:
    def test_split_terms_on_whitespace_and_commas(self):
        assert split_terms(" ana,  perez ") == ["ana", "perez"]
        assert split_terms("") == []

    def test_search_q_is_none_without_terms_or_fields(self):
        assert search_q(("name",), "") is None
        assert search_q((), "ana") is None

    @pytest.mark.django_db
    def test_terms_are_anded_and_fields_ored(self):
        ContactMessage.objects.create(name="Ana Perez", email="ana@x.mx", subject="s", message="m")
        ContactMessage.objects.create(
            name="Luis Perez", email="luis@x.mx", subject="s", message="m"
        )
        fields = ("name", "email")
        assert ContactMessage.objects.filter(search_q(fields, "perez")).count() == 2
        assert ContactMessage.objects.filter(search_q(fields, "ana perez")).count() == 1
        assert ContactMessage.objects.filter(search_q(fields, "luis@x.mx")).count() == 1
        assert ContactMessage.objects.filter(search_q(fields, "ana zzz")).count() == 0


# ── the mixin on a throwaway view ─────────────────────────
class ContactFilter(django_filters.FilterSet):
    handled = django_filters.BooleanFilter(field_name="is_handled")
    min_id = django_filters.NumberFilter(field_name="id", lookup_expr="gte")

    class Meta:
        model = ContactMessage
        fields = ["handled", "min_id"]


class ContactListView(AdminListMixin, generics.ListAPIView):
    serializer_class = ContactMessageAdminSerializer
    queryset = ContactMessage.objects.all()
    search_fields = ("name", "email")
    legacy_search_param = "search"
    ordering = {"name": "name", "date": "created_at", "both": ("subject", "name")}
    default_ordering = "name"
    filterset_class = ContactFilter


def _get(params=None, user=None):
    request = APIRequestFactory().get("/x/", params or {})
    force_authenticate(request, user=user or AdminFactory())
    return ContactListView.as_view()(request)


@pytest.mark.django_db
class TestAdminListMixin:
    @pytest.fixture
    def rows(self):
        return [
            ContactMessage.objects.create(
                name="Carla", email="c@x.mx", subject="b", message="m", is_handled=True
            ),
            ContactMessage.objects.create(name="Ana", email="a@x.mx", subject="a", message="m"),
            ContactMessage.objects.create(name="Beto", email="b@x.mx", subject="a", message="m"),
        ]

    def test_settings_have_no_implicit_backends_and_the_shared_pager(self):
        assert settings.REST_FRAMEWORK["DEFAULT_FILTER_BACKENDS"] == []
        assert (
            settings.REST_FRAMEWORK["DEFAULT_PAGINATION_CLASS"]
            == "apps.core.listing.ListPagination"
        )
        assert ContactListView.filter_backends == []
        assert ListPagination.page_size_query_param == "page_size"
        assert ListPagination.max_page_size == 100

    def test_non_admin_is_403_by_default(self, rows, parent_user):
        assert _get(user=parent_user).status_code == 403

    def test_default_ordering_and_drf_shape(self, rows):
        resp = _get()
        assert resp.status_code == 200
        assert set(resp.data) == {"count", "next", "previous", "results"}
        assert [r["name"] for r in resp.data["results"]] == ["Ana", "Beto", "Carla"]

    def test_page_size_param(self, rows):
        resp = _get({"page_size": 2})
        assert len(resp.data["results"]) == 2 and resp.data["count"] == 3
        assert resp.data["next"] is not None

    def test_q_and_legacy_search_alias(self, rows):
        assert [r["name"] for r in _get({"q": "beto"}).data["results"]] == ["Beto"]
        assert [r["name"] for r in _get({"search": "b@x.mx"}).data["results"]] == ["Beto"]
        # q wins when both are sent.
        assert [r["name"] for r in _get({"q": "ana", "search": "beto"}).data["results"]] == ["Ana"]

    def test_whitelisted_ordering_with_compound_key_and_fallback(self, rows):
        assert [r["name"] for r in _get({"ordering": "-name"}).data["results"]] == [
            "Carla",
            "Beto",
            "Ana",
        ]
        assert [r["name"] for r in _get({"ordering": "both"}).data["results"]] == [
            "Ana",
            "Beto",
            "Carla",
        ]
        assert [r["name"] for r in _get({"ordering": "-both"}).data["results"]] == [
            "Carla",
            "Beto",
            "Ana",
        ]
        # Unknown key (or a relation probe) falls back to the default silently.
        resp = _get({"ordering": "email__password"})
        assert resp.status_code == 200
        assert [r["name"] for r in resp.data["results"]] == ["Ana", "Beto", "Carla"]

    def test_filterset_filters_and_validates(self, rows):
        assert [r["name"] for r in _get({"handled": "true"}).data["results"]] == ["Carla"]
        assert [r["name"] for r in _get({"handled": "false"}).data["results"]] == ["Ana", "Beto"]
        assert [r["name"] for r in _get({"min_id": rows[1].pk}).data["results"]] == ["Ana", "Beto"]
        resp = _get({"min_id": "x"})
        assert resp.status_code == 400 and "min_id" in resp.data

    def test_queryset_for_filters_reuses_the_pipeline(self, rows):
        request = APIRequestFactory().get("/x/")
        request.user = AdminFactory()
        qs = ContactListView.queryset_for_filters(
            request, {"handled": "false", "q": "x.mx", "ordering": "-name"}
        )
        assert [r.name for r in qs] == ["Beto", "Ana"]
        qs = ContactListView.queryset_for_filters(request, {"q": ["zzz"]})
        assert list(qs) == []
