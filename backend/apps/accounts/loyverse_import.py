"""
Admin endpoint: import the student roster from Loyverse in one pass.

POST /api/v1/accounts/admin/import-loyverse/
  body: commit=1|0 (default 0 — preview), seed_balances=1|0 (default 1)

Mirrors the LinkLoyverse / CSV-import UX: call once to preview (how many would
be created/updated), then again with commit=1 to persist. On commit, also runs
``link_students_to_loyverse`` so existing roster rows without a Loyverse id get
linked. See ``apps.cafeteria.services.import_students_from_loyverse``.
"""
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.cafeteria.services import (
    LoyverseError,
    get_all_customers,
    import_students_from_loyverse,
    link_students_to_loyverse,
)

from .import_students import IsAdmin


def _truthy(value) -> bool:
    return str(value).lower() in ('1', 'true', 'si', 'sí', 'on')


def _serialize_import(report: dict) -> dict:
    """JSON-safe copy (Decimal → str)."""
    out = dict(report)
    out['balance_seeded'] = str(report.get('balance_seeded', '0'))
    return out


class ImportLoyverseView(APIView):
    """Create/refresh students from Loyverse customers (admin only)."""
    permission_classes = [IsAdmin]

    def post(self, request):
        commit = _truthy(request.data.get('commit', '0'))
        seed_balances = _truthy(request.data.get('seed_balances', '1'))

        try:
            customers = get_all_customers()
        except LoyverseError as e:
            return Response(
                {'error': f'No se pudo conectar con Loyverse: {e}'},
                status=status.HTTP_502_BAD_GATEWAY)

        import_report = import_students_from_loyverse(
            customers, commit=commit, seed_balances=seed_balances)
        # Always preview/apply the link pass on the same customer snapshot so
        # CSV-imported students without a Loyverse id get linked too.
        link_report = link_students_to_loyverse(customers, commit=commit)

        return Response({
            'import': _serialize_import(import_report),
            'link': link_report,
        })
