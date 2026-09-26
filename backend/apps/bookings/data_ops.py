"""
bookings/data_ops.py — list, export, bulk and import specs for Visitas (Data Ops Phase 5).

Everything the admin console's "Visitas" page needs beyond the plain models:

* FilterSets + ordering whitelists for the bookings and slots lists (C1/C2);
* export specs (CSV / XLSX / PDF) for both lists (C3);
* bulk actions: bookings confirm / cancel / attended / no_show through
  ``services.status.change_booking_status`` (transition table + capacity by
  ``num_attendees`` under a slot lock); slots activate / deactivate / delete
  (a slot with bookings is never deleted: CASCADE would erase the history) (C5);
* the slot import spec: ``tipo, fecha, inicio, fin, cupo, lugar`` (+ optional
  ``titulo``), matched on the model's unique tuple (C4).
"""

from __future__ import annotations

import re
from datetime import time

import django_filters
from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.core.bulk import BulkAction, BulkSkip
from apps.core.exporting import Col, ExportSpec
from apps.core.importing import ImportCol, ImportRow, ImportSpec, parse_choice, parse_date_es

from .models import AvailabilitySlot, Booking, VisitType
from .services.status import change_booking_status, occupied_seats, plan_booking_status

VISIT_TYPE_LABEL = {"individual": "Individual", "open_class": "Puertas Abiertas"}


# ── bookings: list ────────────────────────────────────────
class BookingFilterSet(django_filters.FilterSet):
    """``?type=&status=&source=&date=&from=&to=`` (dates are the slot's DateField)."""

    type = django_filters.ChoiceFilter(field_name="slot__visit_type", choices=VisitType.choices)
    status = django_filters.ChoiceFilter(field_name="status", choices=Booking.Status.choices)
    source = django_filters.ChoiceFilter(field_name="source", choices=Booking.Source.choices)
    date = django_filters.DateFilter(field_name="slot__date")
    slot = django_filters.NumberFilter(field_name="slot_id")


# ``from`` is a Python keyword: declare the range bounds on base_filters.
BookingFilterSet.base_filters["from"] = django_filters.DateFilter(
    field_name="slot__date", lookup_expr="gte"
)
BookingFilterSet.base_filters["to"] = django_filters.DateFilter(
    field_name="slot__date", lookup_expr="lte"
)

BOOKING_SEARCH_FIELDS = ("parent_name", "parent_email", "parent_phone", "child_name")
BOOKING_ORDERING = {
    "date": ("slot__date", "slot__start_time"),
    "status": "status",
    "parent": "parent_name",
    "child": "child_name",
    "created_at": "created_at",
    "attendees": "num_attendees",
}
BOOKING_DEFAULT_ORDERING = ("-slot__date", "-slot__start_time")


# ── slots: list ───────────────────────────────────────────
class SlotFilterSet(django_filters.FilterSet):
    """``?type=&active=true|false&from=&to=``."""

    type = django_filters.ChoiceFilter(field_name="visit_type", choices=VisitType.choices)
    active = django_filters.BooleanFilter(field_name="is_active")


SlotFilterSet.base_filters["from"] = django_filters.DateFilter(field_name="date", lookup_expr="gte")
SlotFilterSet.base_filters["to"] = django_filters.DateFilter(field_name="date", lookup_expr="lte")

SLOT_SEARCH_FIELDS = ("title", "location")
SLOT_ORDERING = {
    "date": ("date", "start_time"),
    "start": ("start_time", "date"),
    "type": "visit_type",
    "capacity": "capacity",
    "booked": "booked",
}
SLOT_DEFAULT_ORDERING = ("-date", "-start_time")


# ── exports ───────────────────────────────────────────────
def _hours(slot) -> str:
    if not slot or not slot.start_time:
        return ""
    return f"{slot.start_time:%H:%M}–{slot.end_time:%H:%M}"


BOOKING_EXPORT = ExportSpec(
    filename_prefix="visitas",
    title="Visitas",
    sheet_title="Visitas",
    audit_entity="bookings",
    columns=[
        Col("slot__date", "Fecha", width=12, fmt="date"),
        Col("hora", "Hora", getter=lambda b: _hours(b.slot), width=13),
        Col(
            "tipo",
            "Tipo",
            getter=lambda b: VISIT_TYPE_LABEL.get(b.slot.visit_type, b.slot.visit_type),
            width=16,
        ),
        Col("parent_name", "Tutor", width=24),
        Col("parent_email", "Correo", width=28),
        Col("parent_phone", "Teléfono", width=14),
        Col("child_name", "Alumno", width=22),
        Col("child_grade", "Grado de interés", width=16),
        Col("num_attendees", "Asistentes", width=10, fmt="int"),
        Col("estado", "Estado", getter=lambda b: b.get_status_display(), width=12),
        Col("origen", "Origen", getter=lambda b: b.get_source_display(), width=14),
        Col("resultado", "Resultado", getter=lambda b: b.get_outcome_display(), width=20),
        Col("created_at", "Creada", width=17, fmt="datetime"),
    ],
)

