"""
admissions/ficha_export/data.py — a Registration (and its padre / madre
blocks) as the values of the printed ficha.

``ficha_sheet(reg, medical_ok=...)`` returns a ``FichaSheet``: logical field
id → value (``cellmap.CELLS``), the chosen option of every «X» group
(``cellmap.MARKS``) and the labels to rewrite. Formatting follows the
school's original form: names, places and addresses in capitals, dates split
into día / MES (Spanish month name) / año, phones as text (a leading zero or
a long number never turns into 5.5E+09), e-mails as typed.

Health data appears only when ``medical_ok`` (``ficha.can_access_medical``:
the family's own session, or an admin once the family consented); otherwise
the block stays empty with a note saying why.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime

from django.utils import timezone

from apps.core.pdf_document import SCHOOL_TZ

from ..ficha_schema import choice_label, level_label
from ..guardians import join_name
from . import cellmap

MONTHS = (
    "ENERO",
    "FEBRERO",
    "MARZO",
    "ABRIL",
    "MAYO",
    "JUNIO",
    "JULIO",
    "AGOSTO",
    "SEPTIEMBRE",
    "OCTUBRE",
    "NOVIEMBRE",
    "DICIEMBRE",
)
_MONTHS_LOWER = tuple(m.lower() for m in MONTHS)

NOTE_NO_BLOOD_TYPE = "Tipo de sangre: la familia indicó que no lo sabe."
NOTE_MEDICAL_MASKED = (
    "Datos de salud reservados: solo los consulta la dirección, con la autorización de la familia."
)
NOT_APPLICABLE = "NO APLICA"
BLANK_CYCLE = "____-____"


@dataclass
class FichaSheet:
    """The printed ficha as data: what ``excel.py`` and ``pdf.py`` draw."""

    ciclo: str = ""
    values: dict[str, object] = field(default_factory=dict)
    marks: dict[str, str] = field(default_factory=dict)
    labels: dict[str, str] = field(default_factory=dict)
    medical_masked: bool = False
    # For the file name and the PDF metadata.
    child_paternal: str = ""
    child_given: str = ""

    def cells(self) -> dict[str, object]:
        """``{cell: value}`` for every value, «X» and rewritten label."""
        out: dict[str, object] = {}
        for key, value in self.values.items():
            if value not in (None, ""):
                out[cellmap.CELLS[key]] = value
        for key, option in self.marks.items():
            box = cellmap.MARKS[key].get(option)
            if box:
                out[box] = cellmap.MARK
        for key, text in self.labels.items():
            out[cellmap.LABEL_CELLS[key]] = text
        return out


# ── formatting ───────────────────────────────────────────────────────────
def clean(value) -> str:
    """One line, single spaces ('' for None)."""
    return " ".join(str(value or "").split())


def upper(value) -> str:
    return clean(value).upper()


def multiline(value) -> str:
    """Free text (allergies, conditions): line breaks kept, spaces squeezed."""
    lines = [" ".join(line.split()) for line in str(value or "").splitlines()]
    return "\n".join(line for line in lines if line)


def split_date(prefix: str, value) -> dict[str, object]:
    if not isinstance(value, date):
        return {}
    return {
        f"{prefix}_dia": value.day,
        f"{prefix}_mes": MONTHS[value.month - 1],
        f"{prefix}_anio": value.year,
    }


def short_grade(grade: str) -> str:
    """«1° Primaria» → «1°» (the level has its own box); «Maternal» → «MATERNAL»."""
    words = clean(grade).split()
    if len(words) == 2 and words[0].endswith("°"):
        return words[0]
    return upper(grade)


def gendered(label: str, sex: str) -> str:
    """«Divorciado/a» → «Divorciada» for a woman, «Divorciado» for a man."""
    if "/a" not in label:
        return label
    if sex == "femenino":
        return label.replace("o/a", "a")
    if sex == "masculino":
        return label.replace("/a", "")
    return label


def local_dt(value: datetime) -> datetime:
    return timezone.localtime(value, SCHOOL_TZ) if timezone.is_aware(value) else value


def long_datetime(value: datetime) -> str:
    """«20 de noviembre de 2026, 13:47 h (hora de la Ciudad de México)»."""
    local = local_dt(value)
    month = _MONTHS_LOWER[local.month - 1]
    return f"{local.day} de {month} de {local.year}, {local:%H:%M} h (hora de la Ciudad de México)"


def notice_version(reg) -> str:
    ver = reg.privacy_notice_version
    if ver is None:
        return ""
    return getattr(ver, "version", None) or str(ver)


def acceptance_line(reg) -> str:
    """«Aceptado electrónicamente por … el … · Aviso de privacidad versión …»."""
    if not reg.signed_at:
        return ""
    who = clean(reg.signed_name) or clean(reg.contact_name) or clean(reg.parent1_name)
    text = f"Aceptado electrónicamente por {who} el {long_datetime(reg.signed_at)}"
    version = notice_version(reg)
    if version:
        text += f" · Aviso de privacidad versión {version}"
    return text


# ── the sheet ────────────────────────────────────────────────────────────
def _child_names(reg) -> tuple[str, str, str]:
    """(paterno, materno, nombre(s)); the old wizard's records fall back to
    the legacy first / last name pair."""
    given = clean(reg.child_given_names) or clean(reg.child_first_name)
    paternal = clean(reg.child_paternal_surname)
    maternal = clean(reg.child_maternal_surname)
    if not paternal and not maternal:
        words = clean(reg.child_last_name).split()
        paternal = words[0] if words else ""
        maternal = " ".join(words[1:])
    return paternal, maternal, given


def _guardian(sheet: FichaSheet, role: str, g) -> str:
    """Fill one parent block; returns the full name for its signature line."""
    if g is None:
        return ""
    if g.not_applicable:
        sheet.values[f"{role}.nombre"] = NOT_APPLICABLE
        return ""
    v = sheet.values
    v[f"{role}.apellido_paterno"] = upper(g.paternal_surname)
    v[f"{role}.apellido_materno"] = upper(g.maternal_surname)
    v[f"{role}.nombre"] = upper(g.given_names)
    v.update(split_date(f"{role}.nacimiento", g.dob))
    v[f"{role}.pais_nacimiento"] = upper(g.birth_country)
    v[f"{role}.estado_nacimiento"] = upper(g.birth_state)
    v[f"{role}.curp"] = upper(g.curp)
    v[f"{role}.celular"] = clean(g.mobile)
    v[f"{role}.telefono_oficina"] = clean(g.office_phone)
    v[f"{role}.extension"] = clean(g.office_ext)
    v[f"{role}.correo"] = clean(g.email)
    if g.sex:
        sheet.marks[f"{role}.sexo"] = g.sex
    if g.marital_status:
        sheet.marks[f"{role}.estado_civil"] = g.marital_status
        if g.marital_status in cellmap.RELABELED_MARITAL:
            label = gendered(choice_label("estado_civil", g.marital_status), g.sex)
            sheet.labels[f"{role}.estado_civil"] = label
    if g.education_level:
        sheet.marks[f"{role}.grado_academico"] = g.education_level
    if g.occupation:
        sheet.marks[f"{role}.ocupacion"] = g.occupation
        if g.occupation == "otro":
            v[f"{role}.ocupacion_otro"] = clean(g.occupation_other)
    return upper(join_name(g.given_names, g.paternal_surname, g.maternal_surname))


def _health(sheet: FichaSheet, reg) -> None:
    v = sheet.values
    if reg.estatura:
        v["salud.estatura"] = f"{clean(reg.estatura)} cm"
    if reg.peso:
        v["salud.peso"] = f"{clean(reg.peso)} kg"
    if reg.blood_type == "no_se":
        v["salud.nota"] = NOTE_NO_BLOOD_TYPE
    elif reg.blood_type:
        sheet.marks["salud.tipo_sangre"] = reg.blood_type
    if reg.has_allergies:
        sheet.marks["salud.alergias"] = reg.has_allergies
    if reg.has_allergies != "no":
        v["salud.alergias_cuales"] = multiline(reg.allergies)
    parts = []
    if clean(reg.chronic_conditions):
        parts.append(multiline(reg.chronic_conditions))
    if clean(reg.medical_notes):
        parts.append(f"Otras indicaciones médicas: {multiline(reg.medical_notes)}")
    v["salud.enfermedades"] = "\n".join(parts)


def ficha_sheet(reg, *, medical_ok: bool, guardians: dict | None = None) -> FichaSheet:
    """The printed ficha of ``reg``. ``guardians``: ``{role: RegistrationGuardian}``."""
    if guardians is None:
        guardians = {g.role: g for g in reg.guardians.all()}
    paternal, maternal, given = _child_names(reg)
    sheet = FichaSheet(
        ciclo=clean(reg.cycle),
        medical_masked=not medical_ok,
        child_paternal=paternal,
        child_given=given,
    )
    v = sheet.values
    v["ciclo"] = f"Ciclo Escolar {clean(reg.cycle)}".strip()
    v["alumno.apellido_paterno"] = upper(paternal)
    v["alumno.apellido_materno"] = upper(maternal)
    v["alumno.nombre"] = upper(given)
    nivel = upper(level_label(reg.level))
    grado = short_grade(reg.grade_applying)
    v["alumno.nivel"] = nivel
    v["alumno.grado"] = grado
    v["alumno.escuela_anterior"] = upper(reg.previous_school)
    v.update(split_date("alumno.nacimiento", reg.child_dob))
    v["alumno.pais_nacimiento"] = upper(reg.child_birth_country)
    v["alumno.estado_nacimiento"] = upper(reg.child_birth_state)
    v["alumno.curp"] = upper(reg.child_curp)
    if reg.child_sex:
        sheet.marks["alumno.sexo"] = reg.child_sex

    v["domicilio.calle"] = upper(reg.address_street)
    v["domicilio.num_ext"] = upper(reg.address_ext_number)
    v["domicilio.num_int"] = upper(reg.address_int_number)
    v["domicilio.entre_calles"] = upper(reg.address_between_streets)
    v["domicilio.estado"] = upper(reg.address_state)
    v["domicilio.municipio"] = upper(reg.address_municipality)
    v["domicilio.colonia"] = upper(reg.address_neighborhood)
    v["domicilio.codigo_postal"] = clean(reg.address_postal_code)
    v["domicilio.telefono_casa"] = clean(reg.home_phone)

    if medical_ok:
        _health(sheet, reg)
    else:
        v["salud.nota"] = NOTE_MEDICAL_MASKED

    padre = _guardian(sheet, "padre", guardians.get("padre"))
    madre = _guardian(sheet, "madre", guardians.get("madre"))

    surnames = clean(reg.emergency_surnames)
    names = clean(reg.emergency_given_names)
    if not surnames and not names and clean(reg.emergency_name):
        names = clean(reg.emergency_name)
    rel = clean(reg.emergency_rel)
    v["emergencia.apellidos"] = upper(surnames)
    v["emergencia.nombre"] = upper(f"{names} ({rel})" if names and rel else names)
    v["emergencia.telefono"] = clean(reg.emergency_phone)
    v["emergencia.celular"] = clean(reg.emergency_mobile)

    v["firma.alumno"] = upper(join_name(given, paternal, maternal))
    v["firma.nivel"] = nivel
    v["firma.grado"] = grado
    if reg.signed_at:
        v["firma.fecha"] = f"{local_dt(reg.signed_at):%d/%m/%Y}"
    v["firma.padre"] = padre
    v["firma.madre"] = madre
    v["firma.aceptacion"] = acceptance_line(reg)
    return sheet


def blank_sheet() -> FichaSheet:
    """The ficha with nothing filled in (to print and fill by hand)."""
    return FichaSheet(values={"ciclo": f"Ciclo Escolar {BLANK_CYCLE}"})
