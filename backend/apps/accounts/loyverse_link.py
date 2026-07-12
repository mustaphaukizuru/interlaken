"""
Admin endpoint: link the student roster to Loyverse in one pass.

POST /api/v1/accounts/admin/link-loyverse/
  body: commit=1|0 (default 0 — preview), overwrite=1|0 (default 0)

Mirrors the CSV-import UX: call once to preview the plan (how many would link,
already linked, unmatched), then again with commit=1 to persist. Backfills
StudentProfile.loyverse_id by matching Loyverse customer_code == matrícula. See
apps/cafeteria/services.link_students_to_loyverse for the matching rules.
"""
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.cafeteria.services import (LoyverseError, get_all_customers,
                                     link_students_to_loyverse)

from .import_students import IsAdmin


def _truthy(value) -> bool:
    return str(value).lower() in ('1', 'true', 'si', 'sí', 'on')


class LinkLoyverseView(APIView):
    """Backfill every student's ``loyverse_id`` from Loyverse (admin only)."""
    permission_classes = [IsAdmin]

    def post(self, request):
        commit = _truthy(request.data.get('commit', '0'))
        overwrite = _truthy(request.data.get('overwrite', '0'))

        try:
            customers = get_all_customers()
        except LoyverseError as e:
            # Expired/absent token or a Loyverse outage — surface it, don't 500.
            return Response(
                {'error': f'No se pudo conectar con Loyverse: {e}'},
                status=status.HTTP_502_BAD_GATEWAY)

        report = link_students_to_loyverse(customers, overwrite=overwrite, commit=commit)
        return Response(report)
