"""
admissions/services.py — side effects shared by the single-row endpoints and
the bulk actions (Data Ops Phase 4), so both paths send the same emails, write
the same audit rows and obey the same transition tables.

* ``change_status``: the one way a pre-registro or an inscripción changes
  status from the console (``assert_transition`` + save + ``record``).
* ``invite_preregistration``: create/reuse the DRAFT ficha, mint a
  single-use invite, email it, advance pending → contacted.
* ``email_registration_outcome``: the approved / rejected email.
* ``request_missing_documents``: email the family the missing-documents
  template with a fresh upload link.
* ``email_rejected_documents``: one email per registration listing the
  documents that need correcting.
"""

from __future__ import annotations

from functools import partial

from django.conf import settings

from apps.core.audit import record
from apps.core.bulk import after_commit
from apps.core.transitions import assert_transition
from apps.portal.services import send_email

from .models import PreRegistration, Registration, RegistrationDocument, current_school_cycle
from .tokens import issue_invite

# Footer line of every admissions email: why the family received it.
ADM_REASON = "Recibe este correo porque inició un proceso de admisión en el Colegio Interlaken."

PREREG_ENTITY = "admissions.preregistration"
REG_ENTITY = "admissions.registration"

# Retention (legal.retention) overwrites parent_email with this placeholder;
# dedupe and search must never treat two purged rows as the same family.
RETENTION_PLACEHOLDER = "[eliminado por retención]"


class ConvertOnly(Exception):
    """Raised when a caller tries to set ``complete`` outside the convert path."""


class AlreadyApplied(Exception):
    """The family already sent this child's inscripción: no new invitation link."""


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
    stage = getattr(instance, "stage", None)
    instance.status = target
    instance.save(update_fields=["status", "updated_at"])
    changes = {"status": [current, target]}
    if stage is not None and instance.stage != stage:  # Expediente: the stage follows
        changes["stage"] = [stage, instance.stage]
    if note:
        changes["note"] = note[:500]
    if audit:  # bulk passes False: its per-row record() carries the same diff
        record("update", instance, changes, actor=actor, context=context or f"{entity}:status")
    return [current, target]


# ── pre-registros ─────────────────────────────────────────
def invite_url_for(reg: Registration, raw_token: str) -> str:
    """The family's link to the ficha (``/pre-registro``; ``/inscripcion`` redirects there)."""
    return f"{settings.FRONTEND_URL}/pre-registro?rid={reg.id}&token={raw_token}"


def sent_registration(pre: PreRegistration):
    """The inscripción the family already sent for ``pre`` (any status but draft), if any."""
    return pre.registrations.exclude(status=Registration.Status.DRAFT).order_by("-created_at").first()


def invite_preregistration(
    pre: PreRegistration,
    actor=None,
    *,
    context: str = "",
    audit=True,
    email=True,
    override=False,
    override_reason="",
) -> dict:
    """Create or refresh the DRAFT registration for ``pre`` and email the invite.

    The ficha de inscripción is private: the link goes out only once the
    exam result is «Aceptado» (``process.check_ficha_link``: a ``CaseConflict``
    otherwise, code ``not_admitted``), unless an administrator overrides it
    with a written reason (``override`` + ``override_reason``, audited).
    Every caller (Expediente, legacy invite endpoint, bulk) comes through here.

    Idempotent: re-inviting refreshes the token on the existing draft. The
    draft is seeded from the pre-registro when it is created; a re-invite only
    fills its blanks, so what the family already corrected stays. A family that
    already sent the inscripción gets no new link (``AlreadyApplied``: omitted
    in bulk, 409 on the single row), so a reminder never opens a second one.
    Moving the pre-registro out of *pending* is the forward transition
    pending → contacted, so it never needs a note. The email goes out once the
    row is committed (``after_commit``), never before its token exists.
    """
    from .process import check_ficha_link

    overridden = check_ficha_link(
        pre, actor=actor, override=override, override_reason=override_reason
    )
    sent = sent_registration(pre)
    if sent is not None:
        raise AlreadyApplied(
            f"ya envió su inscripción («{sent.get_status_display()}»); revísela en Inscripciones"
        )
    reg = pre.registrations.filter(status=Registration.Status.DRAFT).first()
    created = reg is None
    if created:
        reg = Registration(pre_registration=pre)
    seed = {
        "child_first_name": pre.child_first_name,
        "child_last_name": pre.child_last_name,
        "child_dob": pre.child_dob,
        "previous_school": pre.previous_school,
        "level": pre.level,
        "grade_applying": pre.grade_applying,
        "cycle": pre.cycle or current_school_cycle(),
        "parent1_name": pre.parent_name,
        "parent1_email": pre.parent_email,
        "parent1_phone": pre.parent_phone,
        # The ficha's «quién llena la ficha» (parent1 is derived from it).
        "contact_name": pre.parent_name,
        "contact_email": pre.parent_email,
        "contact_phone": pre.parent_phone,
        "contact_relationship": pre.relationship,
    }
    # The ficha's split names (the form shows these, not the legacy pair).
    paternal, _, maternal = (pre.child_last_name or "").strip().partition(" ")
    if not (reg.child_paternal_surname or reg.child_maternal_surname):
        seed.update(child_paternal_surname=paternal[:100], child_maternal_surname=maternal.strip()[:100])
    seed["child_given_names"] = (pre.child_first_name or "")[:100]
    for field, value in seed.items():
        if created or not getattr(reg, field):
            setattr(reg, field, value)
    # Every invitation now opens the ficha (Fase 2): its full rules apply on submit.
    reg.ficha_version = Registration.FichaVersion.FICHA
    reg.save()

    raw = issue_invite(reg)
    url = invite_url_for(reg, raw)
    # The office's current address for the family (a corrected pre-registro
    # email reaches them even when the draft still has the old one).
    to = pre.parent_email or reg.parent1_email

    changes = {"invite": reg.id}
    if overridden:
        changes["override"] = True
        changes["override_reason"] = overridden
    if pre.status == PreRegistration.Status.PENDING:
        stage = pre.stage
        pre.status = PreRegistration.Status.CONTACTED
        pre.save(update_fields=["status", "updated_at"])
        changes["status"] = [PreRegistration.Status.PENDING, PreRegistration.Status.CONTACTED]
        if pre.stage != stage:
            changes["stage"] = [stage, pre.stage]

    if email:  # the Expediente sends it itself to know whether it went out
        after_commit(partial(email_invite, reg, url, to=to))
    if audit:
        record("update", pre, changes, actor=actor, context=context or "admissions: invitación")
    return {
        "registration": reg,
        "raw": raw,
        "url": url,
        "changes": changes,
        "override_reason": overridden,
    }


