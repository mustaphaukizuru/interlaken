"""
cafeteria/corte_views.py: «Corte de caja» and «Ingresos de cafetería» endpoints.

GET  /cafeteria/admin/caja/corte/?day=&user=      one person's corte (own; admins any)
GET  /cafeteria/admin/caja/cortes/?day=           everyone who took desk money that day (admins)
POST /cafeteria/admin/caja/corte/close/           close a day {day, counted_cash, counted_card?,
                                                  counted_link?, note?, user? (admins)}
POST /cafeteria/admin/caja/corte/<pk>/reopen/     reopen a closed day {reason} (admins)
GET  /cafeteria/admin/ingresos/?month=YYYY-MM | ?from=&to=   income by channel and day
GET  /cafeteria/admin/ingresos/export/?fmt=csv|xlsx|pdf&…    the same, as a file (audited)

The corte belongs to the «Caja» area (each person sees their own, admins see
everyone's and reopen); the income report to «Cafetería y pagos». The rules
live in ``cafeteria.corte`` and ``cafeteria.ingresos``.
"""

from __future__ import annotations

from datetime import date, timedelta

from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.audit import record_export
from apps.core.exporting import Col, ExportSpec, parse_fmt, render_export
from apps.core.permissions import IsAdmin
from apps.core.throttling import SharedScopedRateThrottle

from . import corte, ingresos
from .caja import CajaError
from .caja_views import _error, _is_admin


def _parse_day(value, *, default: date | None = None) -> date:
    if value in (None, ""):
        return default or corte.today()
    try:
        return date.fromisoformat(str(value).strip())
    except ValueError:
        raise CajaError("Use una fecha AAAA-MM-DD.", code="day") from None


def _target_user(request):
    """The corte's owner: oneself, or (admins only) ``?user=`` / ``user``."""
    from apps.accounts.models import User

    raw = (
        request.query_params.get("user")
        if request.method == "GET"
        else (request.data.get("user") if hasattr(request.data, "get") else None)
    )
    if raw in (None, "", str(request.user.pk)) or not _is_admin(request.user):
        return request.user
    try:
        return User.objects.get(pk=int(raw))
    except (User.DoesNotExist, ValueError, TypeError):
        raise CajaError("Persona no encontrada.", code="user", status=404) from None


class CorteView(APIView):
    admin_area = "caja"
    permission_classes = [IsAdmin]

    def get(self, request):
        try:
            day = _parse_day(request.query_params.get("day"))
            user = _target_user(request)
        except CajaError as exc:
            return _error(exc)
        return Response(corte.summary(user, day))


class CortesView(APIView):
    """Admins: every person with desk money (or a corte) on ``day``."""

    admin_area = "caja"
    permission_classes = [IsAdmin]

    def get(self, request):
        if not _is_admin(request.user):
            return Response(
                {"detail": "Solo un administrador ve los cortes de todos."},
                status=status.HTTP_403_FORBIDDEN,
            )
        try:
            day = _parse_day(request.query_params.get("day"))
        except CajaError as exc:
            return _error(exc)
        people = []
        for user in corte.people_for_day(day):
            s = corte.summary(user, day)
            people.append(
                {
                    "user": s["user"],
                    "expected_total": s["expected_total"],
                    "count": s["count"],
                    "closed": bool(s["close"] and s["close"]["closed"]),
                }
            )
        return Response({"day": day.isoformat(), "people": people})


class CorteCloseView(APIView):
    admin_area = "caja"
    permission_classes = [IsAdmin]

    def post(self, request):
        data = request.data if hasattr(request.data, "get") else {}
        try:
            day = _parse_day(data.get("day"))
            user = _target_user(request)
            corte.close_day(
                user=user,
                day=day,
                counted_cash=data.get("counted_cash"),
                counted_card=data.get("counted_card"),
                counted_link=data.get("counted_link"),
                note=data.get("note") or "",
                actor=request.user,
            )
        except CajaError as exc:
            return _error(exc)
        return Response(corte.summary(user, day))


class CorteReopenView(APIView):
    admin_area = "caja"
    permission_classes = [IsAdmin]

    def post(self, request, pk):
        if not _is_admin(request.user):
            return Response(
                {"detail": "Solo un administrador puede reabrir un corte."},
                status=status.HTTP_403_FORBIDDEN,
            )
        try:
            close = corte.reopen_day(pk, reason=request.data.get("reason"), actor=request.user)
        except CajaError as exc:
            return _error(exc)
        return Response(corte.summary(close.user, close.day))


def _range(request) -> tuple[date, date, dict]:
    """``?month=YYYY-MM`` (default: this month) or ``?from=&to=``."""
    q = request.query_params
    if q.get("from") or q.get("to"):
        start = _parse_day(q.get("from"), default=corte.today())
        end = _parse_day(q.get("to"), default=start)
        return start, end, {"from": start.isoformat(), "to": end.isoformat()}
    raw = str(q.get("month") or "").strip()
    try:
        year, month = (
            (int(x) for x in raw.split("-")) if raw else (corte.today().year, corte.today().month)
        )
        start = date(year, month, 1)
    except (ValueError, TypeError):
        raise CajaError("Use un mes AAAA-MM.", code="month") from None
    end = date(year + (month == 12), month % 12 + 1, 1) - timedelta(days=1)
    return start, end, {"month": f"{year:04d}-{month:02d}"}


class IngresosView(APIView):
    admin_area = "cafeteria"
    permission_classes = [IsAdmin]

    def get(self, request):
        try:
            start, end, _filters = _range(request)
        except CajaError as exc:
            return _error(exc)
        return Response(ingresos.serialize(ingresos.report(start, end)))


def _money_col(key, header):
    return Col(key, header, width=14, fmt="money")


INGRESOS_EXPORT = ExportSpec(
    filename_prefix="ingresos_cafeteria",
    title="Ingresos de cafetería",
    sheet_title="Ingresos",
    audit_entity="cafeteria_ingresos",
    columns=[
        Col("day", "Día", width=14),
        *[_money_col(k, label) for k, label in ingresos.CHANNELS],
        _money_col("total", "Total"),
        Col("count", "Recargas", width=10, fmt="int"),
        _money_col("pending_load", "Pendiente de cargar en Loyverse"),
        _money_col("to_verify", "Por verificar en MultiCobros"),
    ],
)


class IngresosExportView(APIView):
    admin_area = "cafeteria"
    permission_classes = [IsAdmin]
    throttle_classes = [SharedScopedRateThrottle]
    throttle_scope = "admin-export"

    def get(self, request):
        try:
            fmt = parse_fmt(request)
            start, end, filters = _range(request)
        except CajaError as exc:
            return _error(exc)
        rep = ingresos.report(start, end)
        rows = [{**r, "day": r["day"].strftime("%d/%m/%Y")} for r in rep["rows"]]
        rows.append({**rep["totals"], "day": "Total"})
        response = render_export(rows, INGRESOS_EXPORT, fmt)
        record_export(INGRESOS_EXPORT.audit_entity, fmt, filters, len(rows), request.user)
        return response
