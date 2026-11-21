"""
admissions/required_docs.py — the per-level document checklist (Fase 4).

One list for the whole site: ``RequiredDocument`` rows (seeded from the 2027
flyers in migration 0013, edited in Admin → Admisiones → Documentos). This
module turns that list into the checklist of one registration:

* ``registration_level(reg)``: preescolar / primaria / secundaria from the
  grade (Maternal → preescolar), else from ``reg.level``; '' when unknown
  (then only the documents every level asks for are listed).
* ``build_checklist(reg)``: one row per document of the level with its status,
  files, review notes and the office's manual state, plus the counts, the
  ``missing`` labels the reminder lists and the ``complete`` flag.
* ``documents_complete(reg)``: the flag alone. The admission-process branch
  imports this (and ``build_checklist``).

Status of a document, first match wins:

1. «No aplica» (manual)            → ``no_aplica``
2. «Entregado en físico» (manual)  → ``entregado_fisico``
3. the ficha (``kind=ficha``): ``aprobado`` once the ficha was sent, else ``falta``
4. its files: none → ``falta``; every file approved → ``aprobado``; any file
   still to review → ``en_revision``; otherwise (a rejected file and nothing
   to review) → ``rechazado`` with the review notes as reasons.

With one file this is exactly «Aprobado > En revisión > Rechazado > Falta».
With several files (INE of both parents), one rejected file keeps the
document «Rechazado» until it is replaced, so an approved half never hides it.

A file belongs to a document by ``RegistrationDocument.required_document``;
files uploaded before Fase 4 (or by the old wizard and the tests) without it
are matched by their legacy ``doc_type`` (``LEGACY_DOC_TYPES``).
"""

from __future__ import annotations

import re

from django.urls import reverse

from .document_models import (
    LEVEL_CHOICES,
    LEVEL_CODES,
    RegistrationDocumentState,
    RequiredDocument,
)
from .ficha_schema import level_for_grade
from .models import Registration, RegistrationDocument
from .validators import fold_text

# RegistrationDocument.doc_type (legacy) → RequiredDocument.key (as migration 0013).
LEGACY_DOC_TYPES = {
    RegistrationDocument.DocType.BIRTH_CERT: "acta-nacimiento",
    RegistrationDocument.DocType.CURP_DOC: "curp-alumno",
    RegistrationDocument.DocType.PHOTO: "fotografia",
    RegistrationDocument.DocType.REPORT_CARD: "boleta-sep",
    RegistrationDocument.DocType.PROOF_ADDR: "comprobante-domicilio",
    RegistrationDocument.DocType.VACCINATION: "cartilla-vacunacion",
}
KEY_TO_LEGACY = {key: str(doc_type) for doc_type, key in LEGACY_DOC_TYPES.items()}

# A file upload cap per document (several files allowed): a session holder
# must not be able to fill the disk one file at a time.
MAX_FILES_PER_DOCUMENT = 10

NO_APLICA = "no_aplica"
ENTREGADO_FISICO = "entregado_fisico"
APROBADO = "aprobado"
EN_REVISION = "en_revision"
RECHAZADO = "rechazado"
FALTA = "falta"

STATUS_LABELS = {
    NO_APLICA: "No aplica",
    ENTREGADO_FISICO: "Entregado en físico",
    APROBADO: "Aprobado",
    EN_REVISION: "En revisión",
    RECHAZADO: "Rechazado",
    FALTA: "Falta",
}
# Count as delivered for the progress and ``complete``.
SATISFIED = frozenset({NO_APLICA, ENTREGADO_FISICO, APROBADO})
# What the reminder asks for.
OUTSTANDING = frozenset({FALTA, RECHAZADO})

LEVEL_LABELS = dict(LEVEL_CHOICES)


# ── level ────────────────────────────────────────────────────────────────
def registration_level(reg) -> str:
    """The level code of ``reg`` ('' when neither the grade nor the level says)."""
    from_grade = level_for_grade(getattr(reg, "grade_applying", "") or "")
    if from_grade:
        return from_grade
    text = fold_text(getattr(reg, "level", "") or "")
    if "maternal" in text:
        return "preescolar"
    for code in LEVEL_CODES:
        if code in text:
            return code
    return ""


def level_label(code: str) -> str:
    return LEVEL_LABELS.get(code, "")


# ── the list ─────────────────────────────────────────────────────────────
def active_catalog() -> list[RequiredDocument]:
    """Every active document, in order (one query; pass it to the helpers below
    when building many checklists)."""
    return list(RequiredDocument.objects.filter(active=True).order_by("order", "id"))


def documents_for_level(
    level: str, docs: list[RequiredDocument] | None = None
) -> list[RequiredDocument]:
    docs = active_catalog() if docs is None else docs
    return [d for d in docs if d.active and d.applies_to(level)]


