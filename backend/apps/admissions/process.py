"""
admissions/process.py — the admission process, «Expediente» (Fase 5, backend).

The lead (``PreRegistration``) walks the school's five stages (Proceso.xlsx):

1. **Informes**: costs PDF and visit link sent, «Continúa a visita guiada» or
   «No le interesa».
2. **Visita guiada**: «Asistió y agenda examen», «Asistió, no le interesa» or
   «No asistió» (reschedule, or close).
3. **Examen**: date and time, when the results are given, Aceptado or
   No aceptado (with reason). The ficha de inscripción is private: its link
   goes out only once the result is «Aceptado» (``ficha_link_gate``), with
   the result message itself («Enviar resultado y ficha»).
4. **Documentación y acuerdos**: documents (the Fase 4 checklist of
   ``required_docs``, see ``documents_state``) and the becas/descuentos agreed (``AdmissionDiscount``).
5. **Inscrito**: the inscripción payment recorded (``EnrollmentPayment``) and
   «Marcar como inscrito», which runs the convert service.

Closed outcomes («No le interesa», «No asistió», «No aceptado») carry a reason
and can be reopened. RECORD ONLY: the platform never charges colegiaturas or
inscripción.

The legacy ``status`` stays in sync both ways (``STAGE_STATUS``): the Expediente
writes both, and a legacy status write moves the stage (``sync_stage_with_status``,
called from ``PreRegistration.save``). Stage moves obey
``apps.core.transitions`` (entity ``admissions.stage``); every change is audited.
"""

from __future__ import annotations

import importlib
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal

from django.core import signing
from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from apps.core.audit import record
from apps.core.transitions import assert_transition

from . import cycles
from .models import AdmissionDiscount, EnrollmentPayment, PreRegistration, Registration

Stage = PreRegistration.Stage
Closed = PreRegistration.ClosedOutcome
Status = PreRegistration.Status

STAGE_ENTITY = "admissions.stage"
PREREG_ENTITY = "admissions.preregistration"
CASE_CONTEXT = "admissions: expediente"

# The legacy status each stage shows in the old screens and exports.
STAGE_STATUS = {
    Stage.INFORMES: Status.PENDING,
    Stage.VISITA: Status.CONTACTED,
    Stage.EXAMEN: Status.CONTACTED,
    Stage.DOCUMENTACION: Status.CONTACTED,
    Stage.INSCRITO: Status.ENROLLED,
    Stage.CERRADO: Status.REJECTED,
}
# A legacy status write lands on this stage (and the 0014 data migration).
STATUS_STAGE = {
    Status.PENDING: Stage.INFORMES,
    Status.CONTACTED: Stage.VISITA,
    Status.ENROLLED: Stage.INSCRITO,
    Status.REJECTED: Stage.CERRADO,
}
STAGE_ORDER = [Stage.INFORMES, Stage.VISITA, Stage.EXAMEN, Stage.DOCUMENTACION, Stage.INSCRITO]
OPEN_STAGES = (Stage.INFORMES, Stage.VISITA, Stage.EXAMEN, Stage.DOCUMENTACION)
# What a person may choose when closing a case (no_procedio is legacy only).
CLOSE_OUTCOMES = (Closed.NO_INTERESA, Closed.NO_ASISTIO, Closed.NO_ACEPTADO)

MSG_CLOSED = "El expediente está cerrado. Reábralo para modificarlo."
MSG_ENROLLED = "El expediente ya está inscrito."
MSG_REASON = "Indique el motivo."


# ── legacy status ↔ stage ─────────────────────────────────────────────────
def sync_stage_with_status(lead) -> list[str]:
    """Bring ``stage`` in line with ``status`` when a legacy write changed the
    status alone. Returns the fields it touched (``save`` adds them to
    ``update_fields``). The Expediente sets both, so this is a no-op for it."""
    touched: list[str] = []
    now = timezone.now()
    if lead.stage_changed_at is None:
        lead.stage_changed_at = now
        touched.append("stage_changed_at")
    stage = lead.stage or Stage.INFORMES
    if STAGE_STATUS.get(stage) == lead.status:
        return touched
    target = STATUS_STAGE.get(lead.status)
    if target is None:
        return touched
    if target == Stage.CERRADO:
        lead.closed_outcome = lead.closed_outcome or Closed.NO_PROCEDIO
        lead.closed_from_stage = (
            stage if stage != Stage.CERRADO else (lead.closed_from_stage or Stage.INFORMES)
        )
        lead.closed_at = lead.closed_at or now
        touched += ["closed_outcome", "closed_from_stage", "closed_at"]
    elif stage == Stage.CERRADO:
        _clear_closed(lead)
        touched += ["closed_outcome", "closed_reason", "closed_from_stage", "closed_at"]
    if target == Stage.INSCRITO and lead.enrolled_at is None:
        lead.enrolled_at = now
        touched.append("enrolled_at")
    lead.stage = target
    lead.stage_changed_at = now
    touched += ["stage", "stage_changed_at"]
    return list(dict.fromkeys(touched))


def _clear_closed(lead):
    lead.closed_outcome = ""
    lead.closed_reason = ""
    lead.closed_from_stage = ""
    lead.closed_at = None


