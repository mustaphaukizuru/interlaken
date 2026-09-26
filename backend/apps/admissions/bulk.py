"""
admissions/bulk.py — bulk actions of the Admisiones console (Data Ops C5).

    POST /api/v1/admissions/admin/pre-registrations/bulk/
        set_status  payload {status, note?}   guarded by the pre-registro table
        invite      —                        pending/contacted only; emails each family
    POST /api/v1/admissions/admin/registrations/bulk/
        approve | reject | reviewing   payload {note?, notify?}  (email on approve/reject)
        request_docs                   emails the missing-documents template
    POST /api/v1/admissions/admin/documents/bulk/
        approve | reject               payload {note (reject), notify?}; the review
                                       modal uses it for "Aprobar/Rechazar seleccionados"

Status actions share ``services.change_status`` with the single-row PATCH
endpoints, so bulk and single can never diverge. The dry-run plan checks the
transition table without the note (the confirm dialog asks for the note after
showing the plan); the commit enforces the note for reverse transitions.
"""

from __future__ import annotations

from collections import defaultdict

from rest_framework.exceptions import ValidationError

from apps.core.bulk import AdminBulkView, BulkAction, BulkSkip
from apps.core.transitions import assert_transition

from .models import PreRegistration, Registration, RegistrationDocument
from .services import (
    OUTCOME_STATES,
    PREREG_ENTITY,
    REG_ENTITY,
    change_status,
    email_registration_outcome,
    email_rejected_documents,
    invite_preregistration,
    request_missing_documents,
    set_document_review,
)
from .views import PreRegistrationAdminListView, RegistrationAdminListView


def _note(payload) -> str:
    return str((payload or {}).get("note") or "").strip()


def _notify(payload) -> bool:
    value = (payload or {}).get("notify", True)
    if isinstance(value, str):
        return value.strip().lower() not in ("0", "false", "no", "")
    return bool(value)


# ── pre-registros ─────────────────────────────────────────
def _prereg_target(payload) -> str:
    target = str((payload or {}).get("status") or "")
    if target not in PreRegistration.Status.values:
        raise ValidationError({"status": ["Estado no válido."]})
    return target


def _prereg_status_plan(instance, payload):
    assert_transition(PREREG_ENTITY, instance.status, _prereg_target(payload), note=None)


def _prereg_status_handler(instance, payload, actor):
    # audit=False: run_bulk writes the per-row record() with this diff + the note.
    before, after = change_status(
        instance,
        _prereg_target(payload),
        entity=PREREG_ENTITY,
        actor=actor,
        note=_note(payload),
        context="bulk:admissions.preregistration:set_status",
        audit=False,
    )
    return {"status": [before, after]}


def _invite_handler(instance, payload, actor):
    out = invite_preregistration(instance, actor, audit=False)
    return out["changes"]


PREREG_ACTIONS = {
    a.name: a
    for a in (
        BulkAction(
            name="set_status",
            label_es="Cambiar estado",
            handler=_prereg_status_handler,
            plan=_prereg_status_plan,
        ),
        BulkAction(
            name="invite",
            label_es="Invitar a inscripción",
            handler=_invite_handler,
            allowed_from=frozenset(
                {PreRegistration.Status.PENDING, PreRegistration.Status.CONTACTED}
            ),
        ),
    )
}


class PreRegistrationBulkView(AdminBulkView):
    entity = PREREG_ENTITY
    list_view_class = PreRegistrationAdminListView
    actions = PREREG_ACTIONS

    def post(self, request):
        # Validate the target once, before any row is touched.
        if request.data.get("action") == "set_status":
            _prereg_target(request.data.get("payload") or {})
        return super().post(request)


# ── inscripciones ─────────────────────────────────────────
def registration_status_action(name: str, label_es: str, target: str) -> BulkAction:
    def plan(instance, payload):
        assert_transition(REG_ENTITY, instance.status, target, note=None)

    def handler(instance, payload, actor):
        before, after = change_status(
            instance,
            target,
            entity=REG_ENTITY,
            actor=actor,
            note=_note(payload),
            audit=False,
        )
        notified = False
        if target in OUTCOME_STATES and _notify(payload):
            email_registration_outcome(instance)
            notified = True
        return {"status": [before, after], "notified": notified}

    return BulkAction(name=name, label_es=label_es, handler=handler, plan=plan)


def _request_docs_plan(instance, payload):
    from .pipeline import checklist

    if not checklist(instance)["missing"]:
        raise BulkSkip("no falta ningún documento")


def _request_docs_handler(instance, payload, actor):
    out = request_missing_documents(instance, actor, audit=False)
    if not out["missing"]:
        raise BulkSkip("no falta ningún documento")
    return {"requested_docs": out["missing"]}


REGISTRATION_ACTIONS = {
    a.name: a
    for a in (
        registration_status_action("approve", "Aprobar", Registration.Status.APPROVED),
        registration_status_action("reject", "Rechazar", Registration.Status.REJECTED),
        registration_status_action("reviewing", "Pasar a revisión", Registration.Status.REVIEWING),
        BulkAction(
            name="request_docs",
            label_es="Solicitar documentos",
            handler=_request_docs_handler,
            plan=_request_docs_plan,
            allowed_from=frozenset(
                {
                    Registration.Status.SUBMITTED,
                    Registration.Status.REVIEWING,
                    Registration.Status.APPROVED,
                }
            ),
        ),
    )
}


class RegistrationBulkView(AdminBulkView):
    entity = REG_ENTITY
    list_view_class = RegistrationAdminListView
    actions = REGISTRATION_ACTIONS

    def get_queryset(self):
        return Registration.objects.all().prefetch_related("documents")


# ── documentos (review modal) ─────────────────────────────
def _doc_action(name: str, label_es: str, target: str, *, requires_note=False) -> BulkAction:
    def plan(instance, payload):
        if instance.status == target:
            raise BulkSkip(f"ya estaba {'aprobado' if target == 'approved' else 'rechazado'}")

    def handler(instance, payload, actor):
        plan(instance, payload)
        before = instance.status
        set_document_review(instance, target, _note(payload))
        return {"status": [before, target]}

    def after(docs, payload, actor):
        if not _notify(payload):
            return
        by_reg = defaultdict(list)
        for doc in docs:
            by_reg[doc.registration_id].append(doc)
        for group in by_reg.values():
            email_rejected_documents(group[0].registration, group)

    return BulkAction(
        name=name,
        label_es=label_es,
        handler=handler,
        plan=plan,
        requires_note=requires_note,
        side_effects="batched" if target == RegistrationDocument.Review.REJECTED else "none",
        after=after if target == RegistrationDocument.Review.REJECTED else None,
    )


DOCUMENT_ACTIONS = {
    a.name: a
    for a in (
        _doc_action("approve", "Aprobar", RegistrationDocument.Review.APPROVED),
        _doc_action("reject", "Rechazar", RegistrationDocument.Review.REJECTED, requires_note=True),
    )
}


class DocumentBulkView(AdminBulkView):
    entity = "admissions.registrationdocument"
    actions = DOCUMENT_ACTIONS

    def get_queryset(self):
        return RegistrationDocument.objects.select_related("registration")
