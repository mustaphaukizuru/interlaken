"""
core/listing.py — the one list contract for admin endpoints (Data Ops C1).

Every admin list used to pick its own search param (``search`` here, ``q``
there), its own pager and its own sort. Worse, DRF's implicit ``OrderingFilter``
ran *after* the hand-written ``apply_ordering`` on generic lists, accepted any
serializer field and dropped the ``-pk`` tiebreak. This module is the single
place the console relies on:

* ``ListPagination``: DRF page numbers, ``?page_size=`` up to 100.
* ``AdminListMixin``: ``?q=`` search over ``search_fields`` (the legacy
  ``search`` alias was removed in Phase 10), whitelisted ``?ordering=`` through ``apply_ordering``,
  optional django-filter ``filterset_class``, and an explicitly EMPTY
  ``filter_backends`` so the implicit backends can never re-sort a list.
* ``date_bounds``: aware ``datetime`` bounds in America/Mexico_City so date
  filters compile to ``field >= start AND field < end`` and can use an index
  (``field__date__gte`` wraps the column in a cast and defeats every b-tree).

The bulk contract (``apps.core.bulk``) reuses ``queryset_for_filters`` so
"select all N matching" and the list itself can never disagree.
"""

from __future__ import annotations

import unicodedata
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from django.db import connection
from django.db.models import CharField, Q, TextField, Transform
from django.http import QueryDict
from django.utils.dateparse import parse_date
from rest_framework.exceptions import ValidationError
from rest_framework.pagination import PageNumberPagination
from rest_framework.request import Request
from rest_framework.test import APIRequestFactory

from .ordering import apply_ordering
from .permissions import IsAdmin

MEXICO_CITY = ZoneInfo("America/Mexico_City")


# ── pagination ────────────────────────────────────────────
class ListPagination(PageNumberPagination):
    """``{count, next, previous, results}`` with a client-chosen page size (≤ 100)."""

    page_size = 20
    page_size_query_param = "page_size"
    max_page_size = 100


# ── search ────────────────────────────────────────────────
class UnaccentTransform(Transform):
    """Postgres ``immutable_unaccent(col)``; bilateral so the search term is folded too.

    ``immutable_unaccent`` is the IMMUTABLE wrapper over the ``unaccent``
    extension created by ``core.0006_audit_search_unaccent_trgm``: unlike the
    STABLE ``unaccent()`` it can be indexed, so ``UPPER(immutable_unaccent(col))
    LIKE ...`` uses the trigram indexes (Data Ops Phase 10, docs/PERFORMANCE.md).
    """

    bilateral = True
    lookup_name = "unaccent"
    function = "IMMUTABLE_UNACCENT"


_unaccent_registered = False


def _register_unaccent():
    global _unaccent_registered
    if not _unaccent_registered:
        CharField.register_lookup(UnaccentTransform)
        TextField.register_lookup(UnaccentTransform)
        _unaccent_registered = True


# Accents folded with plain ``REPLACE`` (every database has it; no extension,
# no migration): «hernandez» finds «Hernández», «sofia» finds «Sofía», «pena»
# finds «Peña». Both cases are listed because SQLite's LOWER/LIKE only fold
# ASCII; the result is lower-case ASCII for these letters, so ``icontains``
# does the rest.
_FOLD_PAIRS = tuple(
    (accented, plain)
    for plain, letters in (
        ("a", "áàäâÁÀÄÂ"), ("e", "éèëêÉÈËÊ"), ("i", "íìïîÍÌÏÎ"),
        ("o", "óòöôÓÒÖÔ"), ("u", "úùüûÚÙÜÛ"), ("n", "ñÑ"), ("c", "çÇ"),
    )
    for accented in letters
)


class FoldAccentsTransform(Transform):
    """``REPLACE(REPLACE(col, 'á', 'a'), ...)``; bilateral, so the search term
    is folded by the same SQL. Used where ``immutable_unaccent`` cannot fold:
    SQLite, and a PostgreSQL without the ``unaccent`` extension (the
    ``core.0006`` wrapper is then the identity)."""

    bilateral = True
    lookup_name = "foldaccents"

    def as_sql(self, compiler, connection):
        sql, params = compiler.compile(self.lhs)
        params = list(params)
        for accented, plain in _FOLD_PAIRS:
            sql = f"REPLACE({sql}, %s, %s)"
            params += [accented, plain]
        return sql, params


