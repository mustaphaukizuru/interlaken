"""
admissions/required_docs_views.py — the per-level document list (Fase 4).

Staff (Admin → Admisiones, area «admisiones», every write audited):

GET/POST   /admissions/admin/required-documents/            the list (inactive too) / add one
GET/PATCH/DELETE /admissions/admin/required-documents/<pk>/  one document (DELETE only
                                                         while no family uploaded a file)
POST       /admissions/admin/required-documents/reorder/    {ids: [...]} → order 1..n
GET        /admissions/admin/register/<pk>/checklist/       the registration's checklist
PUT/DELETE /admissions/admin/register/<pk>/checklist/<key>/state/
                                                         {state: entregado_fisico | no_aplica, note}
POST       /admissions/admin/register/<pk>/checklist/reminder/
                                                         {channel: email | whatsapp}: the
                                                         missing ones by email, or the
                                                         WhatsApp text with a fresh link

Public / family:

GET  /admissions/required-documents/?level=     the list for the «Documentación» page
GET  /admissions/register/<pk>/documents/list/  the family's checklist (session token)
POST /admissions/register/<pk>/documents/       upload: ``required_key`` (or the legacy
                                                ``doc_type``), one or more ``file``,
                                                optional ``replaces`` (a file id)
POST /admissions/documents/new-link/            {email, registration?}: «Pedir un enlace
                                                nuevo» (always the same 200 answer)
"""

from __future__ import annotations

import os

from django.conf import settings
from django.db import transaction
from django.db.models import Count, Max, Prefetch
from django.shortcuts import get_object_or_404
from django.utils.decorators import method_decorator
from django.utils.text import slugify
from rest_framework import generics, permissions, serializers, status
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.audit import record
from apps.core.exceptions import error_body
from apps.core.permissions import IsAdmin
from apps.core.ratelimit import ratelimit

from .document_models import LEVEL_CHOICES, LEVEL_CODES, RegistrationDocumentState, RequiredDocument
from .models import Registration, RegistrationDocument
from .required_docs import (
    MAX_FILES_PER_DOCUMENT,
    UploadRefused,
    active_catalog,
    build_checklist,
    file_state,
    files_of,
    normalize_levels,
    upload_target,
    whatsapp_phone,
)
from .serializers import RegistrationDocumentSerializer
from .views import _is_staff, authorize_registration

AUDIT_CONTEXT = "admissions: documentos requeridos"
PUBLIC_FIELDS = (
    "key",
    "name",
    "description",
    "physical_note",
    "levels",
    "kind",
    "multiple_files",
    "link_url",
    "link_label",
)
EDITABLE_FIELDS = (
    "name",
    "description",
    "physical_note",
    "levels",
    "multiple_files",
    "link_url",
    "link_label",
    "active",
)


# ── the list (console) ───────────────────────────────────────────────────
class RequiredDocumentSerializer(serializers.ModelSerializer):
    key = serializers.SlugField(max_length=50, required=False, allow_blank=True)
    levels = serializers.ListField(
        child=serializers.ChoiceField(choices=LEVEL_CHOICES),
        allow_empty=True,
    )
    upload_count = serializers.SerializerMethodField()

    class Meta:
        model = RequiredDocument
        fields = [
            "id",
            "key",
            "name",
            "description",
            "physical_note",
            "levels",
            "kind",
            "multiple_files",
            "link_url",
            "link_label",
            "active",
            "order",
            "upload_count",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "kind", "order", "upload_count", "created_at", "updated_at"]

    def get_upload_count(self, obj) -> int:
        annotated = getattr(obj, "upload_count", None)
        return annotated if annotated is not None else obj.uploads.count()

    def validate_name(self, value):
        value = (value or "").strip()
        if not value:
            raise serializers.ValidationError("Escriba el nombre del documento.")
        return value

    def validate_levels(self, value):
        levels = normalize_levels(value)
        if not levels:
            raise serializers.ValidationError("Elija al menos un nivel.")
        return levels

    def validate(self, attrs):
        for name in ("description", "physical_note", "link_label"):
            if name in attrs:
                attrs[name] = (attrs[name] or "").strip()
        if (
            attrs.get("link_url")
            and not attrs.get("link_label")
            and not getattr(self.instance, "link_label", "")
        ):
            attrs["link_label"] = "Ver trámite en línea"
        if self.instance is not None:
            attrs.pop("key", None)  # the key never changes: uploads and states point at it
            return attrs
        if "levels" not in attrs:
            raise serializers.ValidationError({"levels": ["Elija al menos un nivel."]})
        key = (attrs.get("key") or "").strip()
        if key:
            if RequiredDocument.objects.filter(key=key).exists():
                raise serializers.ValidationError(
                    {"key": ["Ya existe un documento con esa clave."]}
                )
        else:
            base = slugify(attrs.get("name", ""))[:44] or "documento"
            key, n = base, 2
            while RequiredDocument.objects.filter(key=key).exists():
                key, n = f"{base}-{n}", n + 1
        attrs["key"] = key
        return attrs