def stage_label(stage: str) -> str:
    return Stage(stage).label if stage in Stage.values else stage


def is_admin_role(user) -> bool:
    """The overrides (ficha link before «Aceptado», documents waiver) are for
    ``role=admin`` (or a superuser), never for a staff account with the area."""
    return bool(
        user and (getattr(user, "role", None) == "admin" or getattr(user, "is_superuser", False))
    )


# ── stage moves ───────────────────────────────────────────────────────────
def set_stage(
    lead, target: str, *, note: str | None = "", closed_outcome: str = "", reason: str = ""
) -> dict:
    """Guarded stage move, in memory: returns the audit diff (``{}`` when the
    lead is already there). The caller saves and records.

    ``note=''`` enforces the note on a reverse move; ``None`` skips the check.
    Closing needs one of ``CLOSE_OUTCOMES`` and a reason; leaving «cerrado»
    clears the closing fields (the audit keeps them).
    """
    current = lead.stage
    if current == target:
        return {}
    assert_transition(STAGE_ENTITY, current, target, note=note)
    now = timezone.now()
    diff: dict = {"stage": [current, target]}
    if target == Stage.CERRADO:
        if closed_outcome not in CLOSE_OUTCOMES:
            raise ValidationError({"outcome": ["Elija el motivo de cierre."]})
        reason = " ".join(str(reason or "").split())
        if not reason:
            raise ValidationError({"reason": ["Indique el motivo del cierre."]})
        lead.closed_outcome = closed_outcome
        lead.closed_reason = reason[:500]
        lead.closed_from_stage = current
        lead.closed_at = now
        diff["closed_outcome"] = ["", closed_outcome]
        diff["closed_reason"] = reason[:500]
    elif current == Stage.CERRADO:
        diff["closed_outcome"] = [lead.closed_outcome, ""]
        _clear_closed(lead)
    if target == Stage.INSCRITO:
        lead.enrolled_at = now
    before = lead.status
    lead.stage = target
    lead.status = STAGE_STATUS[target]
    lead.stage_changed_at = now
    if before != lead.status:
        diff["status"] = [before, lead.status]
    if note:
        diff["note"] = str(note)[:500]
    return diff


def advance_to(lead, target: str) -> dict:
    """Forward-only move (outcomes push a case ahead, never back)."""
    if lead.stage not in OPEN_STAGES:
        return {}
    if STAGE_ORDER.index(target) <= STAGE_ORDER.index(lead.stage):
        return {}
    return set_stage(lead, target, note=None)


def save_and_record(lead, changes: dict, actor, context: str = CASE_CONTEXT):
    lead.save()
    if changes:
        record("update", lead, changes, actor=actor, context=context)


def ensure_open(lead):
    if lead.stage == Stage.CERRADO:
        raise CaseConflict(MSG_CLOSED, code="closed")
    if lead.stage == Stage.INSCRITO:
        raise CaseConflict(MSG_ENROLLED, code="enrolled")


class CaseConflict(Exception):
    """A 409: the case is in a state that does not allow the request."""

    def __init__(self, message: str, *, code: str = "conflict", **extra):
        super().__init__(message)
        self.message = message
        self.code = code
        self.extra = extra


def move_case(lead, target: str, *, actor, note: str = "") -> dict:
    """``POST …/move/``: explicit move to an open stage (a reverse one needs a note)."""
    if target not in OPEN_STAGES:
        raise ValidationError(
            {
                "stage": [
                    "Para cerrar use «Cerrar expediente»; para inscribir, «Marcar como inscrito»."
                ]
            }
        )
    ensure_open(lead)
    diff = set_stage(lead, target, note=note or "")
    if not diff:
        raise ValidationError({"stage": [f"El expediente ya está en «{stage_label(target)}»."]})
    save_and_record(lead, diff, actor, context=f"{CASE_CONTEXT}: cambio de etapa")
    return diff


def close_case(lead, outcome: str, reason: str, *, actor, context: str = "") -> dict:
    ensure_open(lead)
    diff = set_stage(lead, Stage.CERRADO, closed_outcome=outcome, reason=reason)
    save_and_record(lead, diff, actor, context=context or f"{CASE_CONTEXT}: cierre")
    return diff


def reopen_case(lead, *, actor, note: str, stage: str = "") -> dict:
    """Back to the stage it was closed in (or ``stage``); always needs a note."""
    if lead.stage != Stage.CERRADO:
        raise CaseConflict("El expediente no está cerrado.", code="not_closed")
    target = stage or lead.closed_from_stage or Stage.INFORMES
    if target not in OPEN_STAGES:
        target = Stage.INFORMES
    diff = set_stage(lead, target, note=note or "")
    save_and_record(lead, diff, actor, context=f"{CASE_CONTEXT}: reapertura")
    return diff


# ── stage cards (PATCH …/<stage>/) ────────────────────────────────────────
def _assign(lead, data: dict, fields, diff: dict):
    for name in fields:
        if name not in data:
            continue
        old, new = getattr(lead, name), data[name]
        if old != new:
            setattr(lead, name, new)
            diff[name] = [_jsonable(old), _jsonable(new)]


def _jsonable(value):
    if isinstance(value, Decimal):
        return str(value)
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return value


