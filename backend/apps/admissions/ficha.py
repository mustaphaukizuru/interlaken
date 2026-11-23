"""
admissions/ficha.py — services of the ficha de inscripción (Fase 1, backend).

The ficha is the ``Registration`` record filled in steps (see
``ficha_schema``). This module holds everything the views share:

* one DRF serializer per section, generated from the schema (format rules
  only: a draft saves whatever is valid so far);
* ``section_values`` / ``ficha_payload``: what ``GET …/ficha/`` returns, with
  the health fields masked for callers who may not read them;
* ``save_section``: apply a PATCH, keep the derived legacy fields in sync,
  audit staff edits;
* ``start_ficha``: the public step 0 (lead + draft + tokens);
* ``submit_problems`` / ``sign_and_submit``: the full required rules, the
  privacy acceptance and the typed signature;
* ``resume_drafts``: «continuar mi ficha» by email (no enumeration);
* the emails of those steps.
"""

from __future__ import annotations

import ipaddress
from functools import cache

from django.conf import settings
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework import serializers

from apps.core.audit import record

from . import cycles, validators
from .eligibility import eligibility_error
from .ficha_schema import (
    FIRMA,
    GRADE_LEVEL,
    INICIO,
    PATCH_SECTIONS,
    REGISTRATION_MEDICAL_FIELDS,
    SECTIONS,
    choice_label,
    choice_values,
    completeness,
    condition_met,
    level_for_grade,
    level_label,
    normalize_grade,
    required_errors,
    section_missing,
)
from .guardians import join_name, sync_legacy_parents
from .models import PreRegistration, Registration, RegistrationGuardian
from .serializers import _validate_child_dob, child_full_name
from .services import ADM_REASON, RETENTION_PLACEHOLDER, invite_url_for
from .tokens import issue_invite, issue_session, session_valid

MSG_CHOICE = "Elija una opción de la lista."
MSG_STATE = "Elija un estado de la lista."
MSG_DATE = "Escriba una fecha válida."
MSG_EMAIL = "Escriba un correo electrónico válido."

FICHA = Registration.FichaVersion.FICHA


# ── serializer fields ────────────────────────────────────────────────────
def _saved(field):
    return (field.context.get("saved") or {}).get(field.field_name)


class NormalizedCharField(serializers.CharField):
    """Text cleaned by a ``validators.normalize_*`` function (blank stays blank)."""

    def __init__(self, normalizer, **kwargs):
        self.normalizer = normalizer
        kwargs.setdefault("required", False)
        kwargs.setdefault("allow_blank", True)
        super().__init__(**kwargs)

    def to_internal_value(self, data):
        value = super().to_internal_value(data)
        try:
            return self.normalizer(value)
        except validators.FichaValueError as exc:
            raise serializers.ValidationError(str(exc)) from None


class LenientChoiceField(serializers.CharField):
    """A value from the schema's list. A value already on file is kept as is
    (a draft from the old wizard), so re-saving a step never fails on it."""

    def __init__(self, allowed, *, normalizer=None, **kwargs):
        self.allowed = frozenset(allowed)
        self.normalizer = normalizer
        kwargs.setdefault("required", False)
        kwargs.setdefault("allow_blank", True)
        super().__init__(**kwargs)

    def to_internal_value(self, data):
        value = super().to_internal_value(data)
        if value in self.allowed:
            return value
        if self.normalizer is not None:
            canonical = self.normalizer(value)
            if canonical in self.allowed:
                return canonical
        if value == _saved(self):
            return value
        raise serializers.ValidationError(MSG_CHOICE)


class CycleField(serializers.CharField):
    """The running or the next cycle ('actual' / 'proximo' accepted as aliases).
    Staff may set any well-formed «AAAA-AAAA»; a cycle already on file stays."""

    def __init__(self, **kwargs):
        kwargs.setdefault("required", False)
        kwargs.setdefault("allow_blank", True)
        kwargs.setdefault("max_length", 20)
        super().__init__(**kwargs)

    def to_internal_value(self, data):
        value = super().to_internal_value(data)
        value = cycles.cycle_for_choice(value) or value
        allowed = cycles.allowed_cycles()
        if value in allowed or value == _saved(self):
            return value
        if self.context.get("is_staff") and cycles.parse_cycle(value):
            return value
        raise serializers.ValidationError(
            f"Elija el ciclo en curso ({allowed[0]}) o el próximo ({allowed[1]})."
        )