_fold_registered = False


def _register_fold():
    global _fold_registered
    if not _fold_registered:
        CharField.register_lookup(FoldAccentsTransform)
        TextField.register_lookup(FoldAccentsTransform)
        _fold_registered = True


_pg_unaccent_folds: bool | None = None


def _postgres_unaccent_folds() -> bool:
    """True when ``public.immutable_unaccent`` really folds accents (the
    ``unaccent`` extension is installed). Checked once per process, in a
    savepoint so a missing function never breaks the request's transaction."""
    global _pg_unaccent_folds
    if _pg_unaccent_folds is None:
        from django.db import transaction

        try:
            with transaction.atomic(), connection.cursor() as cursor:
                cursor.execute("SELECT public.immutable_unaccent(%s)", ["Hernández"])
                _pg_unaccent_folds = cursor.fetchone()[0] == "Hernandez"
        except Exception:  # noqa: BLE001 - no wrapper: fall back to REPLACE
            _pg_unaccent_folds = False
    return _pg_unaccent_folds


def search_lookup(field: str) -> str:
    """An accent- and case-insensitive ``contains`` for ``field``.

    PostgreSQL with the ``unaccent`` extension: ``field__unaccent__icontains``
    (``immutable_unaccent``, the expression the trigram indexes of
    ``core.0006`` cover). Anywhere else (SQLite, or PostgreSQL without the
    extension): ``field__foldaccents__icontains``. Either way «Lucia» finds
    «Lucía» and the reverse (QA 2026-11-24: on SQLite, and on a database
    without the extension, «hernandez» found nobody).
    """
    if connection.vendor == "postgresql" and _postgres_unaccent_folds():
        _register_unaccent()
        return f"{field}__unaccent__icontains"
    _register_fold()
    return f"{field}__foldaccents__icontains"


def split_terms(raw: str) -> list[str]:
    """Whitespace/comma separated terms (same tokenising as DRF's SearchFilter)."""
    return [t for t in (raw or "").replace(",", " ").split() if t]


def strip_accents(text: str) -> str:
    return "".join(
        ch for ch in unicodedata.normalize("NFKD", str(text or "")) if not unicodedata.combining(ch)
    )


def search_q(fields, raw: str, *, normalize=None) -> Q | None:
    """AND of per-term ORs across ``fields``; ``None`` when there is nothing to search.

    ``normalize(term) -> str`` rewrites each term before matching (the roster
    passes ``apps.core.matricula.search_key`` so ``ci09932`` finds ``09932``).
    """
    terms = split_terms(raw)
    if normalize is not None:
        terms = [t for t in (normalize(term) for term in terms) if t]
    if not terms or not fields:
        return None
    combined = Q()
    for term in terms:
        term_q = Q()
        for field in fields:
            term_q |= Q(**{search_lookup(field): term})
        combined &= term_q
    return combined


# ── date bounds ───────────────────────────────────────────
def day_start(d: date) -> datetime:
    """Aware midnight in America/Mexico_City at the start of ``d``."""
    return datetime.combine(d, time.min, tzinfo=MEXICO_CITY)


def day_end_exclusive(d: date) -> datetime:
    """Aware midnight in America/Mexico_City of the day AFTER ``d`` (exclusive bound)."""
    return day_start(d + timedelta(days=1))


def _to_date(value) -> date | None:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    try:
        return parse_date(str(value).strip())
    except ValueError:  # well formed but impossible («2026-02-30»): ignored like a typo
        return None