def required_documents(level: str) -> list[str]:
    """Names of the documents a level asks for, in order: the Expediente and the
    «Cuotas por nivel» PDF read them through ``process.required_documents``."""
    return [d.name for d in documents_for_level(level)]


def normalize_levels(values) -> list[str]:
    """Known level codes from ``values``, deduplicated, in school order."""
    wanted = {str(v).strip().lower() for v in (values or ())}
    return [code for code in LEVEL_CODES if code in wanted]


# ── files and status ─────────────────────────────────────────────────────
def file_state(doc: RegistrationDocument) -> str:
    """approved / pending / rejected. ``is_verified`` alone (rows from before the
    per-document review) still counts as approved."""
    if doc.status == RegistrationDocument.Review.REJECTED:
        return "rejected"
    if doc.status == RegistrationDocument.Review.APPROVED or doc.is_verified:
        return "approved"
    return "pending"


def file_key(doc: RegistrationDocument, by_id: dict[int, RequiredDocument]) -> str | None:
    """The key of the document ``doc`` was uploaded for (None: «otro»)."""
    if doc.required_document_id:
        rd = by_id.get(doc.required_document_id)
        return rd.key if rd is not None else None
    return LEGACY_DOC_TYPES.get(doc.doc_type)


def ficha_submitted(reg) -> bool:
    return bool(reg.submitted_at) or reg.status != Registration.Status.DRAFT


def _status(rd: RequiredDocument, files: list, manual, reg) -> tuple[str, list[str]]:
    if manual is not None and manual.state == RegistrationDocumentState.State.NO_APLICA:
        return NO_APLICA, []
    if manual is not None and manual.state == RegistrationDocumentState.State.ENTREGADO_FISICO:
        return ENTREGADO_FISICO, []
    if rd.kind == RequiredDocument.Kind.FICHA:
        return (APROBADO if ficha_submitted(reg) else FALTA), []
    if not files:
        return FALTA, []
    states = [file_state(f) for f in files]
    reasons = [f.review_note for f in files if file_state(f) == "rejected" and f.review_note]
    if all(s == "approved" for s in states):
        return APROBADO, []
    if "pending" in states:
        return EN_REVISION, reasons
    return RECHAZADO, reasons


def file_payload(doc: RegistrationDocument, key: str | None) -> dict:
    return {
        "id": doc.id,
        "required_key": key,
        "doc_type": doc.doc_type,
        "filename": doc.filename,
        "file_size": doc.file_size,
        "uploaded_at": doc.uploaded_at,
        "status": file_state(doc),
        "review_note": doc.review_note,
        "download_url": reverse("document-download", args=[doc.id]),
    }


def document_label(doc: RegistrationDocument) -> str:
    """The name a family knows a file by (its required document, else the legacy label)."""
    if doc.required_document_id:
        return doc.required_document.name
    key = LEGACY_DOC_TYPES.get(doc.doc_type)
    rd = RequiredDocument.objects.filter(key=key).first() if key else None
    return rd.name if rd is not None else doc.get_doc_type_display()


def _person(user) -> str:
    if user is None:
        return ""
    return f"{user.first_name} {user.last_name}".strip() or user.email


def build_checklist(reg, *, docs: list[RequiredDocument] | None = None, staff: bool = True) -> dict:
    """The checklist of ``reg`` for its level.

    ``docs``: the active list (``active_catalog()``), to share one query across
    many registrations. Reads ``reg.documents.all()`` and
    ``reg.document_states.all()``, so prefetch both for lists. ``staff=False``
    (the family's page) leaves out the office's notes and who set them.
    """
    catalog = active_catalog() if docs is None else docs
    by_id = {d.id: d for d in catalog}
    level = registration_level(reg)
    wanted = documents_for_level(level, catalog)
    wanted_keys = {d.key for d in wanted}

    files_by_key: dict[str, list] = {}
    other_files = []
    for f in sorted(reg.documents.all(), key=lambda d: (d.uploaded_at, d.pk), reverse=True):
        key = file_key(f, by_id)
        if key in wanted_keys:
            files_by_key.setdefault(key, []).append(f)
        else:
            other_files.append(file_payload(f, key))
    states = {s.required_document_id: s for s in reg.document_states.all()}

    items = []
    for rd in wanted:
        files = files_by_key.get(rd.key, [])
        manual = states.get(rd.id)
        status, reasons = _status(rd, files, manual, reg)
        manual_payload = None
        if manual is not None:
            manual_payload = {"state": manual.state, "state_label": manual.get_state_display()}
            if staff:
                manual_payload.update(
                    note=manual.note,
                    updated_at=manual.updated_at,
                    updated_by=_person(manual.updated_by) if manual.updated_by_id else "",
                )
        items.append(
            {
                "id": rd.id,
                "key": rd.key,
                "name": rd.name,
                "description": rd.description,
                "physical_note": rd.physical_note,
                "kind": rd.kind,
                "multiple_files": rd.multiple_files,
                "link_url": rd.link_url,
                "link_label": rd.link_label,
                "status": status,
                "status_label": STATUS_LABELS[status],
                "satisfied": status in SATISFIED,
                "reasons": reasons,
                "files": [file_payload(f, rd.key) for f in files],
                "manual": manual_payload,
                "can_upload": rd.kind == RequiredDocument.Kind.UPLOAD and status not in SATISFIED,
            }
        )

    counted = [i for i in items if i["status"] != NO_APLICA]
    counts = {
        "total": len(counted),
        "done": sum(1 for i in counted if i["satisfied"]),
        "approved": sum(1 for i in items if i["status"] == APROBADO),
        "physical": sum(1 for i in items if i["status"] == ENTREGADO_FISICO),
        "not_applicable": len(items) - len(counted),
        "in_review": sum(1 for i in items if i["status"] == EN_REVISION),
        "rejected": sum(1 for i in items if i["status"] == RECHAZADO),
        "missing": sum(1 for i in items if i["status"] == FALTA),
    }
    return {
        "registration": reg.id,
        "child_name": f"{reg.child_first_name} {reg.child_last_name}".strip(),
        "level": level,
        "level_label": level_label(level),
        "ficha_submitted": ficha_submitted(reg),
        "items": items,
        "other_files": other_files if staff else [],
        "counts": counts,
        "complete": all(i["satisfied"] for i in items),
        "missing": missing_labels(items),
    }