INFORMES_FIELDS = (
    "child_first_name",
    "child_last_name",
    "parent_name",
    "parent_email",
    "parent_phone",
    "relationship",
    "previous_school",
    "child_age",
    "grade_applying",
    "level",
    "cycle",
    "referral_source",
    "notes",
    "costs_sent_at",
    "visit_link_sent_at",
)


def update_informes(lead, data: dict, *, actor) -> dict:
    """Contact data are editable at any stage; the outcome only on an open case."""
    diff: dict = {}
    outcome = data.get("outcome")
    if outcome is not None and lead.stage not in OPEN_STAGES:
        ensure_open(lead)
    _assign(lead, data, INFORMES_FIELDS, diff)
    if outcome is not None and outcome != lead.informes_outcome:
        diff["informes_outcome"] = [lead.informes_outcome, outcome]
        lead.informes_outcome = outcome
    if outcome == PreRegistration.InformesOutcome.CONTINUA_VISITA:
        diff.update(advance_to(lead, Stage.VISITA))
    elif outcome == PreRegistration.InformesOutcome.NO_INTERESA:
        diff.update(
            set_stage(
                lead,
                Stage.CERRADO,
                closed_outcome=Closed.NO_INTERESA,
                reason=data.get("reason", ""),
            )
        )
    save_and_record(lead, diff, actor, context=f"{CASE_CONTEXT}: informes")
    return diff


def update_visita(lead, data: dict, *, actor) -> dict:
    from apps.bookings.models import Booking

    ensure_open(lead)
    diff: dict = {}
    booking = None
    if "booking" in data:
        booking = data["booking"]
        diff.update(_link_booking(lead, booking, actor))
    if "note" in data and data["note"] != lead.visit_note:
        diff["visit_note"] = [lead.visit_note, data["note"]]
        lead.visit_note = data["note"]
    outcome = data.get("outcome")
    V = PreRegistration.VisitOutcome
    if outcome is not None and outcome != lead.visit_outcome:
        diff["visit_outcome"] = [lead.visit_outcome, outcome]
        lead.visit_outcome = outcome
        lead.visit_outcome_at = timezone.now() if outcome else None
    if outcome:
        booking = booking or latest_booking(lead)
        if booking is not None:
            target = Booking.Status.NO_SHOW if outcome == V.NO_ASISTIO else Booking.Status.ATTENDED
            _sync_booking_status(booking, target, outcome, actor)
    if outcome == V.AGENDA_EXAMEN:
        diff.update(advance_to(lead, Stage.EXAMEN))
    elif outcome == V.NO_INTERESA:
        diff.update(
            set_stage(
                lead,
                Stage.CERRADO,
                closed_outcome=Closed.NO_INTERESA,
                reason=data.get("reason", ""),
            )
        )
    elif outcome == V.NO_ASISTIO:
        if data.get("reschedule"):
            diff.update(advance_to(lead, Stage.VISITA))
            diff["reschedule"] = True
        else:
            diff.update(
                set_stage(
                    lead,
                    Stage.CERRADO,
                    closed_outcome=Closed.NO_ASISTIO,
                    reason=data.get("reason", ""),
                )
            )
    save_and_record(lead, diff, actor, context=f"{CASE_CONTEXT}: visita guiada")
    return diff


def _link_booking(lead, booking, actor) -> dict:
    if booking is None:
        return {}
    if booking.pre_registration_id == lead.pk:
        return {}
    before = booking.pre_registration_id
    booking.pre_registration = lead
    booking.save(update_fields=["pre_registration", "updated_at"])
    record(
        "update",
        booking,
        {"pre_registration": [before, lead.pk]},
        actor=actor,
        context=f"{CASE_CONTEXT}: visita vinculada",
    )
    return {"booking": booking.pk}


def _sync_booking_status(booking, target, outcome, actor):
    """Mark the linked visit attended / no-show through the booking table (no email)."""
    from apps.bookings.models import Booking
    from apps.bookings.services.status import CapacityError, change_booking_status

    # Only an open visit moves; attended ↔ no-show corrections stay in Visitas.
    if booking.status not in (Booking.Status.PENDING, Booking.Status.CONFIRMED):
        return
    before = booking.status
    try:
        change_booking_status(booking, target, note=None, notify=False)
    except (CapacityError, ValidationError):
        return
    changes = {"status": [before, booking.status]}
    mapped = {
        PreRegistration.VisitOutcome.AGENDA_EXAMEN: Booking.Outcome.ENROLLING,
        PreRegistration.VisitOutcome.NO_INTERESA: Booking.Outcome.DECLINED,
    }.get(outcome)
    if mapped and not booking.outcome:
        booking.outcome = mapped
        booking.save(update_fields=["outcome", "updated_at"])
        changes["outcome"] = mapped
    record("update", booking, changes, actor=actor, context=f"{CASE_CONTEXT}: resultado de visita")