def _snapshot(obj: RequiredDocument) -> dict:
    return {name: getattr(obj, name) for name in EDITABLE_FIELDS}


class RequiredDocumentListCreateView(generics.ListCreateAPIView):
    """The whole list for the console (inactive rows too), in order."""

    admin_area = "admisiones"
    permission_classes = [IsAdmin]
    serializer_class = RequiredDocumentSerializer
    pagination_class = None

    def get_queryset(self):
        return RequiredDocument.objects.annotate(upload_count=Count("uploads")).order_by(
            "order", "id"
        )

    def perform_create(self, serializer):
        top = RequiredDocument.objects.aggregate(top=Max("order"))["top"] or 0
        obj = serializer.save(kind=RequiredDocument.Kind.UPLOAD, order=top + 1)
        record(
            "create",
            obj,
            {"key": obj.key, **_snapshot(obj)},
            actor=self.request.user,
            context=AUDIT_CONTEXT,
        )


class RequiredDocumentDetailView(generics.RetrieveUpdateDestroyAPIView):
    admin_area = "admisiones"
    permission_classes = [IsAdmin]
    serializer_class = RequiredDocumentSerializer
    http_method_names = ["get", "patch", "delete"]

    def get_queryset(self):
        return RequiredDocument.objects.annotate(upload_count=Count("uploads"))

    def perform_update(self, serializer):
        before = _snapshot(serializer.instance)
        obj = serializer.save()
        after = _snapshot(obj)
        changes = {k: [before[k], after[k]] for k in EDITABLE_FIELDS if before[k] != after[k]}
        if changes:
            record(
                "update",
                obj,
                {"key": obj.key, **changes},
                actor=self.request.user,
                context=AUDIT_CONTEXT,
            )

    def destroy(self, request, *args, **kwargs):
        obj = self.get_object()
        if obj.kind == RequiredDocument.Kind.FICHA:
            return Response(
                error_body(
                    "La ficha de inscripción no se puede eliminar. Puede ocultarla.", code="ficha"
                ),
                status=status.HTTP_409_CONFLICT,
            )
        if obj.uploads.exists():
            return Response(
                error_body(
                    "Este documento ya tiene archivos de familias. Ocúltelo en lugar "
                    "de eliminarlo.",
                    code="has_uploads",
                ),
                status=status.HTTP_409_CONFLICT,
            )
        record(
            "delete",
            obj,
            {"key": obj.key, "name": obj.name},
            actor=request.user,
            context=AUDIT_CONTEXT,
        )
        obj.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class RequiredDocumentReorderView(APIView):
    """POST {ids: [...]}: those documents take orders 1..n in that order; any
    left out keep their relative order after them."""

    admin_area = "admisiones"
    permission_classes = [IsAdmin]

    def post(self, request):
        raw = request.data.get("ids")
        try:
            ids = [int(x) for x in raw]
        except (TypeError, ValueError):
            return Response(
                {"ids": ["Envíe la lista de documentos en el nuevo orden."]},
                status=status.HTTP_400_BAD_REQUEST,
            )
        rows = {d.id: d for d in RequiredDocument.objects.all()}
        if len(set(ids)) != len(ids) or any(i not in rows for i in ids):
            return Response(
                {"ids": ["La lista tiene documentos repetidos o que no existen."]},
                status=status.HTTP_400_BAD_REQUEST,
            )
        rest = sorted(
            (d for i, d in rows.items() if i not in set(ids)), key=lambda d: (d.order, d.id)
        )
        ordered = [rows[i] for i in ids] + rest
        changed = []
        with transaction.atomic():
            for position, doc in enumerate(ordered, 1):
                if doc.order != position:
                    doc.order = position
                    doc.save(update_fields=["order", "updated_at"])
                    changed.append(doc.key)
        if changed:
            record(
                "update",
                object_type="admissions.requireddocument",
                object_id="reorder",
                changes={"order": [d.key for d in ordered]},
                actor=request.user,
                context=AUDIT_CONTEXT,
            )
        qs = RequiredDocument.objects.annotate(upload_count=Count("uploads")).order_by(
            "order", "id"
        )
        return Response(RequiredDocumentSerializer(qs, many=True).data)