class FichaDateField(serializers.DateField):
    default_error_messages = {"invalid": MSG_DATE, "datetime": MSG_DATE}

    def __init__(self, **kwargs):
        kwargs.setdefault("required", False)
        kwargs.setdefault("allow_null", True)
        super().__init__(**kwargs)

    def to_internal_value(self, value):
        if value in ("", None):
            return None
        return super().to_internal_value(value)


def _child_dob(value):
    if value is not None:
        _validate_child_dob(value)


def _adult_dob(value):
    if value is None:
        return
    if value > timezone.localdate():
        raise serializers.ValidationError("La fecha de nacimiento no puede ser futura.")
    if value.year < 1900:
        raise serializers.ValidationError("La fecha de nacimiento no es válida.")


_NORMALIZERS = {
    "phone": validators.normalize_phone,
    "extension": validators.normalize_extension,
    "postal_code": validators.normalize_postal_code,
    "curp": validators.normalize_curp,
    "country": validators.normalize_country,
}
_MEASURES = {"cm": validators.normalize_height_cm, "kg": validators.normalize_weight_kg}


def _drf_field(spec):
    kw = {"required": False, "label": spec.label}
    kind = spec.type
    if kind == "boolean":
        return serializers.BooleanField(**kw)
    if kind == "date":
        return FichaDateField(
            validators=[_child_dob if spec.name == "child_dob" else _adult_dob], **kw
        )
    if kind == "email":
        return serializers.EmailField(
            allow_blank=True, max_length=254, error_messages={"invalid": MSG_EMAIL}, **kw
        )
    if kind in _NORMALIZERS:
        return NormalizedCharField(_NORMALIZERS[kind], max_length=spec.max_length or 30, **kw)
    if kind == "number":
        return NormalizedCharField(_MEASURES[spec.unit], max_length=10, **kw)
    if kind == "select":
        return LenientChoiceField(choice_values(spec.choices), max_length=100, **kw)
    if kind == "grade":
        return LenientChoiceField(GRADE_LEVEL, normalizer=normalize_grade, max_length=30, **kw)
    if kind == "cycle":
        return CycleField(**kw)
    # text, textarea, state (the entidad check needs the country: validate())
    return serializers.CharField(allow_blank=True, max_length=spec.max_length or 200, **kw)


# (curp, birth date, sex) per section: the CURP must agree with the other two.
CURP_TRIPLES = {
    "alumno": ("child_curp", "child_dob", "child_sex"),
    "padre": ("curp", "dob", "sex"),
    "madre": ("curp", "dob", "sex"),
}


class FichaSectionSerializer(serializers.Serializer):
    """Format rules of one section; cross-field checks against the saved values.

    ``context``: ``saved`` (the section as stored) and ``is_staff``.
    """

    section_key = ""

    def validate(self, attrs):
        section = SECTIONS[self.section_key]
        saved = self.context.get("saved") or {}
        merged = {**saved, **attrs}
        errors = {}
        for f in section.fields:
            if f.type != "state" or not attrs.get(f.name):
                continue
            if f.choices_if is not None and not condition_met(f.choices_if, merged):
                continue  # born abroad: the state or province is free text
            canonical = validators.normalize_state(attrs[f.name])
            if canonical:
                attrs[f.name] = canonical
            elif attrs[f.name] != saved.get(f.name):
                errors[f.name] = [MSG_STATE]
        triple = CURP_TRIPLES.get(self.section_key)
        if triple and any(name in attrs for name in triple):
            curp, dob, sex = (merged.get(name) for name in triple)
            messages = validators.curp_agreement_errors(curp or "", dob, sex)
            if messages:
                errors[triple[0]] = messages
        if self.section_key == "salud" and attrs.get("has_allergies") == "no":
            attrs["allergies"] = ""
        if errors:
            raise serializers.ValidationError(errors)
        return attrs


