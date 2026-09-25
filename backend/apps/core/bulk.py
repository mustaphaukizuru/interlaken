"""
core/bulk.py — the one bulk-action contract for admin lists (Data Ops C5).

    POST /api/v1/<app>/admin/<entity>/bulk/
    {"action": "confirm", "ids": [1, 2, 3], "all_matching": false,
     "filters": {...}, "payload": {"note": "..."}, "dry_run": false}

    → {"action": "confirm", "requested": 3, "ok": 2,
       "failed": [{"id": 3, "error": "..."}], "skipped": [{"id": 2, "reason": "..."}],
       "dry_run": false}

* ``ids`` is capped at 500 per call; ``all_matching`` reuses the list view's
  own filter pipeline (``AdminListMixin.queryset_for_filters``) and is capped
  at 2,000 matches. Above a cap → 413.
* Rows are processed in chunks of 100, each chunk in a transaction with the
  rows locked (``select_for_update``), each row in its own savepoint so one
  failure never rolls back its neighbours. Every row gets ``record()``; one
  summary row (``object_type='bulk:<entity>'``) closes the call.
* ``dry_run`` runs the transition guard and the action's ``plan`` hook only,
  so the confirm dialog can say "Se confirmarán 14; 2 se omitirán".
* Side effects: ``per_row`` (the handler sends its own email/notification),
  ``batched`` (``after(instances, payload, actor)`` runs once at the end) or
  ``none``.
"""

from __future__ import annotations

import logging
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from typing import Any

from django.apps import apps
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from rest_framework import serializers
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from .audit import record
from .exceptions import PayloadTooLarge
from .permissions import IsAdmin
from .throttling import SharedScopedRateThrottle
from .transitions import TransitionError, assert_transition, label, transition_code

logger = logging.getLogger(__name__)

MAX_IDS = 500
MAX_MATCHING = 2_000
CHUNK = 100
SIDE_EFFECTS = ("per_row", "batched", "none")


class BulkSkip(Exception):
    """Raised by a handler or plan hook to report the row as *omitido* (not an error)."""


@dataclass
class BulkAction:
    """One named action of a bulk endpoint.

    ``handler(instance, payload, actor)`` applies the change and may return a
    dict merged into the row's audit ``changes``. ``plan(instance, payload)``
    is the dry-run check (raise ``BulkSkip`` / ``ValidationError``). When
    ``allowed_from`` is set, rows in another state are skipped before either
    hook runs.
    """

    name: str
    label_es: str
    handler: Callable[[Any, dict, Any], dict | None]
    allowed_from: frozenset[str] | set[str] | None = None
    status_field: str = "status"
    requires_note: bool = False
    side_effects: str = "per_row"
    plan: Callable[[Any, dict], Any] | None = None
    after: Callable[[list, dict, Any], None] | None = None
    audit_action: str = "update"

    def __post_init__(self):
        if self.side_effects not in SIDE_EFFECTS:
            raise ValueError(f"side_effects must be one of {SIDE_EFFECTS}")


def status_action(
    name: str,
    label_es: str,
    *,
    entity: str,
    target: str,
    status_field: str = "status",
    apply=None,
    requires_note: bool = False,
    side_effects: str = "none",
) -> BulkAction:
    """A ``BulkAction`` that moves ``status_field`` to ``target`` under the transition table.

    ``apply(instance, payload, actor)`` replaces the default ``save`` when the
    entity needs more than a column write (e.g. a booking confirm that must
    lock the slot); it runs after ``assert_transition`` passed.
    """

    def plan(instance, payload):
        assert_transition(
            entity, getattr(instance, status_field), target, note=str(payload.get("note") or "")
        )

    def handler(instance, payload, actor):
        current = getattr(instance, status_field)
        assert_transition(entity, current, target, note=str(payload.get("note") or ""))
        if apply is not None:
            apply(instance, payload, actor)
        else:
            setattr(instance, status_field, target)
            instance.save(update_fields=[status_field])
        return {status_field: [current, target]}

    return BulkAction(
        name=name,
        label_es=label_es,
        handler=handler,
        plan=plan,
        status_field=status_field,
        requires_note=requires_note,
        side_effects=side_effects,
    )