# ── public list (Documentación) ──────────────────────────────────────────
class PublicRequiredDocumentsView(APIView):
    """GET /admissions/required-documents/?level= — the active list (all levels,
    each row with its ``levels``; ``?level=`` keeps one level's)."""

    permission_classes = [permissions.AllowAny]

    def get(self, request):
        level = str(request.query_params.get("level") or "").strip().lower()
        if level and level not in LEVEL_CODES:
            return Response({"level": ["Nivel no válido."]}, status=status.HTTP_400_BAD_REQUEST)
        docs = active_catalog()
        levels = [
            {"value": code, "label": label, "count": sum(1 for d in docs if d.applies_to(code))}
            for code, label in LEVEL_CHOICES
        ]
        if level:
            docs = [d for d in docs if d.applies_to(level)]
        return Response(
            {
                "level": level,
                "levels": levels,
                "results": [{name: getattr(d, name) for name in PUBLIC_FIELDS} for d in docs],
            }
        )


# ── a registration's checklist (console) ─────────────────────────────────
def _registration(pk) -> Registration:
    states = RegistrationDocumentState.objects.select_related("updated_by")
    qs = Registration.objects.prefetch_related(
        "documents", Prefetch("document_states", queryset=states)
    )
    return get_object_or_404(qs, pk=pk)


def staff_checklist(reg: Registration) -> dict:
    data = build_checklist(reg)
    data.update(
        parent_name=reg.parent1_name,
        parent_email=reg.parent1_email,
        whatsapp_phone=whatsapp_phone(reg),
    )
    return data


class RegistrationChecklistView(APIView):
    admin_area = "admisiones"
    permission_classes = [IsAdmin]

    def get(self, request, pk):
        return Response(staff_checklist(_registration(pk)))


class RegistrationDocumentStateView(APIView):
    """PUT sets «Entregado en físico» / «No aplica» (with an optional note) on
    one document of the registration; DELETE clears it. Both return the
    updated checklist."""

    admin_area = "admisiones"
    permission_classes = [IsAdmin]

    def _target(self, pk, key):
        reg = get_object_or_404(Registration, pk=pk)
        rd = get_object_or_404(RequiredDocument, key=key)
        return (
            reg,
            rd,
            RegistrationDocumentState.objects.filter(
                registration=reg, required_document=rd
            ).first(),
        )

    def put(self, request, pk, key):
        reg, rd, obj = self._target(pk, key)
        state = str(request.data.get("state") or "")
        if state not in RegistrationDocumentState.State.values:
            return Response(
                {"state": ["Elija «Entregado en físico» o «No aplica»."]},
                status=status.HTTP_400_BAD_REQUEST,
            )
        note = str(request.data.get("note") or "").strip()[:300]
        before = obj.state if obj else None
        if obj is None:
            obj = RegistrationDocumentState(registration=reg, required_document=rd)
        obj.state, obj.note, obj.updated_by = state, note, request.user
        obj.save()
        changes = {"registration": reg.pk, "document": rd.key, "state": [before, state]}
        if note:
            changes["note"] = note
        record(
            "update" if before else "create",
            obj,
            changes,
            actor=request.user,
            context=AUDIT_CONTEXT,
        )
        return Response(staff_checklist(_registration(pk)))

    def delete(self, request, pk, key):
        reg, rd, obj = self._target(pk, key)
        if obj is not None:
            record(
                "delete",
                obj,
                {"registration": reg.pk, "document": rd.key, "state": [obj.state, None]},
                actor=request.user,
                context=AUDIT_CONTEXT,
            )
            obj.delete()
        return Response(staff_checklist(_registration(pk)))


