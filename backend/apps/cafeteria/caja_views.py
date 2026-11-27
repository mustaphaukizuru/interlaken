"""
cafeteria/caja_views.py: the «Caja» console endpoints (front-desk top-ups).

GET  /cafeteria/admin/caja/lookup/?code=     the account a scanned credential or
                                              a typed matrícula / code names
GET  /cafeteria/admin/caja/topups/            today's desk top-ups (own; admins: all)
POST /cafeteria/admin/caja/topups/            record money received and load it
GET  /cafeteria/admin/caja/topups/<pk>/       one top-up (the printable receipt)
POST /cafeteria/admin/caja/topups/<pk>/void/  «Anular» with a reason
POST /cafeteria/admin/caja/topups/<pk>/verify/  card/link matched in MultiCobros

Area «caja» (owner 2026-11-27: Veronica records them); administrators always.
The money rules live in ``cafeteria.caja``.
"""

from __future__ import annotations

from django.utils import timezone
from django.utils.decorators import method_decorator
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.avatar import avatar_url
from apps.core.permissions import IsAdmin
from apps.core.ratelimit import ratelimit

from . import caja
from .models import TopUpRequest

AREA = "caja"


def _error(exc: caja.CajaError) -> Response:
    body = {"detail": exc.message, "code": exc.code, **exc.extra}
    return Response(body, status=exc.status)


def _is_admin(user) -> bool:
    return getattr(user, "role", "") == "admin" or getattr(user, "is_superuser", False)


def account_row(student) -> dict:
    from .admin_data import loyverse_code

    balance = getattr(getattr(student, "cafeteria_balance", None), "balance", None)
    return {
        "id": student.pk,
        "name": student.user.full_name,
        "tipo": student.tipo,
        "grade": student.grade,
        "group": student.group,
        "puesto_label": student.get_puesto_display() if student.tipo == "personal" else "",
        "student_id": student.student_id,
        "code": loyverse_code(student),
        "photo": avatar_url(student.user),
        "balance": None if balance is None else f"{caja.cents(balance):.2f}",
        "linked": bool(student.loyverse_id),
    }


def topup_row(t: TopUpRequest) -> dict:
    outcome = caja.outcome_of(t)
    return {
        "id": t.pk,
        "folio": t.receipt_folio,
        "student": {
            "id": t.student_id,
            "name": t.student.user.full_name,
            "grade": t.student.grade,
            "group": t.student.group,
            "tipo": t.student.tipo,
        },
        "amount": f"{caja.cents(t.amount):.2f}",
        "desk_method": t.desk_method,
        "desk_method_label": caja.method_label(t.desk_method),
        "reference": t.reference,
        "note": t.notes,
        "received_by": t.received_by.full_name if t.received_by_id else "",
        "created_at": t.created_at.isoformat(),
        "status": t.status,
        "state": "voided" if t.voided_at else outcome["state"],
        "push_note": t.loyverse_push_note,
        "balance": outcome["balance"],
        "voided_at": t.voided_at.isoformat() if t.voided_at else None,
        "voided_by": t.voided_by.full_name if t.voided_by_id else "",
        "void_reason": t.void_reason,
        "needs_verification": t.desk_needs_verification,
        "verified_at": t.desk_verified_at.isoformat() if t.desk_verified_at else None,
    }


def _rows_qs():
    return caja.desk_topups().select_related(
        "student__user", "student__cafeteria_balance", "received_by", "voided_by"
    )


class CajaLookupView(APIView):
    admin_area = AREA
    permission_classes = [IsAdmin]

    def get(self, request):
        code = str(request.query_params.get("code") or "").strip()
        if len(code) < 2:
            return Response(
                {"code": ["Escanee la credencial o escriba la matrícula."]},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return Response({"results": [account_row(s) for s in caja.lookup(code)]})


@method_decorator(ratelimit("caja-topup", "60/m", key="user", method="POST"), name="post")
class CajaTopUpListCreateView(APIView):
    admin_area = AREA
    permission_classes = [IsAdmin]

    def get(self, request):
        today = timezone.localdate()
        qs = _rows_qs().filter(created_at__date=today)
        # Each person sees what they received (their own corte); admins all.
        if not _is_admin(request.user) or request.query_params.get("mine") == "1":
            qs = qs.filter(received_by=request.user)
        return Response({"results": [topup_row(t) for t in qs.order_by("-created_at")[:200]]})

    def post(self, request):
        data = request.data if hasattr(request.data, "get") else {}
        confirm = str(data.get("confirm_duplicate", "")).lower() in ("1", "true", "yes")
        try:
            topup, outcome, created = caja.create_desk_topup(
                student_id=data.get("student"),
                amount=data.get("amount"),
                desk_method=str(data.get("desk_method") or ""),
                reference=data.get("reference") or "",
                note=data.get("note") or "",
                idempotency_key=data.get("idempotency_key") or "",
                confirm_duplicate=confirm,
                actor=request.user,
            )
        except caja.CajaError as exc:
            return _error(exc)
        topup = _rows_qs().get(pk=topup.pk)
        body = {"topup": topup_row(topup), "outcome": outcome, "created": created}
        return Response(body, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)


class CajaTopUpDetailView(APIView):
    admin_area = AREA
    permission_classes = [IsAdmin]

    def get(self, request, pk):
        topup = _rows_qs().filter(pk=pk).first()
        if topup is None or (
            not _is_admin(request.user) and topup.received_by_id != request.user.pk
        ):
            return Response({"detail": "No encontrado."}, status=status.HTTP_404_NOT_FOUND)
        return Response(
            {
                "topup": topup_row(topup),
                "details": caja.receipt_details(
                    topup,
                    getattr(getattr(topup.student, "cafeteria_balance", None), "balance", None),
                ),
            }
        )


class CajaVoidView(APIView):
    admin_area = AREA
    permission_classes = [IsAdmin]

    def post(self, request, pk):
        topup = _rows_qs().filter(pk=pk).first()
        if topup is None or (
            not _is_admin(request.user) and topup.received_by_id != request.user.pk
        ):
            return Response({"detail": "No encontrado."}, status=status.HTTP_404_NOT_FOUND)
        try:
            result = caja.void_desk_topup(pk, reason=request.data.get("reason"), actor=request.user)
        except caja.CajaError as exc:
            return _error(exc)
        return Response({"result": result, "topup": topup_row(_rows_qs().get(pk=pk))})


class CajaVerifyView(APIView):
    """Card and link desk top-ups matched in MultiCobros (cafetería staff too)."""

    admin_area = (AREA, "cafeteria")
    permission_classes = [IsAdmin]

    def post(self, request, pk):
        try:
            caja.verify_desk_topup(pk, actor=request.user)
        except caja.CajaError as exc:
            return _error(exc)
        return Response({"topup": topup_row(_rows_qs().get(pk=pk))})
