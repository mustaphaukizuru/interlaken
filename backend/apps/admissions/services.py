"""
admissions/services.py — side effects shared by the single-row endpoints and
the bulk actions (Data Ops Phase 4), so both paths send the same emails, write
the same audit rows and obey the same transition tables.

* ``change_status``: the one way a pre-registro or an inscripción changes
  status from the console (``assert_transition`` + save + ``record``).
* ``invite_preregistration``: create/reuse the DRAFT registration, mint a
  single-use invite, email it, advance pending → contacted.
* ``email_registration_outcome``: the approved / rejected email.
* ``request_missing_documents``: email the family the missing-documents
  template with a fresh upload link.
* ``email_rejected_documents``: one email per registration listing the
  documents that need correcting.
"""

from __future__ import annotations

from django.conf import settings

from apps.core.audit import record
from apps.core.transitions import assert_transition
from apps.portal.services import send_email

from .models import PreRegistration, Registration, RegistrationDocument, current_school_cycle
from .tokens import issue_invite

PREREG_ENTITY = "admissions.preregistration"
REG_ENTITY = "admissions.registration"

# Retention (legal.retention) overwrites parent_email with this placeholder;
# dedupe and search must never treat two purged rows as the same family.
RETENTION_PLACEHOLDER = "[eliminado por retención]"


class ConvertOnly(Exception):
    """Raised when a caller tries to set ``complete`` outside the convert path."""


def change_status(
    instance, target: str, *, entity: str, actor, note: str = "", context: str = "", audit=True
):
    """Guarded status change + audit; returns ``[before, after]``.

    Raises ``TransitionError`` (a 400) when the table forbids the move or a
    reverse transition comes without a note. ``complete`` on an inscripción is
    reserved for the convert path (it creates the student and the logins).
    """
    current = instance.status
    if entity == REG_ENTITY and target == Registration.Status.COMPLETE:
        from rest_framework.exceptions import ValidationError

        raise ValidationError(
            {"status": ["La inscripción se completa con «Convertir en alumno» en el pipeline."]}
        )
    assert_transition(entity, current, target, note=note or "")
    instance.status = target
    instance.save(update_fields=["status", "updated_at"])
    changes = {"status": [current, target]}
    if note:
        changes["note"] = note[:500]
    if audit:  # bulk passes False: its per-row record() carries the same diff
        record("update", instance, changes, actor=actor, context=context or f"{entity}:status")
    return [current, target]


# ── pre-registros ─────────────────────────────────────────
def invite_url_for(reg: Registration, raw_token: str) -> str:
    return f"{settings.FRONTEND_URL}/inscripcion?rid={reg.id}&token={raw_token}"


def invite_preregistration(
    pre: PreRegistration, actor=None, *, context: str = "", audit=True
) -> dict:
    """Create or refresh the DRAFT registration for ``pre`` and email the invite.

    Idempotent: re-inviting refreshes the token on the existing draft. Moving
    the pre-registro out of *pending* is the forward transition pending →
    contacted, so it never needs a note.
    """
    reg = pre.registrations.filter(status=Registration.Status.DRAFT).first()
    if reg is None:
        reg = Registration(pre_registration=pre)
    # (Re)seed the draft so the applicant lands on a pre-filled form.
    reg.child_first_name = pre.child_first_name
    reg.child_last_name = pre.child_last_name
    reg.child_dob = pre.child_dob
    reg.level = pre.level
    reg.grade_applying = pre.grade_applying
    reg.cycle = pre.cycle or current_school_cycle()
    reg.parent1_name = pre.parent_name
    reg.parent1_email = pre.parent_email
    reg.parent1_phone = pre.parent_phone
    reg.save()

    raw = issue_invite(reg)
    url = invite_url_for(reg, raw)

    changes = {"invite": reg.id}
    if pre.status == PreRegistration.Status.PENDING:
        pre.status = PreRegistration.Status.CONTACTED
        pre.save(update_fields=["status", "updated_at"])
        changes["status"] = [PreRegistration.Status.PENDING, PreRegistration.Status.CONTACTED]

    email_invite(reg, url)
    if audit:
        record("update", pre, changes, actor=actor, context=context or "admissions: invitación")
    return {"registration": reg, "raw": raw, "url": url, "changes": changes}


