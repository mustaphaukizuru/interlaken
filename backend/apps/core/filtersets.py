"""
core/filtersets.py — lenient django-filter building blocks for admin lists (Data Ops C1).

The list contract applies a ``FilterSet`` per view. The console's filters live
in the URL, so a stale bookmark or a hand-edited link must show the unfiltered
list instead of a 400: every filter here *ignores* a value it cannot use, the
same rule ``apply_ordering`` (unknown key → default) and ``date_bounds``
(unparsable date → no bound) already follow.

* ``ChoiceParamFilter``: exact match on a choice column; comma lists allowed
  (``?status=received,in_review``); unknown values dropped.
* ``BoolParamFilter``: ``1/0``, ``true/false``, ``si/no``; anything else ignored.
* ``DateBoundFilter`` + ``with_date_range``: ``?from=`` / ``?to=`` as aware
  America/Mexico_City bounds (``field >= start AND field < end_exclusive``).
"""

from __future__ import annotations

import django_filters

from .listing import date_bounds

TRUE_VALUES = frozenset({"1", "true", "si", "sí", "yes", "on"})
FALSE_VALUES = frozenset({"0", "false", "no", "off"})


def parse_bool_param(value) -> bool | None:
    """``'1'`` → True, ``'0'`` → False, anything else → None (ignored)."""
    text = str(value if value is not None else "").strip().lower()
    if text in TRUE_VALUES:
        return True
    if text in FALSE_VALUES:
        return False
    return None


class ChoiceParamFilter(django_filters.CharFilter):
    """Exact match on a choice column; unknown values are ignored, not a 400."""

    def __init__(self, *args, choices=(), **kwargs):
        self.valid = frozenset(
            str(c[0]) if isinstance(c, (list, tuple)) else str(c) for c in choices
        )
        super().__init__(*args, **kwargs)

    def filter(self, qs, value):
        if value in (None, ""):
            return qs
        values = [v for v in (t.strip() for t in str(value).split(",")) if v in self.valid]
        if not values:
            return qs
        if len(values) == 1:
            return qs.filter(**{self.field_name: values[0]})
        return qs.filter(**{f"{self.field_name}__in": values})


class BoolParamFilter(django_filters.CharFilter):
    """``?handled=1`` / ``?handled=0``; unparsable values are ignored."""

    def filter(self, qs, value):
        parsed = parse_bool_param(value)
        if parsed is None:
            return qs
        return qs.filter(**{self.field_name: parsed})


class DateBoundFilter(django_filters.CharFilter):
    """One side of a date range on a datetime column (aware Mexico City bounds)."""

    def __init__(self, *args, bound: str = "from", **kwargs):
        if bound not in ("from", "to"):
            raise ValueError("bound must be 'from' or 'to'")
        self.bound = bound
        super().__init__(*args, **kwargs)

    def filter(self, qs, value):
        if value in (None, ""):
            return qs
        try:
            # parse_date raises on a well-formed but impossible date (2026-02-30).
            start, end = (
                date_bounds(value, None) if self.bound == "from" else date_bounds(None, value)
            )
        except ValueError:
            return qs
        if self.bound == "from":
            return qs.filter(**{f"{self.field_name}__gte": start}) if start else qs
        return qs.filter(**{f"{self.field_name}__lt": end}) if end else qs


class IdParamFilter(django_filters.CharFilter):
    """``?student=12``: exact match on a numeric id; non-digits are ignored."""

    def filter(self, qs, value):
        text = str(value or "").strip()
        if not text.isdigit():
            return qs
        return qs.filter(**{self.field_name: int(text)})


def with_date_range(field: str = "created_at", from_key: str = "from", to_key: str = "to"):
    """Class decorator adding ``?from=`` / ``?to=`` (``from`` is a Python keyword,
    so the filters cannot be declared as class attributes)."""

    def decorate(filterset_cls):
        filterset_cls.base_filters[from_key] = DateBoundFilter(field_name=field, bound="from")
        filterset_cls.base_filters[to_key] = DateBoundFilter(field_name=field, bound="to")
        return filterset_cls

    return decorate