def update_examen(lead, data: dict, *, actor) -> dict:
    ensure_open(lead)
    diff: dict = {}
    exam_at = data.get("exam_at", lead.exam_at)
    results_at = data.get("exam_results_at", lead.exam_results_at)
    result = data.get("result")
    if result and exam_at is None:
        raise ValidationError({"result": ["Agende primero la fecha del examen."]})
    if exam_at and results_at and results_at < exam_at:
        raise ValidationError(
            {"exam_results_at": ["La entrega de resultados debe ser después del examen."]}
        )
    _assign(lead, data, ("exam_at", "exam_notes", "exam_results_at"), diff)
    if result is not None and result != lead.exam_result:
        diff["exam_result"] = [lead.exam_result, result]
        lead.exam_result = result
    if result is not None:
        reason = " ".join(str(data.get("reason") or "").split())[:500]
        if result != PreRegistration.ExamResult.NO_ACEPTADO:
            reason = ""
        if reason != lead.exam_result_reason:
            diff["exam_result_reason"] = reason
            lead.exam_result_reason = reason
    if lead.exam_at is not None:
        diff.update(advance_to(lead, Stage.EXAMEN))  # «Examen agendado»
    if result == PreRegistration.ExamResult.ACEPTADO:
        diff.update(advance_to(lead, Stage.DOCUMENTACION))
    elif result == PreRegistration.ExamResult.NO_ACEPTADO:
        diff.update(
            set_stage(
                lead,
                Stage.CERRADO,
                closed_outcome=Closed.NO_ACEPTADO,
                reason=data.get("reason", ""),
            )
        )
    save_and_record(lead, diff, actor, context=f"{CASE_CONTEXT}: examen")
    return diff


def update_documentacion(lead, data: dict, *, actor) -> dict:
    ensure_open(lead)
    diff: dict = {}
    if "documents_waived" in data and data["documents_waived"] != lead.documents_waived:
        if not is_admin_role(actor):
            raise CaseConflict(
                "Solo un administrador puede dispensar documentos.", code="admin_only"
            )
        diff.update(_waive(lead, data["documents_waived"], data.get("documents_waived_reason", "")))
    _assign(lead, data, ("agreements_note",), diff)
    save_and_record(lead, diff, actor, context=f"{CASE_CONTEXT}: documentación y acuerdos")
    return diff


def _waive(lead, waived: bool, reason: str) -> dict:
    reason = " ".join(str(reason or "").split())[:500]
    if waived and not reason:
        raise ValidationError(
            {"documents_waived_reason": ["Indique por qué se dispensan los documentos."]}
        )
    lead.documents_waived = waived
    lead.documents_waived_reason = reason if waived else ""
    lead.documents_waived_at = timezone.now() if waived else None
    return {
        "documents_waived": [not waived, waived],
        **({"documents_waived_reason": reason} if waived else {}),
    }


# ── documents: the per-level checklist (Fase 4, ``required_docs``) ────────
# Found at DOCUMENT_HOOK_MODULES (``build_checklist(reg)``, ``documents_complete
# (reg)``, ``required_documents(level) -> list[str]``) or registered here with
# ``register_documents_hooks`` (an explicit registration wins). Without any,
# or when the check answers None, the Expediente reports «unknown» and does
# not block «Marcar como inscrito».
DOCUMENT_HOOK_MODULES = ("apps.admissions.required_docs",)
_document_hooks: dict = {}


def register_documents_hooks(*, complete=None, required_for_level=None) -> None:
    if complete is not None:
        _document_hooks["documents_complete"] = complete
    if required_for_level is not None:
        _document_hooks["required_documents"] = required_for_level


_discovered: dict = {}


def _hook(name: str):
    if name in _document_hooks:
        return _document_hooks[name]
    if name not in _discovered:  # looked up once per process (a list asks per row)
        _discovered[name] = None
        for module_name in DOCUMENT_HOOK_MODULES:
            try:
                module = importlib.import_module(module_name)
            except ImportError:
                continue
            fn = getattr(module, name, None)
            if callable(fn):
                _discovered[name] = fn
                break
    return _discovered[name]


def _documents_check(reg) -> dict | None:
    """``{'complete': bool | None, 'missing': [...], 'counts': {...} | None}``;
    ``None`` when no documents module is wired."""
    explicit = _document_hooks.get("documents_complete")
    checklist = None if explicit else _hook("build_checklist")
    complete_fn = explicit or _hook("documents_complete")
    if checklist is None and complete_fn is None:
        return None
    if reg is None:
        return {"complete": False, "missing": [], "counts": None}
    if checklist is not None:
        data = checklist(reg) or {}
        return {
            "complete": data.get("complete"),
            "missing": list(data.get("missing") or []),
            "counts": data.get("counts"),
        }
    result = complete_fn(reg)
    return {"complete": None if result is None else bool(result), "missing": [], "counts": None}


def documents_complete(reg) -> bool | None:
    """True / False from the documents checklist; ``None`` (unknown) without it."""
    check = _documents_check(reg) if reg is not None else None
    return None if check is None else check["complete"]


def required_documents(level: str) -> list[str] | None:
    """Labels of the documents a level asks for; ``None`` without the module."""
    fn = _hook("required_documents")
    if fn is None:
        return None
    out = []
    for item in fn(level) or ():
        if isinstance(item, str):
            out.append(item)
        elif isinstance(item, dict):
            out.append(str(item.get("label") or item.get("name") or ""))
        else:
            out.append(str(getattr(item, "label", item)))
    return [x for x in out if x]