@cache
def serializer_class(key: str) -> type[FichaSectionSerializer]:
    section = SECTIONS[key]
    attrs = {f.name: _drf_field(f) for f in section.fields if not f.read_only}
    attrs["section_key"] = key
    meta = type(FichaSectionSerializer)
    return meta(f"Ficha{key.capitalize()}Serializer", (FichaSectionSerializer,), attrs)


# ── reading ──────────────────────────────────────────────────────────────
def guardians_by_role(reg) -> dict[str, RegistrationGuardian]:
    if not reg.pk:
        return {}
    return {g.role: g for g in reg.guardians.all()}


def _empty(spec):
    if spec.type == "boolean":
        return False
    if spec.type == "date":
        return None
    return ""


def section_values(reg, key: str, guardians: dict) -> dict:
    """The section as stored (Python values: dates, booleans, decrypted text)."""
    section = SECTIONS[key]
    if section.target == "guardian":
        g = guardians.get(key)
        return {
            f.name: (getattr(g, f.name) if g is not None else _empty(f)) for f in section.fields
        }
    return {f.name: getattr(reg, f.name) for f in section.fields}


def all_values(reg, guardians: dict | None = None) -> dict[str, dict]:
    guardians = guardians if guardians is not None else guardians_by_role(reg)
    return {key: section_values(reg, key, guardians) for key in PATCH_SECTIONS}


def _json(value):
    return value.isoformat() if hasattr(value, "isoformat") else value


def json_section(values: dict) -> dict:
    return {k: _json(v) for k, v in values.items()}


def is_admin_reader(user) -> bool:
    return bool(
        user is not None
        and getattr(user, "is_authenticated", False)
        and (getattr(user, "is_staff", False) or getattr(user, "role", "") == "admin")
    )


def session_token(request) -> str:
    return request.headers.get("X-Session-Token") or request.data.get("session_token", "") or ""


def can_access_medical(request, reg) -> bool:
    """Same rule as ``RegistrationSerializer``: the family's own session, or an
    admin (role admin / Django staff) once the family gave the MEDICAL_DATA
    consent. Staff accounts with the admisiones area never see health data
    without the family's session.

    The session comes first: when the office fills a ficha with a family at
    the desk (/pre-registro, «Vista del personal»), the request carries both
    the staff login and that ficha's own session, and the health step must
    save before the consent on it is stored."""
    if session_valid(reg, session_token(request)):
        return True
    user = getattr(request, "user", None)
    if is_admin_reader(user):
        return bool(reg.consent_medical_data)
    return False


def _notice_label(reg) -> str:
    ver = reg.privacy_notice_version
    if ver is None:
        return ""
    return getattr(ver, "version", None) or str(ver)


def ficha_payload(reg, *, is_staff: bool, medical_ok: bool, guardians: dict | None = None) -> dict:
    guardians = guardians if guardians is not None else guardians_by_role(reg)
    values = all_values(reg, guardians)
    sections = {key: json_section(v) for key, v in values.items()}
    if not medical_ok:
        for name in REGISTRATION_MEDICAL_FIELDS:
            if name in sections["salud"]:
                sections["salud"][name] = None
    firma = {
        "privacy_accepted_at": reg.privacy_accepted_at,
        "privacy_notice_version": _notice_label(reg),
        "signed_name": reg.signed_name,
        "signed_at": reg.signed_at,
        "consent_photos_media": reg.consent_photos_media,
    }
    if is_staff:
        firma["signed_ip"] = reg.signed_ip
    return {
        "id": reg.id,
        "status": reg.status,
        "status_label": reg.get_status_display(),
        "ficha_version": reg.ficha_version,
        "editable": bool(is_staff or reg.status == Registration.Status.DRAFT),
        "child_name": child_full_name(reg),
        "level": reg.level,
        "level_label": level_label(reg.level),
        "cycle": reg.cycle,
        "pre_registration": reg.pre_registration_id,
        "sections": sections,
        "medical_masked": not medical_ok,
        "firma": firma,
        "completeness": completeness(values),
        "submitted_at": reg.submitted_at,
        "created_at": reg.created_at,
        "updated_at": reg.updated_at,
    }


