"""
admissions/filters.py — FilterSets for the Admisiones lists (Data Ops Phase 4).

Query params (API side; the console URL uses estado/nivel/ciclo/visita/desde/hasta):

* pre-registros:  ``status``, ``level``, ``cycle``, ``wants_visit``, ``from``, ``to``
* inscripciones:  ``status``, ``level``, ``cycle``, ``documents_pending``, ``from``, ``to``

``from``/``to`` are inclusive calendar days in America/Mexico_City applied to
``created_at`` through ``apps.core.listing.apply_date_range`` (aware bounds, so
the ``(status, -created_at)`` index can serve the query). ``from`` is a Python
keyword, which is why the range lives in ``filter_queryset`` rather than as a
declared filter. An unparsable date is ignored, like every list of the round.
"""

from __future__ import annotations

import django_filters
from django.db.models import Count, Q

from apps.core.listing import apply_date_range

from .models import PreRegistration, Registration, RegistrationDocument

REQUIRED_DOC_TYPES = [
    RegistrationDocument.DocType.BIRTH_CERT,
    RegistrationDocument.DocType.CURP_DOC,
    RegistrationDocument.DocType.PHOTO,
    RegistrationDocument.DocType.REPORT_CARD,
    RegistrationDocument.DocType.PROOF_ADDR,
    RegistrationDocument.DocType.VACCINATION,
]


class CreatedRangeFilterSet(django_filters.FilterSet):
    """Adds ``?from=&to=`` on ``created_at`` to any FilterSet."""

    date_field = "created_at"

    def filter_queryset(self, queryset):
        qs = super().filter_queryset(queryset)
        return apply_date_range(qs, self.date_field, self.data.get("from"), self.data.get("to"))


class PreRegistrationFilter(CreatedRangeFilterSet):
    status = django_filters.ChoiceFilter(choices=PreRegistration.Status.choices)
    level = django_filters.ChoiceFilter(choices=PreRegistration.Level.choices)
    cycle = django_filters.CharFilter(field_name="cycle")
    wants_visit = django_filters.BooleanFilter(field_name="wants_visit")

    class Meta:
        model = PreRegistration
        fields = ["status", "level", "cycle", "wants_visit"]


class RegistrationFilter(CreatedRangeFilterSet):
    status = django_filters.ChoiceFilter(choices=Registration.Status.choices)
    # Registration.level is free text (the family form sends the level word).
    level = django_filters.CharFilter(field_name="level", lookup_expr="iexact")
    cycle = django_filters.CharFilter(field_name="cycle")
    documents_pending = django_filters.BooleanFilter(method="filter_documents_pending")

    class Meta:
        model = Registration
        fields = ["status", "level", "cycle", "documents_pending"]

    def filter_documents_pending(self, queryset, name, value):
        """``true``: at least one required document is missing or not yet approved
        (the same rule as the pipeline checklist); ``false``: all six approved."""
        if value is None:
            return queryset
        qs = queryset.annotate(
            _docs_ok=Count(
                "documents__doc_type",
                filter=Q(documents__is_verified=True, documents__doc_type__in=REQUIRED_DOC_TYPES),
                distinct=True,
            )
        )
        if value:
            return qs.filter(_docs_ok__lt=len(REQUIRED_DOC_TYPES))
        return qs.filter(_docs_ok__gte=len(REQUIRED_DOC_TYPES))