class RegistrationDocumentsReminderView(APIView):
    """«Enviar recordatorio de faltantes».

    ``channel=email`` (default): the missing-documents email (Ajustes template,
    ``{missing_list}`` = exactly the missing and to-correct documents of the
    level) with a fresh upload link. ``channel=whatsapp``: no email; a fresh
    link and the same text, ready for wa.me with the family's mobile. Both
    rotate the family's single-use link and are audited.
    """

    admin_area = "admisiones"
    permission_classes = [IsAdmin]

    def post(self, request, pk):
        from .pipeline import documents_upload_url, render_missing_docs
        from .services import FichaPending, ensure_ficha_sent, request_missing_documents
        from .tokens import issue_invite

        reg = _registration(pk)
        try:
            ensure_ficha_sent(reg)
        except FichaPending as exc:
            return Response(error_body(exc.message, code=exc.code), status=status.HTTP_409_CONFLICT)
        channel = str(request.data.get("channel") or "email")
        if channel not in ("email", "whatsapp"):
            return Response(
                {"channel": ["Elija correo o WhatsApp."]}, status=status.HTTP_400_BAD_REQUEST
            )
        if not build_checklist(reg)["missing"]:
            return Response(
                error_body("No falta ningún documento.", code="nothing_missing"),
                status=status.HTTP_400_BAD_REQUEST,
            )
        phone = whatsapp_phone(reg)
        if channel == "email":
            if not reg.parent1_email:
                return Response(
                    error_body("La familia no tiene correo registrado. Use WhatsApp."),
                    status=status.HTTP_400_BAD_REQUEST,
                )
            out = request_missing_documents(
                reg, request.user, context="admissions: recordatorio de documentos"
            )
            return Response(
                {
                    "channel": "email",
                    "sent_to": out["sent_to"],
                    "missing": out["missing"],
                    "text": out["text"],
                    "whatsapp_phone": phone,
                }
            )
        upload_url = documents_upload_url(reg, issue_invite(reg))
        text, missing = render_missing_docs(reg, upload_url=upload_url)
        record(
            "update",
            reg,
            {"requested_docs": missing, "channel": "whatsapp"},
            actor=request.user,
            context="admissions: recordatorio de documentos",
        )
        return Response(
            {
                "channel": "whatsapp",
                "sent_to": "",
                "missing": missing,
                "text": text,
                "whatsapp_text": text,
                "whatsapp_phone": phone,
                "upload_url": upload_url,
            }
        )


# ── the family's page ────────────────────────────────────────────────────
class DocumentListView(APIView):
    """GET /admissions/register/<pk>/documents/list/ — the family's checklist for
    the student's level (session token), or any registration's for staff."""

    permission_classes = [permissions.AllowAny]

    def get(self, request, pk):
        reg = authorize_registration(request, pk)
        reg = Registration.objects.prefetch_related("documents", "document_states").get(pk=reg.pk)
        data = build_checklist(reg, staff=False)
        docs = sorted(reg.documents.all(), key=lambda d: (d.doc_type, -d.uploaded_at.timestamp()))
        return Response(
            {
                "registration": reg.id,
                "child_name": data["child_name"],
                "level": data["level"],
                "level_label": data["level_label"],
                "ficha_submitted": data["ficha_submitted"],
                # Kept for older clients: the documents to upload, by key.
                "required": [
                    {"code": i["key"], "label": i["name"]}
                    for i in data["items"]
                    if i["kind"] == RequiredDocument.Kind.UPLOAD
                ],
                "items": data["items"],
                "counts": data["counts"],
                "complete": data["complete"],
                "limits": {
                    "max_bytes": getattr(settings, "MAX_DOCUMENT_UPLOAD_SIZE", 10 * 1024 * 1024),
                    "extensions": list(settings.ALLOWED_DOCUMENT_EXTENSIONS),
                    "max_files": MAX_FILES_PER_DOCUMENT,
                },
                "documents": RegistrationDocumentSerializer(
                    docs, many=True, context={"request": request}
                ).data,
            }
        )