def email_invite(reg: Registration, invite_url: str):
    send_email(
        "Invitación de inscripción — Colegio Interlaken",
        (
            f"Estimado/a {reg.parent1_name},\n\n"
            f"Le invitamos a completar la inscripción de {reg.child_first_name} "
            f"{reg.child_last_name} para el ciclo {reg.cycle}.\n\n"
            f"Ingrese al siguiente enlace para continuar:\n{invite_url}\n\n"
            f"El enlace es personal y expira en 14 días.\n\n"
            f"Colegio Interlaken"
        ),
        [reg.parent1_email],
    )


# ── inscripciones ─────────────────────────────────────────
def email_registration_outcome(reg: Registration):
    """Approved / rejected email to parent 1 (fail-soft via ``send_email``)."""
    approved = reg.status == Registration.Status.APPROVED
    subject = (
        "Inscripción aprobada" if approved else "Actualización de su inscripción"
    ) + " — Colegio Interlaken"
    body = (
        f"Estimado/a {reg.parent1_name},\n\n"
        + (
            f"Nos complace informarle que la inscripción de {reg.child_first_name} "
            f"{reg.child_last_name} ha sido APROBADA. En breve le compartiremos los "
            f"siguientes pasos.\n\n"
            if approved
            else f"Hemos revisado la solicitud de inscripción de {reg.child_first_name} "
            f"{reg.child_last_name}. Un asesor de admisiones se pondrá en contacto con "
            f"usted para darle más información.\n\n"
        )
        + "Colegio Interlaken"
    )
    send_email(subject, body, [reg.parent1_email])


OUTCOME_STATES = (Registration.Status.APPROVED, Registration.Status.REJECTED)


def request_missing_documents(
    reg: Registration, actor=None, *, context: str = "", audit=True
) -> dict:
    """Email the missing-documents template with a fresh single-use upload link.

    Returns ``{'missing': [...], 'text': ..., 'sent_to': ...}``; ``missing`` is
    empty (and nothing is sent) when every required document is on file.
    """
    from .pipeline import checklist, documents_upload_url, render_missing_docs

    if not checklist(reg)["missing"]:
        return {"missing": [], "text": "", "sent_to": ""}
    text, missing = render_missing_docs(
        reg, upload_url=documents_upload_url(reg, issue_invite(reg))
    )
    send_email(
        "Documentos pendientes para la inscripción",
        text,
        [reg.parent1_email],
        reply_to=settings.ADMISSIONS_EMAIL,
    )
    if not audit:
        return {"missing": missing, "text": text, "sent_to": reg.parent1_email}
    record(
        "update",
        reg,
        {"requested_docs": missing},
        actor=actor,
        context=context or "admissions: solicitud de documentos",
    )
    return {"missing": missing, "text": text, "sent_to": reg.parent1_email}


def email_rejected_documents(reg: Registration, docs: list[RegistrationDocument]):
    """One email per registration listing every rejected document with its note."""
    if not docs:
        return
    lines = "".join(
        f"- {d.get_doc_type_display()}" + (f": {d.review_note}" if d.review_note else "") + "\n"
        for d in docs
    )
    subject = "Documento por corregir - Colegio Interlaken"
    if len(docs) > 1:
        subject = "Documentos por corregir - Colegio Interlaken"
    send_email(
        subject,
        f"Estimado/a {reg.parent1_name},\n\n"
        f"Los siguientes documentos de {reg.child_first_name} necesitan corrección:\n"
        f"{lines}\n"
        "Solicite un nuevo enlace de documentos a admisiones si el suyo caducó.\n\n"
        "Colegio Interlaken",
        [reg.parent1_email],
        reply_to=settings.ADMISSIONS_EMAIL,
    )


def set_document_review(doc: RegistrationDocument, status: str, note: str = ""):
    """Apply a review decision; ``is_verified`` mirrors *approved*."""
    doc.status = status
    doc.is_verified = status == RegistrationDocument.Review.APPROVED
    doc.review_note = (note or "")[:300] if status == RegistrationDocument.Review.REJECTED else ""
    doc.save(update_fields=["status", "is_verified", "review_note"])