# ── saving a section ─────────────────────────────────────────────────────
def _audit_value(name, value):
    if name in REGISTRATION_MEDICAL_FIELDS and value not in (None, ""):
        return "[redacted]"
    return _json(value)


def _apply_registration(reg, key: str, attrs: dict) -> dict:
    changes = {}
    for name, value in attrs.items():
        old = getattr(reg, name)
        if old != value:
            changes[name] = [old, value]
            setattr(reg, name, value)
    if key == "alumno":
        # Lists, emails, dedupe and convert keep reading the legacy pair.
        if reg.child_given_names.strip():
            reg.child_first_name = reg.child_given_names.strip()[:100]
        last = join_name(reg.child_paternal_surname, reg.child_maternal_surname)
        if last:
            reg.child_last_name = last[:100]
        level = level_for_grade(reg.grade_applying)
        if level:
            reg.level = level
    elif key == "emergencia":
        name = join_name(reg.emergency_given_names, reg.emergency_surnames)
        if name:
            reg.emergency_name = name[:200]
    reg.ficha_version = FICHA
    reg.save()
    return changes


def _apply_guardian(reg, role: str, attrs: dict, guardians: dict) -> dict:
    g = guardians.get(role)
    if g is None:
        g = RegistrationGuardian(registration=reg, role=role)
        guardians[role] = g
    if attrs.get("not_applicable") is True:
        # «No aplica»: keep no personal data for a block that does not apply.
        for f in SECTIONS[role].fields:
            if f.name != "not_applicable":
                attrs[f.name] = _empty(f)
    changes = {}
    for name, value in attrs.items():
        old = getattr(g, name)
        if old != value:
            changes[name] = [old, value]
            setattr(g, name, value)
    g.save()
    reg.ficha_version = FICHA
    reg.save(update_fields=["ficha_version", "updated_at"])
    return changes


def save_section(reg, key: str, data, *, is_staff: bool, actor=None) -> dict:
    """Validate and store one section; returns the updated guardians map.

    Raises DRF ``ValidationError`` (400, ``{field: [message]}``) on format errors.
    """
    section = SECTIONS[key]
    guardians = guardians_by_role(reg)
    saved = section_values(reg, key, guardians)
    ser = serializer_class(key)(data=data, context={"saved": saved, "is_staff": is_staff})
    ser.is_valid(raise_exception=True)
    attrs = dict(ser.validated_data)
    with transaction.atomic():
        if section.target == "guardian":
            changes = _apply_guardian(reg, key, attrs, guardians)
        else:
            changes = _apply_registration(reg, key, attrs)
        if key in ("contacto", "padre", "madre"):
            sync_legacy_parents(reg, list(guardians.values()))
        if is_staff and changes:
            record(
                "update",
                reg,
                {
                    f"{key}.{name}": [_audit_value(name, old), _audit_value(name, new)]
                    for name, (old, new) in changes.items()
                },
                actor=actor,
                context=f"admissions: ficha ({key})",
            )
    return guardians


# ── public start (step 0) ────────────────────────────────────────────────
def public_start_enabled() -> bool:
    from apps.content.models import SiteSettings

    return bool(SiteSettings.load().admissions_public_start)