def _child(reg) -> str:
    return f"{reg.child_first_name} {reg.child_last_name}".strip()


def email_invite(reg: Registration, invite_url: str, *, to: str = ""):
    from datetime import timedelta

    from django.utils import timezone

    from apps.portal.emailing import EmailContent, long_date

    content = EmailContent(
        category="Admisiones",
        title=f"Le invitamos a llenar la ficha de inscripción de {reg.child_first_name}",
        intro=(f"Estimado/a {reg.parent1_name}: le invitamos a llenar la ficha de inscripción de "
               f"{_child(reg)} para el ciclo {reg.cycle} en el Colegio Interlaken. La ficha ya "
               f"trae los datos que nos compartió; le tomará unos 15 minutos y puede guardarla y "
               f"continuar después."),
        details=[("Alumno", _child(reg)), ("Grado", reg.grade_applying), ("Ciclo escolar", reg.cycle),
                 ("El enlace vence", long_date(timezone.now() + timedelta(days=14)))],
        cta_label="Llenar la ficha",
        cta_url=invite_url,
        note=("El enlace es personal: no lo comparta. Si tiene dudas, responda a este correo "
              "y le atenderá el equipo de admisiones."),
        signoff="Equipo de Admisiones",
        reason=ADM_REASON,
    )
    return send_email(f"Invitación de inscripción: {_child(reg)}", "", [to or reg.parent1_email],
                      reply_to=settings.ADMISSIONS_EMAIL, content=content)


# ── inscripciones ─────────────────────────────────────────
def email_registration_outcome(reg: Registration):
    """Approved / rejected email to parent 1 (fail-soft via ``send_email``)."""
    from apps.portal.emailing import EmailContent

    approved = reg.status == Registration.Status.APPROVED
    details = [("Alumno", _child(reg)), ("Grado", reg.grade_applying), ("Ciclo escolar", reg.cycle)]
    if approved:
        subject = f"Inscripción aprobada: {_child(reg)}"
        content = EmailContent(
            category="Admisiones", tone="success",
            title=f"La inscripción de {reg.child_first_name} fue aprobada",
            intro=(f"Estimado/a {reg.parent1_name}: nos da mucho gusto informarle que la inscripción "
                   f"de {_child(reg)} fue aprobada. Bienvenidos a la familia Interlaken."),
            details=details,
            paragraphs=["En breve le compartiremos los siguientes pasos."],
            signoff="Equipo de Admisiones", reason=ADM_REASON,
        )
    else:
        subject = f"Actualización de su inscripción: {_child(reg)}"
        content = EmailContent(
            category="Admisiones", tone="neutral",
            title="Actualización sobre su solicitud de inscripción",
            intro=(f"Estimado/a {reg.parent1_name}: revisamos la solicitud de inscripción de {_child(reg)}. "
                   f"Un asesor de admisiones se pondrá en contacto con usted para darle más información."),
            details=details,
            note="Si tiene preguntas, responda a este correo y le atenderemos.",
            signoff="Equipo de Admisiones", reason=ADM_REASON,
        )
    send_email(subject, "", [reg.parent1_email], reply_to=settings.ADMISSIONS_EMAIL, content=content)


