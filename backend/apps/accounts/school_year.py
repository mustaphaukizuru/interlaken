"""
New school year wizard (BACKLOG P4-5).

GET  /accounts/admin/school-year/preview/   what would happen: per-grade moves,
                                            graduates, skipped (on leave / withdrawn),
                                            current + suggested cycle label.
POST /accounts/admin/school-year/run/       {"confirm": "AVANZAR", "new_cycle": "2027-2028",
                                            "reset_threshold": 50 | null}
     Atomic: promotes every active student one grade, graduates 3° Secundaria,
     optionally resets every cafetería low-balance threshold, stamps the new
     cycle on SiteSettings and writes one AuditLog entry. Refuses to run twice
     for the same cycle.
"""
from __future__ import annotations

import re
from decimal import Decimal

from django.db import transaction
from django.utils import timezone
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.permissions import IsAdmin

from .models import StudentProfile

GRADE_SEQUENCE = [
    'Maternal', '1° Preescolar', '2° Preescolar', '3° Preescolar',
    '1° Primaria', '2° Primaria', '3° Primaria', '4° Primaria', '5° Primaria', '6° Primaria',
    '1° Secundaria', '2° Secundaria', '3° Secundaria',
]
CYCLE_RE = re.compile(r'^(\d{4})-(\d{4})$')


def next_grade(grade: str) -> str | None:
    """Next grade in the sequence; None = graduates. Unknown grades stay put."""
    g = (grade or '').strip()
    if g not in GRADE_SEQUENCE:
        return g
    i = GRADE_SEQUENCE.index(g)
    return GRADE_SEQUENCE[i + 1] if i + 1 < len(GRADE_SEQUENCE) else None


def suggested_cycle() -> str:
    y = timezone.localdate().year
    return f'{y}-{y + 1}'


def build_preview() -> dict:
    from apps.content.models import SiteSettings
    active = StudentProfile.objects.filter(status=StudentProfile.Status.ACTIVE)
    moves: dict[str, dict] = {}
    graduates = 0
    for grade in active.values_list('grade', flat=True):
        nxt = next_grade(grade)
        if nxt is None:
            graduates += 1
        m = moves.setdefault(grade, {'from': grade, 'to': nxt or 'Egresado', 'count': 0})
        m['count'] += 1
    skipped = StudentProfile.objects.exclude(status=StudentProfile.Status.ACTIVE).count()
    settings_obj = SiteSettings.load()
    return {
        'moves': sorted(moves.values(), key=lambda m: GRADE_SEQUENCE.index(m['from']) if m['from'] in GRADE_SEQUENCE else 99),
        'graduates': graduates,
        'active_total': active.count(),
        'skipped': skipped,
        'current_cycle': settings_obj.school_year or '',
        'suggested_cycle': suggested_cycle(),
        'last_rollover_at': settings_obj.last_rollover_at.isoformat() if settings_obj.last_rollover_at else None,
    }


class SchoolYearPreviewView(APIView):
    permission_classes = [IsAdmin]

    def get(self, request):
        return Response(build_preview())


class SchoolYearRunView(APIView):
    permission_classes = [IsAdmin]

    def post(self, request):
        from apps.cafeteria.models import CafeteriaBalance
        from apps.content.models import SiteSettings
        from apps.core.audit import record

        if request.data.get('confirm') != 'AVANZAR':
            return Response({'confirm': ['Escriba AVANZAR para confirmar.']}, status=status.HTTP_400_BAD_REQUEST)
        new_cycle = str(request.data.get('new_cycle') or '').strip()
        m = CYCLE_RE.match(new_cycle)
        if not m or int(m.group(2)) != int(m.group(1)) + 1:
            return Response({'new_cycle': ['Use el formato AAAA-AAAA, p. ej. 2027-2028.']}, status=status.HTTP_400_BAD_REQUEST)
        settings_obj = SiteSettings.load()
        if settings_obj.school_year == new_cycle:
            return Response({'new_cycle': [f'El ciclo {new_cycle} ya fue aplicado.']}, status=status.HTTP_400_BAD_REQUEST)
        reset_threshold = request.data.get('reset_threshold')
        if reset_threshold not in (None, ''):
            try:
                reset_threshold = Decimal(str(reset_threshold))
                if reset_threshold < 0 or reset_threshold > 5000:
                    raise ValueError
            except Exception:  # noqa: BLE001
                return Response({'reset_threshold': ['Monto no válido.']}, status=status.HTTP_400_BAD_REQUEST)
        else:
            reset_threshold = None

        promoted = graduated = 0
        with transaction.atomic():
            for sp in StudentProfile.objects.select_for_update().filter(status=StudentProfile.Status.ACTIVE).select_related('user'):
                nxt = next_grade(sp.grade)
                if nxt is None:
                    fields = sp.apply_status(StudentProfile.Status.GRADUATED)
                    sp.save(update_fields=fields)
                    graduated += 1
                elif nxt != sp.grade:
                    sp.grade = nxt
                    sp.save(update_fields=['grade'])
                    promoted += 1
            thresholds = 0
            if reset_threshold is not None:
                thresholds = CafeteriaBalance.objects.update(low_balance_threshold=reset_threshold)
            previous = settings_obj.school_year
            settings_obj.school_year = new_cycle
            settings_obj.last_rollover_at = timezone.now()
            settings_obj.save()
            record('update', settings_obj,
                   {'school_year': {'from': previous, 'to': new_cycle}, 'promoted': promoted, 'graduated': graduated, 'thresholds_reset': thresholds},
                   actor=request.user, context='school-year.rollover')
        return Response({'promoted': promoted, 'graduated': graduated, 'thresholds_reset': thresholds, 'school_year': new_cycle})