def start_ficha(data) -> tuple[Registration, str, str]:
    """Create the lead + the DRAFT ficha; returns ``(registration, session, invite)``.

    Raises DRF ``ValidationError`` with ``{field: [message]}``.
    """
    ser = serializer_class("inicio")(data=data, context={"saved": {}, "is_staff": False})
    ser.is_valid(raise_exception=True)
    attrs = ser.validated_data
    missing = section_missing(INICIO, attrs)
    if missing:
        raise serializers.ValidationError({name: [msg] for name, msg in missing.items()})

    given = attrs["child_given_names"].strip()
    paternal = attrs["child_paternal_surname"].strip()
    maternal = (attrs.get("child_maternal_surname") or "").strip()
    last = join_name(paternal, maternal)
    grade = attrs["grade_applying"]
    level = level_for_grade(grade)
    with transaction.atomic():
        lead = PreRegistration.objects.create(
            child_first_name=given[:100],
            child_last_name=last[:100],
            child_dob=None,
            level=level,
            grade_applying=grade,
            cycle=attrs["cycle"],
            parent_name=attrs["contact_name"],
            parent_email=attrs["contact_email"],
            parent_phone=attrs["contact_phone"],
            relationship=attrs["contact_relationship"],
            referral_source=attrs.get("referral_source", ""),
            message=attrs.get("message", ""),
            wants_visit=bool(attrs.get("wants_visit", False)),
            status=PreRegistration.Status.PENDING,
        )
        reg = Registration(
            pre_registration=lead,
            ficha_version=FICHA,
            status=Registration.Status.DRAFT,
            contact_name=attrs["contact_name"],
            contact_email=attrs["contact_email"],
            contact_phone=attrs["contact_phone"],
            contact_relationship=attrs["contact_relationship"],
            child_given_names=given,
            child_paternal_surname=paternal,
            child_maternal_surname=maternal,
            child_first_name=given[:100],
            child_last_name=last[:100],
            level=level,
            grade_applying=grade,
            cycle=attrs["cycle"],
        )
        sync_legacy_parents(reg, [], save=False)
        reg.save()
        session = issue_session(reg)
        invite = issue_invite(reg)
    return reg, session, invite


# ── submit ───────────────────────────────────────────────────────────────
TRUE_VALUES = (True, 1, "1", "true", "True", "on", "si", "sí")


def truthy(value) -> bool:
    return value in TRUE_VALUES


def clean_signature(value) -> str:
    return " ".join(str(value or "").split())


def submit_problems(reg, data, *, is_staff: bool) -> tuple[dict, dict]:
    """Everything that blocks sending a ficha: ``({section: {field: [msg]}}, guardians)``.

    Format rules re-run over the stored values (a draft from the old wizard may
    hold a malformed phone or CURP), then the required rules, then the age
    rule (families only: the office may log exceptions), then the signature.
    """
    guardians = guardians_by_role(reg)
    values = all_values(reg, guardians)
    problems: dict[str, dict[str, list[str]]] = {}

    def add(section, field, messages):
        bucket = problems.setdefault(section, {}).setdefault(field, [])
        bucket.extend(m for m in messages if m not in bucket)

    for key in PATCH_SECTIONS:
        ser = serializer_class(key)(
            data=json_section(values[key]), context={"saved": values[key], "is_staff": is_staff}
        )
        if not ser.is_valid():
            for field, messages in ser.errors.items():
                add(key, field, [str(m) for m in messages])
    for key, fields in required_errors(values).items():
        for field, messages in fields.items():
            add(key, field, messages)
    if not is_staff and reg.child_dob and reg.grade_applying:
        rule = eligibility_error(reg.child_dob, reg.grade_applying, cycles.parse_cycle(reg.cycle))
        if rule:
            add("alumno", "grade_applying", [rule])
    if not truthy(data.get("accept_privacy")):
        add("firma", "accept_privacy", [FIRMA.field("accept_privacy").message])
    signed = clean_signature(data.get("signed_name"))
    if len(signed.split()) < 2 or len(signed) > 200:
        add("firma", "signed_name", [FIRMA.field("signed_name").message])
    return problems, guardians


def has_medical_data(reg) -> bool:
    return any(getattr(reg, name) for name in REGISTRATION_MEDICAL_FIELDS)


def client_ip(request) -> str | None:
    """``REMOTE_ADDR`` (already the real client: core.client_ip middleware), if an IP."""
    raw = (request.META.get("REMOTE_ADDR") or "").strip()
    try:
        return str(ipaddress.ip_address(raw))
    except ValueError:
        return None