def date_bounds(param_from, param_to) -> tuple[datetime | None, datetime | None]:
    """``('2026-03-01', '2026-03-31')`` → aware ``(start, end_exclusive)``.

    Inputs are the raw ``?from=`` / ``?to=`` values (ISO dates, or ``date``
    objects); an unparsable value is ignored (``None``) so a stale bookmark
    shows the unfiltered list instead of a 500. ``to`` is inclusive for the
    caller and exclusive in the returned bound, so a query reads
    ``field__gte=start, field__lt=end``.
    """
    start_date = _to_date(param_from)
    end_date = _to_date(param_to)
    start = day_start(start_date) if start_date else None
    end = day_end_exclusive(end_date) if end_date else None
    return start, end


def apply_date_range(qs, field: str, param_from, param_to):
    """Filter ``qs`` on ``field`` with the bounds of ``date_bounds``."""
    start, end = date_bounds(param_from, param_to)
    if start is not None:
        qs = qs.filter(**{f"{field}__gte": start})
    if end is not None:
        qs = qs.filter(**{f"{field}__lt": end})
    return qs


# ── the mixin ─────────────────────────────────────────────
class AdminListMixin:
    """Search + whitelisted ordering + FilterSet + pagination for a generic list view.

    Declare per view::

        class AdminFooListView(AdminListMixin, generics.ListAPIView):
            search_fields = ('name', 'email')
            ordering = {'name': 'name', 'date': 'created_at'}
            default_ordering = '-created_at'
            filterset_class = FooFilterSet          # optional

    ``filter_queryset`` applies, in order: FilterSet → search → ordering. The
    bulk contract reuses that exact pipeline through ``queryset_for_filters``.
    """

    permission_classes = [IsAdmin]
    filter_backends: list = []  # explicitly empty: no implicit OrderingFilter/SearchFilter
    pagination_class = ListPagination

    search_fields: tuple[str, ...] = ()
    search_param = "q"
    ordering: dict[str, str | tuple[str, ...]] = {}
    default_ordering: str | tuple[str, ...] = "-pk"
    filterset_class = None

    # -- search --------------------------------------------------------
    def get_search_term(self) -> str:
        params = self.request.query_params
        return (params.get(self.search_param) or "").strip()

    @staticmethod
    def normalize_search_term(term: str) -> str:
        """Hook: rewrite one search term before matching (identity by default).

        The roster sets it to ``apps.core.matricula.search_key`` so the
        Loyverse spelling ``ci09932`` finds the stored digits ``09932``.
        """
        return term

    def apply_search(self, qs):
        q = search_q(
            self.search_fields, self.get_search_term(), normalize=self.normalize_search_term
        )
        return qs.filter(q) if q is not None else qs

    # -- filters -------------------------------------------------------
    def apply_filterset(self, qs):
        if self.filterset_class is None:
            return qs
        fs = self.filterset_class(self.request.query_params, queryset=qs, request=self.request)
        if not fs.is_valid():
            raise ValidationError(fs.errors)
        return fs.qs

    # -- ordering ------------------------------------------------------
    def apply_list_ordering(self, qs):
        return apply_ordering(qs, self.request, self.ordering, self.default_ordering)

    # -- the pipeline --------------------------------------------------
    def filter_list(self, qs):
        qs = self.apply_filterset(qs)
        qs = self.apply_search(qs)
        return self.apply_list_ordering(qs)

    def filter_queryset(self, queryset):
        return self.filter_list(queryset)

    @classmethod
    def queryset_for_filters(cls, request, filters: dict | None = None):
        """The list's filtered queryset for an arbitrary ``filters`` dict.

        Used by ``apps.core.bulk`` for ``all_matching``: the bulk POST carries
        the list page's query params as ``filters`` and must select exactly
        the rows the person is looking at.
        """
        params = QueryDict(mutable=True)
        for key, value in (filters or {}).items():
            if isinstance(value, (list, tuple)):
                params.setlist(key, [str(v) for v in value])
            elif value is not None:
                params[key] = str(value)
        django_request = APIRequestFactory().get(request.path, params)
        drf_request = Request(django_request)
        drf_request.user = request.user
        view = cls()
        view.request = drf_request
        view.format_kwarg = None
        view.args, view.kwargs = (), {}
        return view.filter_queryset(view.get_queryset())