class _NewLinkIn(serializers.Serializer):
    email = serializers.EmailField(
        max_length=254,
        error_messages={
            "invalid": "Escriba un correo electrónico válido.",
            "blank": "Escriba su correo electrónico.",
            "required": "Escriba su correo electrónico.",
        },
    )
    # The rid of the page the family is on: only that registration is renewed.
    registration = serializers.IntegerField(required=False, allow_null=True, min_value=1)


def _new_link_email_key(group, request) -> str:
    """The per-address bucket of «Pedir un enlace nuevo»: the typed address, lower case."""
    data = request.data if hasattr(request.data, "get") else {}
    email = str(data.get("email") or "").strip().lower()[:254]
    return f"email:{email}"


# Each accepted call may email a link: slow per network and per address.
@method_decorator(ratelimit("documents-new-link-ip", "10/h", key="ip", method="POST"), name="post")
@method_decorator(
    ratelimit("documents-new-link-email", "3/h", key=_new_link_email_key, method="POST"), name="post"
)
class DocumentsNewLinkView(APIView):
    """POST /admissions/documents/new-link/ ``{email, registration?}`` — «Pedir un enlace nuevo».

    From a used or expired documents link. Always the same 200 answer whether
    or not the address matches a registration, or the registration is at the
    documents step (no enumeration); the matching work and the email run in a
    background thread, so the response time does not tell either. A link goes
    out only where the staff reminder would send one (ficha sent, documents
    missing) and only to the address on file (``send_family_documents_links``).
    """

    permission_classes = [permissions.AllowAny]

    def post(self, request):
        from functools import partial

        from apps.portal import services as portal_services

        from .services import (
            FAMILY_LINK_MESSAGE,
            family_link_candidates,
            send_family_documents_links,
        )

        data = _NewLinkIn(data=request.data)
        data.is_valid(raise_exception=True)
        email = data.validated_data["email"]
        ids = family_link_candidates(email, data.validated_data.get("registration"))
        if ids:
            portal_services.run_in_background(
                partial(send_family_documents_links, ids, email), name="admissions-docs-new-link"
            )
        return Response({"detail": FAMILY_LINK_MESSAGE})


def _bad(message: str):
    return Response(error_body(message), status=status.HTTP_400_BAD_REQUEST)


# What the file really is, by its first bytes (QA 2026-11-24: an executable
# renamed «acta.pdf» was accepted on the extension alone).
_OLE2 = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"  # .doc (Word 97-2003)
_HEIF_BRANDS = (b"heic", b"heix", b"hevc", b"heim", b"heis", b"mif1", b"msf1")
_KIND_LABEL = {".pdf": "PDF", ".jpg": "imagen", ".jpeg": "imagen", ".png": "imagen",
               ".doc": "documento de Word", ".docx": "documento de Word"}


def document_content_ok(f, ext: str) -> bool:
    """True when the upload's content matches its extension: ``%PDF`` near the
    start of a PDF (the header may follow a few junk bytes), an image Pillow
    reads (a phone's HEIC named .jpg passes too), a Word file's OLE2 / ZIP
    signature. The file position is left at the start."""
    try:
        f.seek(0)
        head = f.read(1024)
        if ext == ".pdf":
            return b"%PDF" in head
        if ext == ".doc":
            return head.startswith(_OLE2)
        if ext == ".docx":
            return head.startswith(b"PK\x03\x04")
        if ext in (".jpg", ".jpeg", ".png"):
            if head[4:8] == b"ftyp" and head[8:12] in _HEIF_BRANDS:
                return True
            from PIL import Image

            f.seek(0)
            with Image.open(f) as img:
                img.verify()
            return True
        return False
    except Exception:  # noqa: BLE001 - Pillow raises many types for non-images
        return False
    finally:
        f.seek(0)