UNKNOWN_DOCUMENTS = "La revisión de documentos por nivel no está disponible: revíselos a mano."


def documents_state(lead, reg) -> dict:
    """``{state: waived | complete | incomplete | unknown, ok, detail, missing, counts}``."""
    if lead.documents_waived:
        return {
            "state": "waived",
            "ok": True,
            "detail": lead.documents_waived_reason,
            "missing": [],
            "counts": None,
        }
    check = _documents_check(reg)
    if check is None or check["complete"] is None:
        return {
            "state": "unknown",
            "ok": True,
            "detail": UNKNOWN_DOCUMENTS,
            "missing": [],
            "counts": None,
        }
    if reg is None:
        return {
            "state": "incomplete",
            "ok": False,
            "detail": "Todavía no hay ficha de inscripción.",
            "missing": [],
            "counts": None,
        }
    if check["complete"]:
        return {
            "state": "complete",
            "ok": True,
            "detail": "",
            "missing": [],
            "counts": check["counts"],
        }
    missing = check["missing"]
    detail = (
        ("Faltan: " + "; ".join(missing) + ".")
        if missing
        else ("Faltan documentos o hay documentos por corregir.")
    )
    return {
        "state": "incomplete",
        "ok": False,
        "detail": detail,
        "missing": missing,
        "counts": check["counts"],
    }


# ── the ficha ─────────────────────────────────────────────────────────────
FICHA_SENT_STATES = (
    Registration.Status.SUBMITTED,
    Registration.Status.REVIEWING,
    Registration.Status.APPROVED,
    Registration.Status.COMPLETE,
)


def case_registration(lead):
    """The case's ficha: the newest one the family sent, else the newest draft."""
    regs = sorted(lead.registrations.all(), key=lambda r: (r.created_at, r.pk), reverse=True)
    sent = [r for r in regs if r.status != Registration.Status.DRAFT]
    return (sent or regs or [None])[0]


def exam_scheduled(lead) -> bool:
    return lead.exam_at is not None


def admitted(lead) -> bool:
    """The exam result is «Aceptado» and the case is in «Documentación y acuerdos»."""
    return (
        lead.exam_result == PreRegistration.ExamResult.ACEPTADO
        and lead.stage == Stage.DOCUMENTACION
    )


MSG_NOT_ADMITTED = (
    "La ficha de inscripción se envía cuando el examen está registrado como Aceptado."
)
MSG_OVERRIDE_REASON = "Escriba por qué envía la ficha antes del resultado «Aceptado»."


def ficha_link_gate(lead) -> dict:
    """The ficha de inscripción is private: its link goes out only to a family
    whose child was admitted (exam «Aceptado», stage «Documentación y
    acuerdos»). Before that an administrator may override it with a written
    reason (audited); a closed or enrolled case never gets one.

    Every path that issues a ficha link checks it: the Expediente actions
    (``send-ficha-link``, ``send-exam-result``), the legacy
    ``pre-register/<pk>/invite/`` and the bulk «invite» action (all through
    ``services.invite_preregistration``)."""
    if lead.stage == Stage.CERRADO:
        return {"allowed": False, "overridable": False, "code": "closed", "reason": MSG_CLOSED}
    if lead.stage == Stage.INSCRITO:
        return {"allowed": False, "overridable": False, "code": "enrolled", "reason": MSG_ENROLLED}
    if admitted(lead):
        return {"allowed": True, "overridable": False, "code": "", "reason": ""}
    return {
        "allowed": False,
        "overridable": True,
        "code": "not_admitted",
        "reason": MSG_NOT_ADMITTED,
    }


def clean_reason(value) -> str:
    return " ".join(str(value or "").split())[:500]


def check_ficha_link(lead, *, actor=None, override=False, override_reason="") -> str:
    """Raise ``CaseConflict`` (or a ``ValidationError`` for a missing reason)
    unless a ficha link may go out for ``lead`` now.

    Returns the cleaned override reason when an administrator overrode the
    gate (the caller audits it), else ``''``."""
    gate = ficha_link_gate(lead)
    if gate["allowed"]:
        return ""
    if not (gate["overridable"] and override):
        raise CaseConflict(gate["reason"], code=gate["code"], overridable=gate["overridable"])
    if not is_admin_role(actor):
        raise CaseConflict(
            "Solo un administrador puede enviar la ficha antes del resultado «Aceptado».",
            code="admin_only",
        )
    reason = clean_reason(override_reason)
    if not reason:
        raise ValidationError({"override_reason": [MSG_OVERRIDE_REASON]})
    return reason


# ── «Marcar como inscrito» ────────────────────────────────────────────────
def active_payments(lead):
    return [p for p in lead.enrollment_payments.all() if p.voided_at is None]


def active_discounts(lead):
    return [d for d in lead.discounts.all() if d.voided_at is None]