class BulkRequestSerializer(serializers.Serializer):
    action = serializers.CharField(max_length=40)
    ids = serializers.ListField(
        child=serializers.IntegerField(min_value=1), required=False, default=list, allow_empty=True
    )
    all_matching = serializers.BooleanField(required=False, default=False)
    filters = serializers.DictField(required=False, default=dict)
    payload = serializers.DictField(required=False, default=dict)
    dry_run = serializers.BooleanField(required=False, default=False)

    def validate(self, attrs):
        if not attrs.get("all_matching") and not attrs.get("ids"):
            raise ValidationError({"ids": ["Seleccione al menos una fila."]})
        return attrs


def chunked(seq: Iterable, size: int):
    seq = list(seq)
    for i in range(0, len(seq), size):
        yield seq[i : i + size]


def _message(exc: Exception) -> str:
    detail = getattr(exc, "detail", None)
    if detail is not None:
        return _flatten(detail)
    messages = getattr(exc, "messages", None)
    if messages:
        return "; ".join(str(m) for m in messages)
    return str(exc) or exc.__class__.__name__


def _flatten(value) -> str:
    if isinstance(value, dict):
        return "; ".join(f"{k}: {_flatten(v)}" for k, v in value.items())
    if isinstance(value, (list, tuple)):
        return "; ".join(_flatten(v) for v in value)
    return str(value)


def _safe_payload(payload: dict) -> dict:
    out = {}
    for key, value in (payload or {}).items():
        if isinstance(value, (str, int, float, bool)) or value is None:
            out[str(key)] = value if not isinstance(value, str) else value[:200]
        else:
            out[str(key)] = str(value)[:200]
    return out


def _process_row(
    instance,
    action: BulkAction,
    payload: dict,
    actor,
    *,
    entity: str,
    dry_run: bool,
    note: str,
    context: str,
):
    """→ ``('ok', None) | ('skipped', reason) | ('failed', error)`` for one row."""
    if action.allowed_from is not None:
        current = getattr(instance, action.status_field, None)
        if current not in action.allowed_from:
            return "skipped", (
                f"Estado actual «{label(entity, current)}» no admite " f"{action.label_es.lower()}."
            )
    if dry_run:
        if action.plan is None:
            return "ok", None
        try:
            action.plan(instance, payload)
        except BulkSkip as skip:
            return "skipped", str(skip) or "Omitido."
        except TransitionError as exc:
            kind = "skipped" if transition_code(exc) in ("same_state", "not_allowed") else "failed"
            return kind, _message(exc)
        except (ValidationError, DjangoValidationError, ValueError) as exc:
            return "failed", _message(exc)
        return "ok", None

    try:
        with transaction.atomic():
            changes = action.handler(instance, payload, actor)
            audit = {"bulk": action.name}
            if note:
                audit["note"] = note
            if isinstance(changes, dict):
                audit.update(changes)
            record(
                action.audit_action,
                instance,
                audit,
                actor=actor,
                context=context or f"bulk:{entity}:{action.name}",
            )
        return "ok", None
    except BulkSkip as skip:
        return "skipped", str(skip) or "Omitido."
    except TransitionError as exc:
        kind = "skipped" if transition_code(exc) in ("same_state", "not_allowed") else "failed"
        return kind, _message(exc)
    except (ValidationError, DjangoValidationError, ValueError) as exc:
        return "failed", _message(exc)
    except Exception as exc:  # per-row isolation: the savepoint rolled back, report it
        logger.exception("bulk %s/%s failed on %s", entity, action.name, instance.pk)
        return "failed", f"Error inesperado: {_message(exc)}"[:300]