SLOT_EXPORT = ExportSpec(
    filename_prefix="horarios_visita",
    title="Horarios de visita",
    sheet_title="Horarios",
    audit_entity="bookings.slots",
    columns=[
        Col("date", "Fecha", width=12, fmt="date"),
        Col("inicio", "Inicio", getter=lambda s: f"{s.start_time:%H:%M}", width=8),
        Col("fin", "Fin", getter=lambda s: f"{s.end_time:%H:%M}", width=8),
        Col(
            "tipo",
            "Tipo",
            getter=lambda s: VISIT_TYPE_LABEL.get(s.visit_type, s.visit_type),
            width=16,
        ),
        Col("title", "Evento", width=22),
        Col("location", "Lugar", width=22),
        Col("capacity", "Cupo", width=8, fmt="int"),
        Col("booked", "Reservados", getter=lambda s: s.booked_count, width=10, fmt="int"),
        Col("libres", "Disponibles", getter=lambda s: s.spots_remaining, width=10, fmt="int"),
        Col("is_active", "Activo", width=8, fmt="bool"),
    ],
)


# ── bulk: bookings ────────────────────────────────────────
def _booking_action(name: str, label_es: str, target: str, *, requires_note=False) -> BulkAction:
    """A bulk status move that runs the exact single-row service."""

    def plan(instance, payload):
        plan_booking_status(instance, target, note=str(payload.get("note") or ""))

    def handler(instance, payload, actor):
        notify = payload.get("notify", True) not in (False, "false", "0", 0)
        previous = change_booking_status(
            instance, target, note=str(payload.get("note") or ""), notify=notify
        )
        return {"status": [previous, target]}

    return BulkAction(
        name=name,
        label_es=label_es,
        handler=handler,
        plan=plan,
        requires_note=requires_note,
        side_effects="per_row",
    )


BOOKING_BULK_ACTIONS = {
    a.name: a
    for a in (
        _booking_action("confirm", "Confirmar", Booking.Status.CONFIRMED),
        _booking_action("cancel", "Cancelar", Booking.Status.CANCELLED),
        _booking_action("attended", "Marcar asistió", Booking.Status.ATTENDED),
        _booking_action("no_show", "Marcar no asistió", Booking.Status.NO_SHOW),
    )
}


# ── bulk: slots ───────────────────────────────────────────
def _set_active(value: bool):
    def plan(instance, payload):
        if instance.is_active == value:
            raise BulkSkip("Ya estaba activo." if value else "Ya estaba inactivo.")

    def handler(instance, payload, actor):
        plan(instance, payload)
        instance.is_active = value
        instance.save(update_fields=["is_active"])
        return {"is_active": [not value, value]}

    return plan, handler


def _delete_plan(instance, payload):
    count = instance.bookings.count()
    if count:
        raise BulkSkip(
            f"Tiene {count} reserva(s); desactívelo para ocultarlo sin perder el historial."
        )


def _delete_handler(instance, payload, actor):
    _delete_plan(instance, payload)
    pk = instance.pk
    snapshot = {
        "deleted": {
            "visit_type": instance.visit_type,
            "date": instance.date.isoformat(),
            "start_time": f"{instance.start_time:%H:%M}",
            "end_time": f"{instance.end_time:%H:%M}",
        }
    }
    instance.delete()
    instance.pk = pk  # keep the id for the per-row audit entry
    return snapshot


_activate_plan, _activate = _set_active(True)
_deactivate_plan, _deactivate = _set_active(False)

SLOT_BULK_ACTIONS = {
    a.name: a
    for a in (
        BulkAction("activate", "Activar", _activate, plan=_activate_plan, side_effects="none"),
        BulkAction(
            "deactivate", "Desactivar", _deactivate, plan=_deactivate_plan, side_effects="none"
        ),
        BulkAction(
            "delete",
            "Eliminar",
            _delete_handler,
            plan=_delete_plan,
            side_effects="none",
            audit_action="delete",
        ),
    )
}


# ── import: slots ─────────────────────────────────────────
_TIME_RE = re.compile(r"^(\d{1,2})[:.h](\d{2})(?::\d{2})?$")


def parse_hhmm(value) -> time:
    """``'9:00'``, ``'09:00'``, ``'09.00'``, ``'09:00:00'`` → ``time(9, 0)``."""
    text = str(value or "").strip().lower().replace(" ", "")
    match = _TIME_RE.match(text)
    if not match:
        raise ValueError("hora inválida; use HH:MM")
    hour, minute = int(match.group(1)), int(match.group(2))
    if hour > 23 or minute > 59:
        raise ValueError("hora inválida; use HH:MM")
    return time(hour, minute)


def _parse_capacity(value) -> int:
    try:
        number = int(str(value).strip())
    except ValueError:
        raise ValueError("debe ser un número entero") from None
    if number < 1 or number > 1000:
        raise ValueError("debe estar entre 1 y 1000")
    return number