def sign_and_submit(reg, data, guardians: dict, request) -> None:
    from apps.legal.models import PrivacyNoticeVersion

    now = timezone.now()
    with transaction.atomic():
        sync_legacy_parents(reg, list(guardians.values()), save=False)
        reg.privacy_notice_version = PrivacyNoticeVersion.current()
        reg.privacy_accepted_at = now
        reg.signed_name = clean_signature(data.get("signed_name"))[:200]
        reg.signed_at = now
        reg.signed_ip = client_ip(request)
        if "consent_photos_media" in data:
            reg.consent_photos_media = truthy(data.get("consent_photos_media"))
        reg.submit()


# ── continuar mi ficha ───────────────────────────────────────────────────
RESUME_LIMIT = 3
RESUME_MESSAGE = (
    "Si hay una ficha de inscripción en proceso con ese correo, le enviamos un "
    "enlace para continuarla. Revise su bandeja de entrada y la carpeta de correo "
    "no deseado."
)


def resume_drafts(email: str) -> list[tuple[Registration, str, str]]:
    """Fresh single-use links for the newest drafts of ``email``: ``[(reg, url, to)]``."""
    email = (email or "").strip()
    if not email or email == RETENTION_PLACEHOLDER:
        return []
    drafts = (
        Registration.objects.filter(status=Registration.Status.DRAFT)
        .filter(Q(contact_email__iexact=email) | Q(parent1_email__iexact=email))
        .order_by("-updated_at")[:RESUME_LIMIT]
    )
    jobs = []
    for reg in drafts:
        raw = issue_invite(reg)
        jobs.append((reg, invite_url_for(reg, raw), reg.contact_email or reg.parent1_email))
    return jobs


def send_resume_links(jobs) -> None:
    for reg, url, to in jobs:
        email_resume_link(reg, url, to)


# ── emails ───────────────────────────────────────────────────────────────
def _child(reg) -> str:
    return child_full_name(reg)


def _short(reg) -> str:
    """The applicant as family emails name them (D13): «Ana P.»."""
    from apps.portal.emailing import name_initial

    return name_initial(reg.child_first_name, reg.child_last_name) or _child(reg)


def _who(reg) -> str:
    return reg.contact_name or reg.parent1_name


def email_ficha_started(reg: Registration, invite_url: str) -> None:
    """To the family: «Recibimos el inicio de su ficha… puede continuar aquí»."""
    from apps.portal.emailing import EmailContent, long_date
    from apps.portal.services import send_email

    lead = reg.pre_registration
    content = EmailContent(
        category="Admisiones",
        tone="success",
        title=f"Recibimos el inicio de la ficha de {reg.child_first_name}",
        intro=(
            f"Estimado/a {_who(reg)}: gracias por su interés en el Colegio Interlaken. "
            f"Recibimos el inicio de la ficha de inscripción de {_short(reg)}. Sus datos se "
            f"guardan en cada paso: puede continuarla aquí cuando guste."
        ),
        details=[
            ("Alumno", _short(reg)),
            ("Grado", reg.grade_applying),
            ("Nivel", level_label(reg.level)),
            ("Ciclo escolar", reg.cycle),
            (
                "Visita al colegio",
                "Solicitada" if lead is not None and lead.wants_visit else "No solicitada",
            ),
            ("El enlace vence", long_date(reg.invite_expires_at)),
        ],
        cta_label="Continuar la ficha",
        cta_url=invite_url,
        note=(
            "El enlace es personal y de un solo uso: no lo comparta. Si vence o ya lo usó, "
            "pida uno nuevo en la página de inscripción con su correo, o responda a este correo."
        ),
        signoff="Equipo de Admisiones",
        reason="Recibe este correo porque inició la ficha de inscripción en interlaken.edu.mx.",
    )
    # D13: subjects carry no names (they show on lock screens and in shared inboxes).
    send_email(
        "Ficha de inscripción iniciada",
        "",
        [reg.contact_email],
        reply_to=settings.ADMISSIONS_EMAIL,
        content=content,
    )