def enroll_gates(lead, reg=None) -> dict:
    reg = reg if reg is not None else case_registration(lead)
    docs = documents_state(lead, reg)
    paid = active_payments(lead)
    items = [
        {
            "key": "stage",
            "label": "Expediente en «Documentación y acuerdos»",
            "ok": lead.stage == Stage.DOCUMENTACION,
            "detail": (
                "" if lead.stage == Stage.DOCUMENTACION else f"Está en «{stage_label(lead.stage)}»."
            ),
        },
        {
            "key": "ficha",
            "label": "Ficha de inscripción enviada por la familia",
            "ok": bool(reg and reg.status in FICHA_SENT_STATES),
            "detail": (
                ""
                if reg and reg.status in FICHA_SENT_STATES
                else (
                    f"La ficha está «{reg.get_status_display()}»." if reg else "Aún no hay ficha."
                )
            ),
        },
        {
            "key": "documents",
            "label": "Documentos completos o dispensados",
            "ok": docs["ok"],
            "state": docs["state"],
            "detail": docs["detail"],
            "missing": docs["missing"],
            "counts": docs["counts"],
            "overridable": not docs["ok"],
        },
        {
            "key": "payment",
            "label": "Pago de inscripción registrado",
            "ok": bool(paid),
            "detail": "" if paid else "Registre el pago de inscripción que recibió el colegio.",
        },
    ]
    return {"ready": all(i["ok"] for i in items), "items": items}


class GatesNotMet(Exception):
    def __init__(self, gates: dict):
        super().__init__("gates")
        self.gates = gates


@dataclass
class EnrollResult:
    lead: PreRegistration
    convert: object = None
    already: bool = False
    changes: dict = field(default_factory=dict)


def enroll_case(
    pk, actor, *, student_id="", grade="", group="", override_documents=False, override_reason=""
) -> EnrollResult:
    """Gates → convert (student + family logins, registration complete) → lead «inscrito».

    One transaction: a failed convert leaves the case as it was. Raises
    ``GatesNotMet``, ``CaseConflict``, ``ValidationError`` or the convert's
    ``ConvertError``."""
    from .convert import convert_registration

    with transaction.atomic():
        lead = PreRegistration.objects.select_for_update().get(pk=pk)
        if lead.stage == Stage.INSCRITO:
            return EnrollResult(lead=lead, already=True)
        if lead.stage == Stage.CERRADO:
            raise CaseConflict(MSG_CLOSED, code="closed")
        reg = case_registration(lead)
        changes: dict = {}
        gates = enroll_gates(lead, reg)
        docs_gate = next(i for i in gates["items"] if i["key"] == "documents")
        if not docs_gate["ok"] and override_documents:
            if not is_admin_role(actor):
                raise CaseConflict(
                    "Solo un administrador puede dispensar documentos.", code="admin_only"
                )
            changes.update(_waive(lead, True, override_reason))
            gates = enroll_gates(lead, reg)
        if not gates["ready"]:
            raise GatesNotMet(gates)
        result = convert_registration(
            reg.pk,
            actor,
            student_id=student_id,
            grade=grade,
            group=group,
            allowed_statuses=FICHA_SENT_STATES,
            context=f"{CASE_CONTEXT}: inscrito",
        )
        changes.update(set_stage(lead, Stage.INSCRITO, note=None))
        changes["student"] = result.student.pk
        save_and_record(lead, changes, actor, context=f"{CASE_CONTEXT}: marcar como inscrito")
    return EnrollResult(lead=lead, convert=result, changes=changes)


# ── discounts and payments: readable lines ────────────────────────────────
MONTHS = (
    "enero",
    "febrero",
    "marzo",
    "abril",
    "mayo",
    "junio",
    "julio",
    "agosto",
    "septiembre",
    "octubre",
    "noviembre",
    "diciembre",
)


def add_months(d: date, n: int) -> date:
    y, m = divmod(d.month - 1 + n, 12)
    return date(d.year + y, m + 1, 1)


def cycle_start_year(lead) -> int:
    return cycles.parse_cycle(lead.cycle) or cycles.cycle_start_year()


def discount_period(d: AdmissionDiscount) -> tuple[date | None, date | None]:
    """(first month, last month) of a colegiatura discount; (start, None) when permanent."""
    D = AdmissionDiscount.Duration
    if d.kind == AdmissionDiscount.Kind.INSCRIPCION:
        return None, None
    year = cycle_start_year(d.pre_registration)
    cycle_start = date(year, cycles.CYCLE_START_MONTH, 1)
    start = d.start_month.replace(day=1) if d.start_month else cycle_start
    if d.duration == D.TRES_MESES:
        return start, add_months(start, 2)
    if d.duration == D.SEIS_MESES:
        return start, add_months(start, 5)
    if d.duration == D.CICLO:
        # Colegiaturas: 11 mensualidades, agosto a junio.
        return cycle_start, date(year + 1, 6, 1)
    if d.duration == D.PERMANENTE:
        return start, None
    if d.duration == D.PERSONALIZADO:
        end = d.end_month.replace(day=1) if d.end_month else None
        return (d.start_month.replace(day=1) if d.start_month else None), end
    return None, None


def months_between(start: date | None, end: date | None) -> int | None:
    if not start or not end:
        return None
    return (end.year - start.year) * 12 + end.month - start.month + 1


def _month_year(d: date) -> str:
    return f"{MONTHS[d.month - 1]} {d.year}"