_parse_type = parse_choice(
    VisitType.choices,
    aliases={
        "puertas abiertas": VisitType.OPEN_CLASS,
        "clase abierta": VisitType.OPEN_CLASS,
        "open class": VisitType.OPEN_CLASS,
        "grupal": VisitType.OPEN_CLASS,
        "visita individual": VisitType.INDIVIDUAL,
    },
)


def _slot_key(data):
    return (data.get("tipo"), data.get("fecha"), data.get("inicio"), data.get("fin"))


def _find_slot(data):
    tipo, fecha, inicio, fin = _slot_key(data)
    if not all((tipo, fecha, inicio, fin)):
        return None
    return AvailabilitySlot.objects.filter(
        visit_type=tipo, date=fecha, start_time=inicio, end_time=fin
    ).first()


def _title_for(data) -> str:
    title = (data.get("titulo") or "").strip()
    if not title and data.get("tipo") == VisitType.OPEN_CLASS:
        return "Puertas Abiertas"  # same default as the slot generator
    return title


def _validate_slot_row(data: dict, row: ImportRow) -> None:
    inicio, fin, fecha = data.get("inicio"), data.get("fin"), data.get("fecha")
    if inicio and fin and fin <= inicio:
        row.error("fin: debe ser posterior al inicio.")
    if fecha and fecha < timezone.localdate():
        row.error("fecha: ya pasó; solo se importan horarios futuros.")
    cupo = data.get("cupo")
    if cupo and row.action != "error":
        existing = _find_slot(data)
        if existing is not None:
            taken = occupied_seats(existing)
            if cupo < taken:
                row.error(f"cupo: no puede ser menor que las {taken} plazas ya reservadas.")


def _changes(instance, data) -> dict:
    wanted = {
        "capacity": data["cupo"],
        "location": (data.get("lugar") or "").strip() or instance.location,
        "title": _title_for(data) or instance.title,
    }
    return {k: v for k, v in wanted.items() if getattr(instance, k) != v}


def _skip_unchanged(data, instance):
    if instance is not None and not _changes(instance, data):
        return "Ya existe con los mismos datos."
    return None


def _create_slot(data, actor):
    # get_or_create on the unique tuple, like the slot generator, so a slot
    # created between the dry-run and the commit is updated, not duplicated.
    try:
        with transaction.atomic():
            slot, created = AvailabilitySlot.objects.get_or_create(
                visit_type=data["tipo"],
                date=data["fecha"],
                start_time=data["inicio"],
                end_time=data["fin"],
                defaults={
                    "title": _title_for(data),
                    "capacity": data["cupo"],
                    "location": (data.get("lugar") or "").strip() or "Campus Interlaken",
                    "is_active": True,
                },
            )
    except IntegrityError:  # lost a race on the unique tuple
        slot, created = _find_slot(data), False
    if not created and slot is not None:
        return _update_slot(slot, data, actor)
    return slot


def _update_slot(instance, data, actor):
    changes = _changes(instance, data)
    if "capacity" in changes and changes["capacity"] < occupied_seats(instance):
        raise ValueError("el cupo no puede ser menor que las plazas ya reservadas")
    for key, value in changes.items():
        setattr(instance, key, value)
    if changes:
        instance.save(update_fields=list(changes))
    return instance


SLOT_IMPORT = ImportSpec(
    entity="bookings.slots",
    label="Horarios de visita",
    columns=[
        ImportCol(
            "tipo",
            ("tipo_de_visita", "visit_type", "type"),
            required=True,
            parse=_parse_type,
            example="individual",
        ),
        ImportCol(
            "fecha", ("date", "dia"), required=True, parse=parse_date_es, example="15/10/2026"
        ),
        ImportCol(
            "inicio",
            ("hora_inicio", "hora_de_inicio", "start", "start_time"),
            required=True,
            parse=parse_hhmm,
            example="09:00",
        ),
        ImportCol(
            "fin",
            ("hora_fin", "hora_de_fin", "end", "end_time"),
            required=True,
            parse=parse_hhmm,
            example="09:30",
        ),
        ImportCol(
            "cupo",
            ("capacidad", "capacity", "lugares"),
            required=True,
            parse=_parse_capacity,
            example="1",
        ),
        ImportCol("lugar", ("ubicacion", "location", "sede"), example="Campus Interlaken"),
        ImportCol("titulo", ("evento", "nombre", "title"), example=""),
    ],
    dedupe_keys=[("tipo", "fecha", "inicio", "fin")],
    db_match=_find_slot,
    create=_create_slot,
    update=_update_slot,
    validate_row=_validate_slot_row,
    skip_reason=_skip_unchanged,
    key_of=lambda d: " ".join(
        str(v)
        for v in (
            VISIT_TYPE_LABEL.get(d.get("tipo"), d.get("tipo") or ""),
            d["fecha"].strftime("%d/%m/%Y") if d.get("fecha") else "",
            d["inicio"].strftime("%H:%M") if d.get("inicio") else "",
        )
        if v
    ),
)