def missing_labels(items: list[dict]) -> list[str]:
    """What the reminder lists: missing documents, then the ones to correct
    with the office's reason (the same order as the checklist)."""
    out = []
    for i in items:
        if i["status"] == FALTA:
            out.append(
                f"{i['name']} (se llena en línea)"
                if i["kind"] == RequiredDocument.Kind.FICHA
                else i["name"]
            )
        elif i["status"] == RECHAZADO:
            reason = "; ".join(r for r in i["reasons"] if r)
            out.append(
                f"{i['name']} (por corregir: {reason})" if reason else f"{i['name']} (por corregir)"
            )
    return out


def documents_complete(reg, *, docs: list[RequiredDocument] | None = None) -> bool:
    """True when every document of the registration's level is approved,
    delivered on paper or marked «No aplica» (the ficha: sent)."""
    return build_checklist(reg, docs=docs)["complete"]


def prefetch_checklist(queryset):
    """The prefetches ``build_checklist`` reads, for a queryset of registrations."""
    return queryset.prefetch_related("documents", "document_states")


# ── WhatsApp ─────────────────────────────────────────────────────────────
def whatsapp_phone(reg) -> str:
    """The family's mobile for wa.me (digits, Mexican 10-digit numbers get 52); '' if none."""
    for raw in (getattr(reg, "contact_phone", ""), reg.parent1_phone):
        digits = re.sub(r"\D", "", raw or "")
        if len(digits) == 10:
            return f"52{digits}"
        if digits:
            return digits
    return ""


# ── uploads ──────────────────────────────────────────────────────────────
class UploadRefused(Exception):
    """An upload the checklist does not accept (message in Spanish, for the family)."""


def upload_target(reg, *, key: str = "", doc_type: str = "", is_staff: bool = False):
    """``(required_document | None, doc_type)`` for an upload by key or legacy doc_type.

    By key (Fase 4): an active ``upload`` document of the registration's level
    (staff may upload any active one); the stored ``doc_type`` is its legacy
    code or ``other``. By legacy ``doc_type`` (the old wizard): the matching
    document when it is active, no level check.
    """
    if key:
        rd = RequiredDocument.objects.filter(key=key, active=True).first()
        if rd is None:
            raise UploadRefused("Tipo de documento no válido.")
        if rd.kind == RequiredDocument.Kind.FICHA:
            raise UploadRefused(
                "La ficha de inscripción se llena en línea; no se sube como archivo."
            )
        if not is_staff and not rd.applies_to(registration_level(reg)):
            raise UploadRefused("Este documento no se pide para el nivel del alumno.")
        return rd, KEY_TO_LEGACY.get(rd.key, RegistrationDocument.DocType.OTHER)
    if doc_type not in RegistrationDocument.DocType.values:
        raise UploadRefused("Tipo de documento no válido.")
    legacy_key = LEGACY_DOC_TYPES.get(doc_type)
    rd = (
        RequiredDocument.objects.filter(key=legacy_key, active=True).first() if legacy_key else None
    )
    return rd, doc_type


def files_of(reg, rd: RequiredDocument) -> list[RegistrationDocument]:
    """The files of ``reg`` that belong to ``rd`` (linked, or by legacy doc_type)."""
    legacy = KEY_TO_LEGACY.get(rd.key)
    out = []
    for f in reg.documents.all():
        if f.required_document_id == rd.id or (
            f.required_document_id is None and legacy and f.doc_type == legacy
        ):
            out.append(f)
    return out
