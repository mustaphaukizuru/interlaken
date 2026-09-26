"""
admissions/imports.py — pre-registros from fair sign-up sheets (Data Ops C4).

    GET  /api/v1/admissions/admin/pre-registrations/import/template/?fmt=csv|xlsx
    POST /api/v1/admissions/admin/pre-registrations/import/   file + dry_run / report / valid_only

Columns: ``nombre_alumno, apellidos_alumno, fecha_nacimiento`` (DD/MM/AAAA),
``nivel, grado, nombre_tutor, correo, telefono, origen, mensaje``.

* Every committed row is a NEW pre-registro in *pending* for the current
  cycle (``current_school_cycle()``); an import never updates a row.
* Duplicates only WARN (families re-apply at every fair): the key is
  ``(correo, nombre, apellidos, nacimiento)`` case-insensitively, both inside
  the file and against the database. Rows purged by retention (correo
  ``[eliminado por retención]``) never count as duplicates.
* No email is sent to the families or to the school: an import is staff
  transcribing paper, not a web submission.
* ``nivel`` may be left empty when ``grado`` names it ("Primaria 3°").
* The age rule of the public form (31-Dec cut-off) is a warning here.
"""

from __future__ import annotations

from datetime import timedelta

from django.utils import timezone

from apps.core.importing import (
    ImportCol,
    ImportRow,
    ImportSpec,
    ImportTemplateView,
    ImportView,
    parse_choice,
    parse_date_es,
    parse_email,
)

from .models import PreRegistration, current_school_cycle
from .services import RETENTION_PLACEHOLDER

ENTITY = "pre-registros"

LEVEL_KEYWORDS = (
    ("preescolar", PreRegistration.Level.PRESCHOOL),
    ("kinder", PreRegistration.Level.PRESCHOOL),
    ("primaria", PreRegistration.Level.PRIMARY),
    ("secundaria", PreRegistration.Level.SECONDARY),
)

parse_level = parse_choice(
    PreRegistration.Level.choices,
    aliases={
        "kinder": "preescolar",
        "prees": "preescolar",
        "prim": "primaria",
        "sec": "secundaria",
    },
)


def level_from_grade(grade: str) -> str | None:
    text = (grade or "").lower()
    for keyword, level in LEVEL_KEYWORDS:
        if keyword in text:
            return level
    return None


def _max_len(n: int):
    def check(value, _data):
        if value and len(str(value)) > n:
            return f"máximo {n} caracteres"
        return None

    return check


def _dob_ok(value, _data):
    today = timezone.localdate()
    if value > today:
        return "no puede ser futura"
    if value < today - timedelta(days=365 * 25):
        return "no es válida"
    return None


COLUMNS = [
    ImportCol(
        "nombre_alumno",
        ("nombre", "nombre_del_alumno", "alumno", "child_first_name"),
        required=True,
        validators=(_max_len(100),),
        example="Ana María",
        label="nombre_alumno",
    ),
    ImportCol(
        "apellidos_alumno",
        ("apellidos", "apellidos_del_alumno", "child_last_name"),
        required=True,
        validators=(_max_len(100),),
        example="Pérez López",
    ),
    ImportCol(
        "fecha_nacimiento",
        ("nacimiento", "fecha_de_nacimiento", "child_dob"),
        required=True,
        parse=parse_date_es,
        validators=(_dob_ok,),
        example="15/03/2019",
    ),
    ImportCol("nivel", ("level", "nivel_educativo"), parse=parse_level, example="primaria"),
    ImportCol(
        "grado",
        ("grade", "grado_a_solicitar", "grade_applying"),
        required=True,
        validators=(_max_len(30),),
        example="Primaria 1°",
    ),
    ImportCol(
        "nombre_tutor",
        ("tutor", "padre", "padre_tutor", "parent_name"),
        required=True,
        validators=(_max_len(200),),
        example="Roberto Pérez",
    ),
    ImportCol(
        "correo",
        ("email", "correo_electronico", "parent_email"),
        required=True,
        parse=parse_email,
        validators=(_max_len(254),),
        example="roberto@ejemplo.mx",
    ),
    ImportCol(
        "telefono",
        ("tel", "celular", "whatsapp", "telefono_whatsapp", "parent_phone"),
        validators=(_max_len(20),),
        example="5512345678",
    ),
    ImportCol(
        "origen",
        ("como_nos_conocio", "fuente", "referral_source"),
        validators=(_max_len(100),),
        example="Feria escolar",
    ),
    ImportCol("mensaje", ("comentarios", "notas", "message"), example=""),
]


def _key(data: dict) -> tuple:
    dob = data.get("fecha_nacimiento")
    return (
        str(data.get("correo") or "").strip().lower(),
        str(data.get("nombre_alumno") or "").strip().lower(),
        str(data.get("apellidos_alumno") or "").strip().lower(),
        dob.isoformat() if dob else "",
    )


def build_spec() -> ImportSpec:
    """A fresh spec per request: the DB-duplicate lookup caches per email."""
    existing: dict[str, set[tuple]] = {}

    def keys_for(email: str) -> set[tuple]:
        if email not in existing:
            rows = (
                PreRegistration.objects.filter(parent_email__iexact=email)
                .exclude(parent_email=RETENTION_PLACEHOLDER)
                .values_list("parent_email", "child_first_name", "child_last_name", "child_dob")
            )
            existing[email] = {
                (e.lower(), f.strip().lower(), last.strip().lower(), d.isoformat())
                for e, f, last, d in rows
            }
        return existing[email]

    def validate_row(data: dict, row: ImportRow):
        grade = str(data.get("grado") or "")
        if not data.get("nivel"):
            derived = level_from_grade(grade)
            if derived:
                data["nivel"] = derived
            elif grade:
                row.error("nivel: indíquelo o escriba el nivel en el grado (Primaria 3°).")
        if row.errors:
            return
        from .eligibility import eligibility_error

        rule = eligibility_error(data.get("fecha_nacimiento"), grade)
        if rule:
            row.warn(f"Edad: {rule}")
        key = _key(data)
        if key[0] and key[0] != RETENTION_PLACEHOLDER and key in keys_for(key[0]):
            row.warn("Ya existe un pre-registro con este correo, alumno y fecha de nacimiento.")

    def create(data: dict, actor):
        return PreRegistration.objects.create(
            child_first_name=data["nombre_alumno"],
            child_last_name=data["apellidos_alumno"],
            child_dob=data["fecha_nacimiento"],
            level=data["nivel"],
            grade_applying=data["grado"],
            cycle=current_school_cycle(),
            parent_name=data["nombre_tutor"],
            parent_email=data["correo"],
            parent_phone=data.get("telefono") or "",
            referral_source=data.get("origen") or "",
            message=data.get("mensaje") or "",
            status=PreRegistration.Status.PENDING,
        )

    return ImportSpec(
        entity=ENTITY,
        label="Pre-registros",
        columns=COLUMNS,
        dedupe_keys=[("correo", "nombre_alumno", "apellidos_alumno", "fecha_nacimiento")],
        duplicates_block=False,
        validate_row=validate_row,
        create=create,
        key_of=lambda d: f"{d.get('correo') or ''} / {d.get('nombre_alumno') or ''} "
        f"{d.get('apellidos_alumno') or ''}".strip(),
    )


class PreRegistrationImportTemplateView(ImportTemplateView):
    def get_spec(self):
        return build_spec()


class PreRegistrationImportView(ImportView):
    template_url = "/api/v1/admissions/admin/pre-registrations/import/template/"

    def get_spec(self):
        return build_spec()
