"""
admissions/ficha_export/concentrado.py — «Concentrado de fichas»: one row per
student with every field of the ficha, padre and madre included (Excel).

The health columns exist only when the requester may read health data (an
admin, ``ficha.is_admin_reader``), and each row fills them only when that
family gave the MEDICAL_DATA consent: the same rule as the ficha itself.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable
from dataclasses import dataclass
from datetime import date, datetime

from django.utils import timezone

from apps.core.exporting import XLSX_DATE, XLSX_DATETIME, xlsx_bytes

from ..ficha_schema import choice_label, level_label
from .data import notice_version

SHEET_TITLE = "Concentrado de fichas"


@dataclass(frozen=True)
class Column:
    header: str
    get: Callable  # (registration, {role: guardian}) -> value
    width: int = 16


def _attr(name):
    return lambda reg, _g: getattr(reg, name)


def _choice(key, name):
    return lambda reg, _g: choice_label(key, getattr(reg, name) or "")


def _g(role, name, *, choice=None):
    def get(_reg, guardians):
        g = guardians.get(role)
        if g is None:
            return ""
        value = getattr(g, name)
        return choice_label(choice, value or "") if choice else value

    return get


def _occupation(role):
    def get(_reg, guardians):
        g = guardians.get(role)
        if g is None or not g.occupation:
            return ""
        label = choice_label("ocupacion", g.occupation)
        if g.occupation == "otro" and g.occupation_other:
            return f"{label}: {g.occupation_other}"
        return label

    return get


def _blood(reg, _g):
    return choice_label("tipo_sangre", reg.blood_type or "")


def _guardian_columns(role: str, title: str) -> list[Column]:
    return [
        Column(f"{title}: no aplica", _g(role, "not_applicable"), 9),
        Column(f"{title}: tutor/a legal", _g(role, "is_legal_guardian"), 9),
        Column(f"{title}: apellido paterno", _g(role, "paternal_surname")),
        Column(f"{title}: apellido materno", _g(role, "maternal_surname")),
        Column(f"{title}: nombre(s)", _g(role, "given_names")),
        Column(f"{title}: sexo", _g(role, "sex", choice="sexo"), 10),
        Column(f"{title}: fecha de nacimiento", _g(role, "dob"), 12),
        Column(f"{title}: país de nacimiento", _g(role, "birth_country")),
        Column(f"{title}: estado de nacimiento", _g(role, "birth_state")),
        Column(f"{title}: CURP", _g(role, "curp"), 20),
        Column(f"{title}: estado civil", _g(role, "marital_status", choice="estado_civil"), 12),
        Column(
            f"{title}: grado académico", _g(role, "education_level", choice="grado_academico"), 12
        ),
        Column(f"{title}: ocupación", _occupation(role), 24),
        Column(f"{title}: celular", _g(role, "mobile"), 13),
        Column(f"{title}: teléfono de oficina", _g(role, "office_phone"), 13),
        Column(f"{title}: extensión", _g(role, "office_ext"), 8),
        Column(f"{title}: correo electrónico", _g(role, "email"), 26),
    ]


COLUMNS: list[Column] = [
    Column("ID", _attr("pk"), 7),
    Column("Estado", lambda reg, _g: reg.get_status_display(), 14),
    Column("Ciclo escolar", _attr("cycle"), 11),
    Column("Nivel", lambda reg, _g: level_label(reg.level), 11),
    Column("Grado", _attr("grade_applying"), 13),
    Column("Creada", _attr("created_at"), 16),
    Column("Enviada", _attr("submitted_at"), 16),
    # Datos del alumno
    Column("Alumno: apellido paterno", _attr("child_paternal_surname")),
    Column("Alumno: apellido materno", _attr("child_maternal_surname")),
    Column("Alumno: nombre(s)", _attr("child_given_names")),
    Column("Alumno: sexo", _choice("sexo", "child_sex"), 10),
    Column("Alumno: fecha de nacimiento", _attr("child_dob"), 12),
    Column("Alumno: país de nacimiento", _attr("child_birth_country")),
    Column("Alumno: estado de nacimiento", _attr("child_birth_state")),
    Column("Alumno: CURP", _attr("child_curp"), 20),
    Column("Escuela anterior", _attr("previous_school"), 22),
    # Domicilio
    Column("Calle", _attr("address_street"), 22),
    Column("Núm. exterior", _attr("address_ext_number"), 9),
    Column("Núm. interior", _attr("address_int_number"), 9),
    Column("Entre calles", _attr("address_between_streets"), 22),
    Column("Estado (domicilio)", _attr("address_state")),
    Column("Municipio o alcaldía", _attr("address_municipality")),
    Column("Colonia", _attr("address_neighborhood")),
    Column("Código postal", _attr("address_postal_code"), 9),
    Column("Teléfono de casa", _attr("home_phone"), 13),
    # Quién llena la ficha
    Column("Quién llena: nombre", _attr("contact_name"), 24),
    Column("Quién llena: correo", _attr("contact_email"), 26),
    Column("Quién llena: celular", _attr("contact_phone"), 13),
    Column("Quién llena: parentesco", _attr("contact_relationship"), 12),
    *_guardian_columns("padre", "Padre"),
    *_guardian_columns("madre", "Madre"),
    # Información en caso de emergencia
    Column("Emergencia: apellido(s)", _attr("emergency_surnames")),
    Column("Emergencia: nombre(s)", _attr("emergency_given_names")),
    Column("Emergencia: parentesco", _attr("emergency_rel"), 12),
    Column("Emergencia: teléfono", _attr("emergency_phone"), 13),
    Column("Emergencia: celular", _attr("emergency_mobile"), 13),
    # Aviso de privacidad y firma
    Column("Firmada por", _attr("signed_name"), 24),
    Column("Firmada el", _attr("signed_at"), 16),
    Column("Aviso de privacidad (versión)", lambda reg, _g: notice_version(reg), 12),
    Column("Autoriza fotos y videos", _attr("consent_photos_media"), 10),
    Column("Autoriza datos de salud", _attr("consent_medical_data"), 10),
]

HEALTH_COLUMNS: list[Column] = [
    Column("Tipo de sangre", _blood, 10),
    Column("Estatura (cm)", _attr("estatura"), 9),
    Column("Peso (kg)", _attr("peso"), 9),
    Column("¿Tiene alergias?", _choice("alergias", "has_allergies"), 9),
    Column("Alergias: ¿cuáles?", _attr("allergies"), 30),
    Column("Enfermedades crónicas", _attr("chronic_conditions"), 30),
    Column("Otras indicaciones médicas", _attr("medical_notes"), 30),
]


def columns(*, include_health: bool) -> list[Column]:
    return COLUMNS + (HEALTH_COLUMNS if include_health else [])


def _cell(value) -> tuple[object, str | None]:
    if value is None or value == "":
        return None, None
    if isinstance(value, bool):
        return ("Sí" if value else "No"), None
    if isinstance(value, datetime):
        return timezone.localtime(value).replace(tzinfo=None), XLSX_DATETIME
    if isinstance(value, date):
        return value, XLSX_DATE
    if isinstance(value, int):
        return value, "0"
    return str(value), None


def _row(reg, *, include_health: bool) -> list[tuple[object, str | None]]:
    guardians = {g.role: g for g in reg.guardians.all()}  # prefetched
    out = [_cell(c.get(reg, guardians)) for c in COLUMNS]
    if include_health:
        if reg.consent_medical_data:
            out += [_cell(c.get(reg, guardians)) for c in HEALTH_COLUMNS]
        else:
            out += [(None, None)] * len(HEALTH_COLUMNS)
    return out


def concentrado_xlsx(regs: Iterable, *, include_health: bool) -> bytes:
    cols = columns(include_health=include_health)
    return xlsx_bytes(
        [c.header for c in cols],
        regs,
        sheet_title=SHEET_TITLE,
        widths=[c.width for c in cols],
        cells=lambda reg: _row(reg, include_health=include_health),
    )