def _range_text(start: date, end: date) -> str:
    if start == end:
        return _month_year(start)
    if start.year == end.year:
        return f"{MONTHS[start.month - 1]} a {_month_year(end)}"
    return f"{_month_year(start)} a {_month_year(end)}"


def percent_text(value: Decimal) -> str:
    text = f"{Decimal(value).normalize():f}"
    return f"{text}%"


def discount_value_text(d: AdmissionDiscount) -> str:
    from apps.portal.emailing import money

    return percent_text(d.percent) if d.percent is not None else money(d.amount)


def discount_summary(d: AdmissionDiscount) -> str:
    """«Beca 20% en colegiatura · agosto 2027 a junio 2028»."""
    K = AdmissionDiscount.Kind
    value = discount_value_text(d)
    head = {
        K.INSCRIPCION: f"Descuento {value} en inscripción",
        K.BECA_COLEGIATURA: f"Beca {value} en colegiatura",
        K.DESCUENTO_COLEGIATURA: f"Descuento {value} en colegiatura",
    }.get(d.kind, value)
    if d.kind == K.INSCRIPCION:
        period = f"ciclo {d.pre_registration.cycle}" if d.pre_registration.cycle else ""
    else:
        start, end = discount_period(d)
        if d.duration == AdmissionDiscount.Duration.PERMANENTE and start:
            period = f"permanente, desde {_month_year(start)}"
        elif start and end:
            period = _range_text(start, end)
        else:
            period = ""
    return f"{head} · {period}" if period else head


def payment_summary(p: EnrollmentPayment) -> str:
    """«$9,500.00 · transferencia · 12 de enero de 2027 · ref. 00123»."""
    from apps.portal.emailing import long_date, money

    parts = [money(p.amount), p.get_method_display().lower(), long_date(p.paid_on)]
    if p.reference:
        parts.append(f"ref. {p.reference}")
    return " · ".join(parts)


# ── list helpers: next action, days waiting ───────────────────────────────
def days_waiting(lead, today: date | None = None) -> int:
    since = lead.stage_changed_at or lead.created_at
    today = today or timezone.localdate()
    return max(0, (today - timezone.localdate(since)).days)


def latest_booking(lead):
    bookings = sorted(lead.bookings.all(), key=lambda b: (b.created_at, b.pk), reverse=True)
    return bookings[0] if bookings else None


def _booking_start(b):
    from datetime import datetime

    return timezone.make_aware(datetime.combine(b.slot.date, b.slot.start_time))


def next_action(lead, now=None) -> dict | None:
    """What the office does next on this case: ``{'code', 'label'}``."""
    from apps.bookings.models import Booking
    from apps.portal.emailing import long_date

    now = now or timezone.now()
    s = lead.stage
    if s == Stage.INFORMES:
        if not lead.costs_sent_at:
            return {"code": "send_costs", "label": "Enviar cuotas"}
        if not lead.visit_link_sent_at:
            return {"code": "send_visit_link", "label": "Enviar liga de visita"}
        return {"code": "informes_outcome", "label": "Registrar si continúa a visita guiada"}
    if s == Stage.VISITA:
        b = latest_booking(lead)
        if b is None or b.status == Booking.Status.CANCELLED:
            if lead.visit_link_sent_at and not lead.visit_outcome:
                return {"code": "await_booking", "label": "Esperando que agende la visita"}
            return {"code": "send_visit_link", "label": "Enviar liga de visita"}
        if (
            b.status in (Booking.Status.PENDING, Booking.Status.CONFIRMED)
            and _booking_start(b) > now
        ):
            return {"code": "visit_scheduled", "label": f"Visita el {long_date(b.slot.date)}"}
        return {"code": "visit_outcome", "label": "Registrar resultado de la visita"}
    if s == Stage.EXAMEN:
        if not lead.exam_at:
            return {"code": "schedule_exam", "label": "Agendar examen"}
        if lead.exam_at > now:
            if not lead.exam_date_sent_at:
                return {"code": "send_exam_date", "label": "Enviar fecha del examen"}
            return {"code": "exam_scheduled", "label": f"Examen el {long_date(lead.exam_at)}"}
        return {"code": "exam_result", "label": "Registrar resultado del examen"}
    if s == Stage.DOCUMENTACION:
        reg = case_registration(lead)
        if reg is None or (reg.status == Registration.Status.DRAFT and not lead.ficha_link_sent_at):
            # One message: the «Aceptado» result carries the ficha link.
            if admitted(lead) and not lead.exam_result_sent_at:
                return {"code": "send_exam_result", "label": "Enviar resultado y ficha"}
            return {"code": "send_ficha_link", "label": "Enviar ficha de inscripción"}
        if reg.status == Registration.Status.DRAFT:
            return {"code": "await_ficha", "label": "Esperando la ficha de la familia"}
        if not documents_state(lead, reg)["ok"]:
            return {"code": "review_documents", "label": "Revisar documentos"}
        if not active_payments(lead):
            return {"code": "record_payment", "label": "Registrar pago de inscripción"}
        return {"code": "enroll", "label": "Marcar como inscrito"}
    return None


# ── bookings ↔ cases ──────────────────────────────────────────────────────
LEAD_TOKEN_SALT = "admissions.case.visit-link"
LEAD_TOKEN_MAX_AGE = 60 * 60 * 24 * 60  # 60 days: a family books within weeks