def notify_office_ficha_started(reg: Registration) -> None:
    """To the school inbox, same recipient rule as the old pre-registro notice."""
    from apps.portal.emailing import EmailContent, portal_url
    from apps.portal.services import send_email

    lead = reg.pre_registration
    recipient = settings.ADMISSIONS_EMAIL or settings.CONTACT_EMAIL or settings.DEFAULT_FROM_EMAIL
    details = [
        ("Nivel", level_label(reg.level)),
        ("Grado", reg.grade_applying),
        ("Ciclo escolar", reg.cycle),
        ("Quién llena la ficha", f"{reg.contact_name} ({reg.contact_relationship})"),
        ("Correo", reg.contact_email),
        ("Celular", reg.contact_phone),
    ]
    paragraphs = []
    if lead is not None:
        details += [
            (
                "¿Cómo nos conoció?",
                choice_label("como_nos_conocio", lead.referral_source) or "Sin dato",
            ),
            ("Desea visita", "Sí" if lead.wants_visit else "No"),
        ]
        if lead.message:
            paragraphs.append(f"Comentarios de la familia: {lead.message}")
    content = EmailContent(
        category="Admisiones · aviso interno",
        title=f"Nueva ficha de inscripción: {_child(reg)}",
        intro=(
            "Una familia inició la ficha de inscripción desde el sitio; ya aparece en "
            "Pre-registros. Responda a este correo para escribirle directamente."
        ),
        details=details,
        paragraphs=paragraphs,
        cta_label="Abrir en Admisiones",
        cta_url=portal_url("/admin/admisiones"),
        link_fallback=False,
        reason="Aviso interno del sitio del Colegio Interlaken.",
    )
    send_email(
        "Nueva ficha de inscripción iniciada",
        "",
        [recipient],
        reply_to=reg.contact_email,
        content=content,
    )


def email_resume_link(reg: Registration, url: str, to: str) -> None:
    from apps.portal.emailing import EmailContent, long_date
    from apps.portal.services import send_email

    content = EmailContent(
        category="Admisiones",
        title=f"Continúe la ficha de inscripción de {reg.child_first_name}",
        intro=(
            f"Estimado/a {_who(reg)}: recibimos su solicitud para continuar la ficha de "
            f"inscripción de {_short(reg)}. Lo que ya capturó sigue guardado."
        ),
        details=[
            ("Alumno", _short(reg)),
            ("Grado", reg.grade_applying),
            ("El enlace vence", long_date(reg.invite_expires_at)),
        ],
        cta_label="Continuar la ficha",
        cta_url=url,
        note=(
            "El enlace es personal y de un solo uso. Si usted no lo pidió, puede ignorar este "
            "correo: su ficha sigue protegida."
        ),
        signoff="Equipo de Admisiones",
        reason=ADM_REASON,
    )
    send_email(
        "Enlace para continuar la ficha",
        "",
        [to],
        reply_to=settings.ADMISSIONS_EMAIL,
        content=content,
    )


def email_ficha_submitted(reg: Registration) -> None:
    from apps.portal.emailing import EmailContent
    from apps.portal.services import send_email

    content = EmailContent(
        category="Admisiones",
        tone="success",
        title=f"Recibimos la ficha de inscripción de {reg.child_first_name}",
        intro=(
            f"Estimado/a {reg.parent1_name}: recibimos la ficha de inscripción de {_short(reg)}. "
            f"La revisaremos y le informaremos el resultado en un plazo de 3 a 5 días hábiles."
        ),
        details=[
            ("Alumno", _short(reg)),
            ("Grado", reg.grade_applying),
            ("Ciclo escolar", reg.cycle),
            ("Firmada por", reg.signed_name),
        ],
        note=(
            "Si el colegio necesita documentos, le enviaremos un enlace para subirlos. "
            "Si tiene dudas, responda a este correo."
        ),
        signoff="Equipo de Admisiones",
        reason="Recibe este correo porque envió una ficha de inscripción al Colegio Interlaken.",
    )
    send_email(
        "Ficha de inscripción recibida",
        "",
        [reg.parent1_email],
        reply_to=settings.ADMISSIONS_EMAIL,
        content=content,
    )