def run_bulk(
    queryset,
    ids,
    action: BulkAction,
    payload: dict,
    actor,
    *,
    entity: str,
    dry_run: bool = False,
    chunk: int = CHUNK,
    context: str = "",
) -> dict:
    """Apply ``action`` to ``ids`` (deduped, order kept) and return the response contract."""
    ids = list(dict.fromkeys(int(i) for i in ids))
    payload = dict(payload or {})
    note = str(payload.get("note") or "").strip()
    result = {
        "action": action.name,
        "requested": len(ids),
        "ok": 0,
        "failed": [],
        "skipped": [],
        "dry_run": bool(dry_run),
    }
    done: list = []

    for chunk_ids in chunked(ids, chunk):
        with transaction.atomic():
            rows = queryset.filter(pk__in=chunk_ids)
            if not dry_run:
                rows = rows.select_for_update(of=("self",))
            by_pk = {row.pk: row for row in rows}
            for pk in chunk_ids:
                instance = by_pk.get(pk)
                if instance is None:
                    result["failed"].append({"id": pk, "error": "No encontrado."})
                    continue
                outcome, message = _process_row(
                    instance,
                    action,
                    payload,
                    actor,
                    entity=entity,
                    dry_run=dry_run,
                    note=note,
                    context=context,
                )
                if outcome == "ok":
                    result["ok"] += 1
                    done.append(instance)
                elif outcome == "skipped":
                    result["skipped"].append({"id": pk, "reason": message})
                else:
                    result["failed"].append({"id": pk, "error": message})

    if not dry_run and done and action.side_effects == "batched" and action.after is not None:
        try:
            action.after(done, payload, actor)
        except Exception:  # side effects never undo the committed rows
            logger.exception("bulk %s/%s batched side effects failed", entity, action.name)

    if not dry_run:
        record(
            "update",
            object_type=f"bulk:{entity}",
            object_id=action.name[:64],
            changes={
                "requested": result["requested"],
                "ok": result["ok"],
                "failed": len(result["failed"]),
                "skipped": len(result["skipped"]),
                "payload": _safe_payload(payload),
            },
            actor=actor,
            context=context or f"bulk:{entity}",
        )
    return result


class AdminBulkView(APIView):
    """Subclass per entity::

        class AdminBookingBulkView(AdminBulkView):
            entity = 'bookings.booking'
            list_view_class = AdminBookingListView        # for all_matching
            actions = {a.name: a for a in (confirm, cancel, ...)}

    ``get_queryset`` defaults to the entity's default manager; override to add
    ``select_related`` for the handlers.
    """

    permission_classes = [IsAdmin]
    throttle_classes = [SharedScopedRateThrottle]
    throttle_scope = "admin-bulk"
    entity: str = ""
    actions: dict[str, BulkAction] = {}
    list_view_class = None
    max_ids = MAX_IDS
    max_matching = MAX_MATCHING
    chunk = CHUNK

    def get_queryset(self):
        return apps.get_model(self.entity)._default_manager.all()

    def get_actor(self):
        return self.request.user

    def get_action(self, name: str) -> BulkAction:
        action = self.actions.get(name)
        if action is None:
            raise ValidationError({"action": ["Acción no válida."]})
        return action

    def matching_ids(self, request, filters: dict) -> list[int]:
        if self.list_view_class is None:
            raise ValidationError({"all_matching": ["No disponible para esta lista."]})
        qs = self.list_view_class.queryset_for_filters(request, filters)
        if qs.count() > self.max_matching:
            raise PayloadTooLarge(self.max_matching)
        return list(qs.values_list("pk", flat=True)[: self.max_matching])

    def post(self, request):
        ser = BulkRequestSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        data = ser.validated_data
        action = self.get_action(data["action"])
        payload = dict(data["payload"] or {})
        if action.requires_note and not str(payload.get("note") or "").strip():
            raise ValidationError({"note": ["Indique el motivo."]})
        if data["all_matching"]:
            ids = self.matching_ids(request, data["filters"] or {})
        else:
            ids = data["ids"]
            if len(ids) > self.max_ids:
                raise PayloadTooLarge(self.max_ids)
        result = run_bulk(
            self.get_queryset(),
            ids,
            action,
            payload,
            self.get_actor(),
            entity=self.entity,
            dry_run=data["dry_run"],
            chunk=self.chunk,
        )
        return Response(result)