OUTCOME_STATES = (Registration.Status.APPROVED, Registration.Status.REJECTED)

# Documents come after the ficha (the school's process). The ficha and the
# documents page share the family's single-use link, so a documents link sent
# while the ficha is still a draft would cancel the ficha link in their email.
FICHA_PENDING_MSG = (
    "La familia todavía no envía la ficha de inscripción. Los documentos se piden "
    "después: el enlace de la ficha sigue vigente; cuando la envíe, pida los documentos."
)


class FichaPending(Exception):
    """A documents link was asked for while the ficha is still a draft."""

    code = "ficha_pending"

    def __init__(self, message: str = FICHA_PENDING_MSG):
        super().__init__(message)
        self.message = message


def ensure_ficha_sent(reg: Registration) -> None:
    """Raise ``FichaPending`` while the ficha is a draft (see FICHA_PENDING_MSG)."""
    if reg.status == Registration.Status.DRAFT:
        raise FichaPending()


def request_missing_documents(
    reg: Registration, actor=None, *, context: str = "", audit=True
) -> dict:
    """Email the missing-documents template with a fresh single-use upload link.

    Returns ``{'missing': [...], 'text': ..., 'sent_to': ...}``; ``missing`` is
    empty (and nothing is sent) when every required document is on file.
    """
    from .pipeline import checklist, documents_upload_url, render_missing_docs

    ensure_ficha_sent(reg)
    if not checklist(reg)["missing"]:
        return {"missing": [], "text": "", "sent_to": ""}
    from apps.portal.emailing import EmailContent

    upload_url = documents_upload_url(reg, issue_invite(reg))
    text, missing = render_missing_docs(reg, upload_url=upload_url)
    # The wording is the school's (Ajustes → plantilla): the text part is that text
    # verbatim; the HTML part shows the same paragraphs with the link as a button.
    paragraphs = [p.replace(upload_url, "").rstrip() for p in text.split("\n\n") if p.strip()]
    content = EmailContent(
        category="Admisiones", tone="warning",
        title=f"Documentos pendientes para la inscripción de {reg.child_first_name}",
        intro=paragraphs[0] if paragraphs else "",
        paragraphs=[p for p in paragraphs[1:] if p],
        cta_label="Subir documentos",
        cta_url=upload_url,
        note="El enlace es personal y de un solo uso. Si vence, pida uno nuevo respondiendo a este correo.",
        reason=ADM_REASON,
    )
    # After the row commits in a bulk run: the upload link's token must exist first.
    after_commit(partial(
        send_email,
        f"Documentos pendientes para la inscripción de {reg.child_first_name}",
        text,
        [reg.parent1_email],
        reply_to=settings.ADMISSIONS_EMAIL,
        content=content,
        text_from_content=False,
    ))
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
    from apps.portal.emailing import EmailContent

    from .required_docs import document_label

    # The name of the per-level document (Fase 4), not the legacy type label.
    items = [document_label(d) + (f": {d.review_note}" if d.review_note else "") for d in docs]
    plural = len(docs) > 1
    content = EmailContent(
        category="Admisiones", tone="warning",
        title=("Hay documentos por corregir" if plural else "Hay un documento por corregir"),
        intro=(f"Estimado/a {reg.parent1_name}: revisamos los documentos de inscripción de "
               f"{reg.child_first_name} y {'estos necesitan' if plural else 'este necesita'} corrección:"),
        items=items,
        paragraphs=["Vuelva a subirlos con el enlace de documentos que le enviamos. "
                    "Si su enlace ya venció, responda a este correo y le enviamos uno nuevo."],
        signoff="Equipo de Admisiones", reason=ADM_REASON,
    )
    send_email(
        f"{'Documentos' if plural else 'Documento'} por corregir: {_child(reg)}",
        "",
        [reg.parent1_email],
        reply_to=settings.ADMISSIONS_EMAIL,
        content=content,
    )


def set_document_review(doc: RegistrationDocument, status: str, note: str = ""):
    """Apply a review decision; ``is_verified`` mirrors *approved*."""
    doc.status = status
    doc.is_verified = status == RegistrationDocument.Review.APPROVED
    doc.review_note = (note or "")[:300] if status == RegistrationDocument.Review.REJECTED else ""
    doc.save(update_fields=["status", "is_verified", "review_note"])