def lead_token(lead) -> str:
    """Signed, expiring token for the visit-booking link (no personal data in it)."""
    return signing.dumps({"l": lead.pk}, salt=LEAD_TOKEN_SALT, compress=True)


def lead_from_token(token: str):
    """The lead a visit link was sent to, or ``None`` (bad, forged or expired)."""
    if not token:
        return None
    try:
        data = signing.loads(str(token), salt=LEAD_TOKEN_SALT, max_age=LEAD_TOKEN_MAX_AGE)
    except (signing.BadSignature, signing.SignatureExpired, ValueError, TypeError):
        return None
    pk = data.get("l") if isinstance(data, dict) else None
    return PreRegistration.objects.filter(pk=pk).first() if isinstance(pk, int) else None


def lead_for_booking(booking, *, attach: bool = True, lock: bool = False):
    """The booking's case: its FK first, else the latest lead with the parent's
    email (attached to the booking, so the next lookup is the FK)."""
    from .services import RETENTION_PLACEHOLDER

    qs = PreRegistration.objects.select_for_update() if lock else PreRegistration.objects.all()
    if booking.pre_registration_id:
        return qs.filter(pk=booking.pre_registration_id).first()
    email = (booking.parent_email or "").strip()
    if not email or email == RETENTION_PLACEHOLDER:
        return None
    lead = qs.filter(parent_email__iexact=email).order_by("-created_at", "-pk").first()
    if lead is not None and attach:
        booking.pre_registration = lead
        booking.save(update_fields=["pre_registration", "updated_at"])
    return lead


def apply_booking_outcome(lead, booking, outcome: str, *, actor) -> dict:
    """The visit result recorded in Visitas moves the case (forward only).

    «Se inscribirá» = «Asistió y agenda examen» (stage Examen); «No le
    interesó» closes the case (no_interesa); «Interesada» / «No por ahora»
    keep it in Visita guiada. A closed or enrolled case is never moved.
    """
    from apps.bookings.models import Booking

    out = {"id": lead.pk, "status": str(lead.status), "stage": str(lead.stage), "changed": False}
    if lead.stage not in OPEN_STAGES:
        out["skipped"] = f"El expediente está «{stage_label(lead.stage)}» y no se movió."
        return out
    V = PreRegistration.VisitOutcome
    diff: dict = {}
    if outcome == Booking.Outcome.ENROLLING:
        visit = V.AGENDA_EXAMEN
        diff.update(advance_to(lead, Stage.EXAMEN))
    elif outcome == Booking.Outcome.DECLINED:
        visit = V.NO_INTERESA
        diff.update(
            set_stage(
                lead,
                Stage.CERRADO,
                closed_outcome=Closed.NO_INTERESA,
                reason=booking.outcome_note or "No le interesó la visita guiada.",
            )
        )
    else:
        visit = ""
        diff.update(advance_to(lead, Stage.VISITA))
    if visit != lead.visit_outcome:
        diff["visit_outcome"] = [lead.visit_outcome, visit]
        lead.visit_outcome = visit
        lead.visit_outcome_at = timezone.now() if visit else None
    if booking.outcome_note and booking.outcome_note != lead.visit_note:
        lead.visit_note = booking.outcome_note
    if diff:
        diff["booking"] = booking.pk
        save_and_record(
            lead, diff, actor, context=f"admissions: estado por resultado de visita #{booking.pk}"
        )
    out.update(status=str(lead.status), stage=str(lead.stage), changed="stage" in diff)
    return out


# ── «Nuevo prospecto»: dedupe (a warning, never a block) ──────────────────
def phone_key(value: str) -> str:
    digits = "".join(ch for ch in str(value or "") if ch.isdigit())
    return digits[-10:] if len(digits) >= 10 else ""


def find_duplicates(*, phone: str = "", email: str = "", exclude_pk=None, limit: int = 10) -> list:
    from .services import RETENTION_PLACEHOLDER

    email = (email or "").strip()
    key = phone_key(phone)
    if not email and not key:
        return []
    ids = set()
    if email and email != RETENTION_PLACEHOLDER:
        ids |= set(
            PreRegistration.objects.filter(parent_email__iexact=email).values_list("pk", flat=True)
        )
    if key:
        ids |= {
            pk
            for pk, ph in PreRegistration.objects.values_list("pk", "parent_phone")
            if phone_key(ph) == key
        }
    ids.discard(exclude_pk)
    return list(PreRegistration.objects.filter(pk__in=ids).order_by("-created_at")[:limit])


def booking_from_visit_link(lead, booking) -> None:
    """A family booked through the signed visit link: attach the visit and,
    from «Informes», move the case to «Visita guiada» (audited as the system)."""
    if booking.pre_registration_id != lead.pk:
        booking.pre_registration = lead
        booking.save(update_fields=["pre_registration", "updated_at"])
    diff = advance_to(lead, Stage.VISITA)
    diff["booking"] = booking.pk
    lead.save()
    record(
        "update",
        lead,
        diff,
        actor_label="system:visit-link",
        context=f"{CASE_CONTEXT}: visita agendada por la familia",
    )