@method_decorator(
    ratelimit("registration-upload", "20/m", key="ip", method="POST"), name="dispatch"
)
class DocumentUploadView(APIView):
    """POST /admissions/register/<pk>/documents/ — upload one or more files.

    ``required_key``: a document of the student's level (Fase 4). A document
    with one file replaces its previous file; one that allows several adds to
    them (up to ``MAX_FILES_PER_DOCUMENT``) and ``replaces=<file id>`` swaps a
    rejected one. A family cannot change a document already approved,
    delivered on paper or marked «No aplica». The old wizard's ``doc_type``
    still works (its document, replacing the same type; ``other`` adds).
    Extension and size limits: ``ALLOWED_DOCUMENT_EXTENSIONS`` and
    ``MAX_DOCUMENT_UPLOAD_SIZE`` (10 MB) per file.
    """

    parser_classes = [MultiPartParser, FormParser]
    permission_classes = [permissions.AllowAny]

    def post(self, request, pk):
        reg = authorize_registration(request, pk)
        files = request.FILES.getlist("file")
        key = str(request.data.get("required_key") or "").strip()
        doc_type = str(request.data.get("doc_type") or "").strip()
        if not files or not (key or doc_type):
            return _bad("Debe adjuntar un archivo y indicar el tipo de documento.")
        staff = _is_staff(request)
        try:
            rd, stored_type = upload_target(reg, key=key, doc_type=doc_type, is_staff=staff)
        except UploadRefused as exc:
            return _bad(str(exc))

        max_size = getattr(settings, "MAX_DOCUMENT_UPLOAD_SIZE", 10 * 1024 * 1024)
        for f in files:
            ext = os.path.splitext(f.name)[1].lower()
            if ext not in settings.ALLOWED_DOCUMENT_EXTENSIONS:
                return _bad(f"Tipo de archivo {ext or 'sin extensión'} no permitido.")
            # The *_MAX_MEMORY_SIZE settings don't bound uploads: without this an
            # invited session holder could fill the disk (DoS).
            if f.size > max_size:
                return _bad(
                    f"El archivo excede el tamaño máximo de {max_size // (1024 * 1024)} MB."
                )
            if not document_content_ok(f, ext):
                return _bad(
                    f"El archivo «{f.name}» no es un {_KIND_LABEL.get(ext, 'archivo')} válido. "
                    f"Guárdelo o escanéelo de nuevo e intente otra vez."
                )

        reg = Registration.objects.prefetch_related("documents", "document_states").get(pk=reg.pk)
        if rd is not None:
            to_delete, error = self._plan(reg, rd, files, request, staff, by_key=bool(key))
        else:
            # Legacy types with no active document: replace the same type; «other» adds.
            if len(files) > 1 and stored_type != RegistrationDocument.DocType.OTHER:
                return _bad("Este documento admite un solo archivo.")
            to_delete = (
                []
                if stored_type == RegistrationDocument.DocType.OTHER
                else [d for d in reg.documents.all() if d.doc_type == stored_type]
            )
            error = None
        if error:
            return _bad(error)

        with transaction.atomic():
            for old in to_delete:
                if old.file:
                    old.file.delete(save=False)
                old.delete()
            created = [
                RegistrationDocument.objects.create(
                    registration=reg,
                    doc_type=stored_type,
                    required_document=rd,
                    file=f,
                    filename=f.name[:255],
                    file_size=f.size,
                )
                for f in files
            ]
        out = [
            {**RegistrationDocumentSerializer(d).data, "required_key": rd.key if rd else None}
            for d in created
        ]
        if len(out) == 1:
            return Response(out[0], status=status.HTTP_201_CREATED)
        return Response({"documents": out}, status=status.HTTP_201_CREATED)

    def _plan(self, reg, rd, files, request, staff, *, by_key):
        """``(files to delete, error)`` for an upload to ``rd``."""
        existing = files_of(reg, rd)
        if by_key and not staff:
            item = next(
                (i for i in build_checklist(reg, staff=False)["items"] if i["key"] == rd.key), None
            )
            if item is not None and item["satisfied"]:
                return [], (
                    "Este documento ya está aprobado o registrado por la escuela. "
                    "Si necesita cambiarlo, escriba a admisiones."
                )
        if not rd.multiple_files:
            if len(files) > 1:
                return [], "Este documento admite un solo archivo."
            return existing, None
        to_delete = []
        replaces = str(request.data.get("replaces") or "").strip()
        if replaces:
            target = next((f for f in existing if str(f.pk) == replaces), None)
            if target is None:
                return [], "El archivo que quiere reemplazar no es de este documento."
            if file_state(target) == "approved" and not staff:
                return [], "Ese archivo ya fue aprobado."
            to_delete = [target]
        if len(existing) - len(to_delete) + len(files) > MAX_FILES_PER_DOCUMENT:
            return [], f"Este documento admite hasta {MAX_FILES_PER_DOCUMENT} archivos."
        return to_delete, None
