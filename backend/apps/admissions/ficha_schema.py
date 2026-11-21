"""
admissions/ficha_schema.py — the ficha de inscripción as data (single source).

The school's 2021 Excel «Ficha de inscripción», section by section: every
field with its label, type, choices and required rule. The same definitions
drive three things, so they can never diverge:

* ``GET /api/v1/admissions/ficha/schema/`` (``schema_json``): the React form
  renders its steps, options and asterisks from it;
* the section serializers in ``admissions.ficha`` (format validation on every
  save);
* the required-for-submit rules (``completeness`` / ``required_errors``).

Conditions are small dicts the frontend evaluates the same way:
``{'field': 'has_allergies', 'equals': 'si'}`` or
``{'field': 'birth_country', 'in': ['México', '']}``. A section's
``skip_if`` (the «No aplica» of a parent block) switches its rules off; a
section ``rule`` ``at_least_one`` needs one of its fields; ``GLOBAL_RULES``
cross sections (at least one of padre / madre must apply).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, replace
from datetime import date

from .cycles import cycle_choices
from .validators import ESTADOS, MEXICO, fold_text

REQUIRED_MSG = "Este dato es obligatorio."

# ── choices ──────────────────────────────────────────────────────────────
# Grade label (the roster's spelling, frontend lib/grades.ts) → level.
GRADES: tuple[tuple[str, str], ...] = (
    ("Maternal", "preescolar"),
    ("1° Preescolar", "preescolar"),
    ("2° Preescolar", "preescolar"),
    ("3° Preescolar", "preescolar"),
    ("1° Primaria", "primaria"),
    ("2° Primaria", "primaria"),
    ("3° Primaria", "primaria"),
    ("4° Primaria", "primaria"),
    ("5° Primaria", "primaria"),
    ("6° Primaria", "primaria"),
    ("1° Secundaria", "secundaria"),
    ("2° Secundaria", "secundaria"),
    ("3° Secundaria", "secundaria"),
)
GRADE_LEVEL = dict(GRADES)
LEVELS = (("preescolar", "Preescolar"), ("primaria", "Primaria"), ("secundaria", "Secundaria"))

SEXO = (("femenino", "Femenino"), ("masculino", "Masculino"))
TIPO_SANGRE = (
    ("A+", "A+"),
    ("A-", "A-"),
    ("B+", "B+"),
    ("B-", "B-"),
    ("AB+", "AB+"),
    ("AB-", "AB-"),
    ("O+", "O+"),
    ("O-", "O-"),
    ("no_se", "No lo sé"),
)
ALERGIAS = (("si", "Sí"), ("no", "No"))
ESTADO_CIVIL = (
    ("soltero", "Soltero/a"),
    ("casado", "Casado/a"),
    ("union_libre", "Unión libre"),
    ("divorciado", "Divorciado/a"),
    ("viudo", "Viudo/a"),
)
GRADO_ACADEMICO = (
    ("tecnico", "Técnico"),
    ("licenciatura", "Lic. / Ing."),
    ("maestria", "Maestría"),
    ("doctorado", "Doctorado"),
)
OCUPACION = (
    ("asalariado_sin_estudios", "Asalariado sin estudios profesionales"),
    ("asalariado_con_estudios", "Asalariado con estudios profesionales"),
    ("negocio_propio", "Negocio propio"),
    ("independiente", "Independiente"),
    ("comerciante", "Comerciante"),
    ("ama_de_casa", "Ama de casa"),
    ("otro", "Otro"),
)
OCCUPATION_OTHER = "otro"
# Who fills the ficha in (stored as the label, like PreRegistration.relationship).
PARENTESCO = tuple((x, x) for x in ("Madre", "Padre", "Tutor/a legal", "Abuelo/a", "Otro familiar"))
# Same values the old /pre-registro form stored in referral_source.
COMO_NOS_CONOCIO = (
    ("referido", "Recomendación de otra familia"),
    ("redes", "Redes sociales"),
    ("google", "Búsqueda en Google"),
    ("espectacular", "Espectacular o anuncio"),
    ("otro", "Otro"),
)


def _opts(pairs) -> list[dict]:
    return [{"value": v, "label": label} for v, label in pairs]


STATIC_CHOICES: dict[str, list[dict]] = {
    "grados": [{"value": g, "label": g, "level": lvl} for g, lvl in GRADES],
    "niveles": _opts(LEVELS),
    "sexo": _opts(SEXO),
    "estados": [{"value": e, "label": e} for e in ESTADOS],
    "tipo_sangre": _opts(TIPO_SANGRE),
    "alergias": _opts(ALERGIAS),
    "estado_civil": _opts(ESTADO_CIVIL),
    "grado_academico": _opts(GRADO_ACADEMICO),
    "ocupacion": _opts(OCUPACION),
    "parentesco": _opts(PARENTESCO),
    "como_nos_conocio": _opts(COMO_NOS_CONOCIO),
}


def choice_values(key: str) -> tuple[str, ...]:
    return tuple(o["value"] for o in STATIC_CHOICES[key])


def choice_label(key: str, value: str) -> str:
    for o in STATIC_CHOICES.get(key, ()):
        if o["value"] == value:
            return o["label"]
    return value or ""


def normalize_grade(text: str) -> str | None:
    """'Primaria 1°', '1° primaria', '1 Primaria' → '1° Primaria'; 'maternal' → 'Maternal'."""
    folded = fold_text(text)
    if not folded:
        return None
    if "maternal" in folded:
        return "Maternal"
    number = re.search(r"([1-6])", folded)
    for level in ("preescolar", "primaria", "secundaria"):
        if level in folded and number:
            candidate = f"{number.group(1)}° {level.capitalize()}"
            if candidate in GRADE_LEVEL:
                return candidate
    return None


def level_for_grade(grade: str) -> str:
    """The level code of a grade ('Maternal' → 'preescolar'); '' when unknown."""
    canonical = normalize_grade(grade) or grade
    return GRADE_LEVEL.get(canonical, "")


def level_label(level: str) -> str:
    return dict(LEVELS).get(level, level or "")


# ── fields and sections ──────────────────────────────────────────────────
@dataclass(frozen=True)
class FieldSpec:
    name: str
    label: str
    # text | textarea | email | phone | extension | postal_code | curp | date |
    # select | grade | cycle | state | country | number | boolean
    type: str = "text"
    required: bool = False
    required_if: dict | None = None
    choices: str | None = None
    # ``state``: the entidad list applies only while this holds (else free text).
    choices_if: dict | None = None
    max_length: int | None = None
    help: str = ""
    default: object = None
    read_only: bool = False
    medical: bool = False
    unit: str = ""
    min: float | None = None
    max: float | None = None
    # Shown when the field is required and missing (default ``REQUIRED_MSG``).
    message: str = ""

    def is_required(self, values: dict) -> bool:
        if self.read_only:
            return False
        if self.required:
            return True
        return bool(self.required_if) and condition_met(self.required_if, values)

    def to_json(self) -> dict:
        return {
            "name": self.name,
            "label": self.label,
            "type": self.type,
            "required": self.required,
            "required_if": self.required_if,
            "choices": self.choices,
            "choices_if": self.choices_if,
            "max_length": self.max_length,
            "help": self.help,
            "default": self.default,
            "read_only": self.read_only,
            "medical": self.medical,
            "unit": self.unit or None,
            "min": self.min,
            "max": self.max,
        }


@dataclass(frozen=True)
class SectionSpec:
    key: str
    title: str
    fields: tuple[FieldSpec, ...]
    description: str = ""
    # registration | guardian | start | submit
    target: str = "registration"
    skip_if: dict | None = None
    rules: tuple[dict, ...] = ()

    @property
    def patchable(self) -> bool:
        return self.target in ("registration", "guardian")

    def field(self, name: str) -> FieldSpec:
        return next(f for f in self.fields if f.name == name)

    def to_json(self) -> dict:
        return {
            "key": self.key,
            "title": self.title,
            "description": self.description,
            "patchable": self.patchable,
            "target": self.target,
            "skip_if": self.skip_if,
            "rules": list(self.rules),
            "fields": [f.to_json() for f in self.fields],
        }


def condition_met(cond: dict | None, values: dict) -> bool:
    if not cond:
        return False
    value = values.get(cond["field"])
    if "equals" in cond:
        return value == cond["equals"]
    if "in" in cond:
        return (value if value is not None else "") in cond["in"]
    if "not_in" in cond:
        return (value if value is not None else "") not in cond["not_in"]
    return bool(value)


def is_blank(value) -> bool:
    if value is None or value is False:
        return True
    if isinstance(value, str):
        return not value.strip()
    return False


BORN_IN_MEXICO = {"field": "child_birth_country", "equals": MEXICO}
# A parent's country defaults to México: only a country typed in explicitly
# lifts the CURP requirement.
GUARDIAN_BORN_IN_MEXICO = {"field": "birth_country", "in": [MEXICO, ""]}

CONTACT_FIELDS = (
    FieldSpec(
        "contact_name",
        "Nombre completo",
        required=True,
        max_length=200,
        help="De la persona que llena la ficha.",
    ),
    FieldSpec(
        "contact_email",
        "Correo electrónico",
        type="email",
        required=True,
        max_length=254,
        help="Aquí le enviaremos el enlace para continuar la ficha.",
    ),
    FieldSpec("contact_phone", "Celular", type="phone", required=True, help="10 dígitos."),
    FieldSpec(
        "contact_relationship",
        "Parentesco con el alumno",
        type="select",
        choices="parentesco",
        required=True,
    ),
)

ALUMNO = SectionSpec(
    "alumno",
    "Datos del alumno",
    (
        FieldSpec("child_paternal_surname", "Apellido paterno", required=True, max_length=100),
        FieldSpec(
            "child_maternal_surname", "Apellido materno", required_if=BORN_IN_MEXICO, max_length=100
        ),
        FieldSpec("child_given_names", "Nombre(s)", required=True, max_length=100),
        FieldSpec(
            "grade_applying",
            "Grado al que se inscribe",
            type="grade",
            choices="grados",
            required=True,
        ),
        FieldSpec(
            "level", "Nivel", read_only=True, choices="niveles", help="Se calcula con el grado."
        ),
        FieldSpec("cycle", "Ciclo escolar", type="cycle", choices="ciclo", required=True),
        FieldSpec("previous_school", "Escuela anterior", max_length=200, help="Sólo si aplica."),
        FieldSpec("child_sex", "Sexo", type="select", choices="sexo", required=True),
        FieldSpec("child_dob", "Fecha de nacimiento", type="date", required=True),
        FieldSpec(
            "child_birth_country",
            "País de nacimiento",
            type="country",
            required=True,
            max_length=60,
            default=MEXICO,
        ),
        FieldSpec(
            "child_birth_state",
            "Estado de nacimiento",
            type="state",
            choices="estados",
            choices_if=BORN_IN_MEXICO,
            required_if=BORN_IN_MEXICO,
            max_length=60,
        ),
        FieldSpec(
            "child_curp",
            "CURP",
            type="curp",
            required_if=BORN_IN_MEXICO,
            help="Obligatoria si nació en México. Debe coincidir con la fecha de nacimiento y el sexo.",
        ),
    ),
)

DOMICILIO = SectionSpec(
    "domicilio",
    "Domicilio",
    (
        FieldSpec("address_street", "Calle", required=True, max_length=150),
        FieldSpec("address_ext_number", "Núm. exterior", required=True, max_length=20),
        FieldSpec("address_int_number", "Núm. interior", max_length=20),
        FieldSpec("address_between_streets", "Entre calles", max_length=200),
        FieldSpec(
            "address_state", "Estado", type="state", choices="estados", required=True, max_length=60
        ),
        FieldSpec("address_municipality", "Municipio o alcaldía", required=True, max_length=100),
        FieldSpec("address_neighborhood", "Colonia", required=True, max_length=100),
        FieldSpec("address_postal_code", "Código postal", type="postal_code", required=True),
        FieldSpec("home_phone", "Teléfono de casa", type="phone", help="10 dígitos."),
    ),
)

SALUD = SectionSpec(
    "salud",
    "Datos adicionales (salud)",
    (
        FieldSpec(
            "blood_type",
            "Tipo de sangre",
            type="select",
            choices="tipo_sangre",
            required=True,
            medical=True,
            help="Si no lo sabe, elija «No lo sé».",
        ),
        FieldSpec("estatura", "Estatura", type="number", unit="cm", min=30, max=230, medical=True),
        FieldSpec("peso", "Peso", type="number", unit="kg", min=2, max=250, medical=True),
        FieldSpec(
            "has_allergies",
            "¿Tiene alergias?",
            type="select",
            choices="alergias",
            required=True,
            medical=True,
        ),
        FieldSpec(
            "allergies",
            "¿Cuáles?",
            type="textarea",
            max_length=500,
            medical=True,
            required_if={"field": "has_allergies", "equals": "si"},
        ),
        FieldSpec(
            "chronic_conditions",
            "Enfermedades crónicas",
            type="textarea",
            max_length=1000,
            medical=True,
        ),
        FieldSpec(
            "medical_notes",
            "Otras indicaciones médicas",
            type="textarea",
            max_length=2000,
            medical=True,
        ),
        FieldSpec(
            "consent_medical_data",
            "Autorizo al Colegio Interlaken a tratar los datos de salud del alumno "
            "conforme al Aviso de Privacidad.",
            type="boolean",
            required=True,
            message="Para enviar los datos de salud necesitamos su autorización.",
        ),
    ),
    description="Datos sensibles: se guardan cifrados y solo los consulta la dirección.",
)


def _guardian(key: str, title: str) -> SectionSpec:
    return SectionSpec(
        key,
        title,
        (
            FieldSpec(
                "not_applicable",
                "No aplica",
                type="boolean",
                help="Márquelo si este bloque no aplica a su familia.",
            ),
            FieldSpec("is_legal_guardian", "Es tutor/a legal", type="boolean"),
            FieldSpec("paternal_surname", "Apellido paterno", required=True, max_length=100),
            FieldSpec("maternal_surname", "Apellido materno", max_length=100),
            FieldSpec("given_names", "Nombre(s)", required=True, max_length=100),
            FieldSpec("sex", "Sexo", type="select", choices="sexo", required=True),
            FieldSpec("dob", "Fecha de nacimiento", type="date", required=True),
            FieldSpec(
                "birth_country", "País de nacimiento", type="country", max_length=60, default=MEXICO
            ),
            FieldSpec(
                "birth_state",
                "Estado de nacimiento",
                type="state",
                choices="estados",
                choices_if=GUARDIAN_BORN_IN_MEXICO,
                max_length=60,
            ),
            FieldSpec(
                "curp",
                "CURP",
                type="curp",
                required_if=GUARDIAN_BORN_IN_MEXICO,
                help="Obligatoria si nació en México.",
            ),
            FieldSpec(
                "marital_status",
                "Estado civil",
                type="select",
                choices="estado_civil",
                required=True,
            ),
            FieldSpec(
                "education_level",
                "Grado académico",
                type="select",
                choices="grado_academico",
                required=True,
            ),
            FieldSpec("occupation", "Ocupación", type="select", choices="ocupacion", required=True),
            FieldSpec(
                "occupation_other",
                "¿Cuál ocupación?",
                max_length=100,
                required_if={"field": "occupation", "equals": OCCUPATION_OTHER},
            ),
            FieldSpec("mobile", "Celular", type="phone", required=True, help="10 dígitos."),
            FieldSpec("office_phone", "Teléfono de oficina", type="phone"),
            FieldSpec("office_ext", "Extensión", type="extension"),
            FieldSpec("email", "Correo electrónico", type="email", required=True, max_length=254),
        ),
        target="guardian",
        skip_if={"field": "not_applicable", "equals": True},
    )


PADRE = _guardian("padre", "Datos del padre")
MADRE = _guardian("madre", "Datos de la madre")

EMERGENCIA = SectionSpec(
    "emergencia",
    "Contacto de emergencia",
    (
        FieldSpec("emergency_surnames", "Apellido(s)", required=True, max_length=150),
        FieldSpec("emergency_given_names", "Nombre(s)", required=True, max_length=100),
        FieldSpec("emergency_rel", "Parentesco", max_length=50),
        FieldSpec("emergency_phone", "Teléfono", type="phone"),
        FieldSpec("emergency_mobile", "Celular", type="phone"),
    ),
    rules=(
        {
            "rule": "at_least_one",
            "fields": ["emergency_phone", "emergency_mobile"],
            "message": "Escriba al menos un teléfono del contacto de emergencia.",
        },
    ),
    description="Alguien distinto de los padres a quien llamar si no les localizamos.",
)

CONTACTO = SectionSpec("contacto", "Quién llena la ficha", CONTACT_FIELDS)

# Step 0 «Antes de empezar»: the body of the public POST /register/.
INICIO = SectionSpec(
    "inicio",
    "Antes de empezar",
    CONTACT_FIELDS
    + (
        replace(ALUMNO.field("child_given_names"), label="Nombre(s) del alumno"),
        replace(ALUMNO.field("child_paternal_surname"), label="Apellido paterno del alumno"),
        replace(
            ALUMNO.field("child_maternal_surname"),
            label="Apellido materno del alumno",
            required_if=None,
        ),
        ALUMNO.field("grade_applying"),
        replace(ALUMNO.field("cycle"), help="El ciclo en curso o el próximo."),
        FieldSpec(
            "referral_source", "¿Cómo nos conoció?", type="select", choices="como_nos_conocio"
        ),
        FieldSpec("wants_visit", "¿Desea agendar una visita al colegio?", type="boolean"),
        FieldSpec("message", "Comentarios", type="textarea", max_length=2000),
    ),
    target="start",
    description="Con estos datos guardamos su ficha y le enviamos un enlace para continuarla.",
)

# Step 7: the body of POST /register/<id>/submit/.
FIRMA = SectionSpec(
    "firma",
    "Aviso de privacidad y firma",
    (
        FieldSpec(
            "accept_privacy",
            "He leído y acepto el Aviso de Privacidad.",
            type="boolean",
            required=True,
            message="Debe aceptar el Aviso de Privacidad para enviar la ficha.",
        ),
        FieldSpec(
            "consent_photos_media",
            "Autorizo el uso de fotografías y videos del alumno en los medios del colegio.",
            type="boolean",
        ),
        FieldSpec(
            "signed_name",
            "Nombre completo de quien firma",
            required=True,
            max_length=200,
            help="Escriba su nombre y apellidos: equivale a su firma.",
            message="Escriba su nombre completo (nombre y apellidos) como firma.",
        ),
    ),
    target="submit",
)

# Order of the steps in the form.
SECTIONS: dict[str, SectionSpec] = {
    s.key: s for s in (INICIO, CONTACTO, ALUMNO, DOMICILIO, SALUD, PADRE, MADRE, EMERGENCIA, FIRMA)
}
PATCH_SECTIONS: tuple[str, ...] = tuple(k for k, s in SECTIONS.items() if s.patchable)
GUARDIAN_SECTIONS: tuple[str, ...] = ("padre", "madre")

GLOBAL_RULES: tuple[dict, ...] = (
    {
        "rule": "at_least_one_applies",
        "sections": list(GUARDIAN_SECTIONS),
        "field": "not_applicable",
        "message": "Escriba los datos de al menos el padre o la madre (o de quien tenga la tutela).",
    },
)

# Every encrypted health field of the Registration (consent gate, masking).
REGISTRATION_MEDICAL_FIELDS: tuple[str, ...] = (
    "blood_type",
    "allergies",
    "medical_notes",
    "estatura",
    "peso",
    "has_allergies",
    "chronic_conditions",
)


# ── required rules ───────────────────────────────────────────────────────
def section_missing(section: SectionSpec, values: dict) -> dict[str, str]:
    """``{field: message}`` for what ``section`` still needs (format aside)."""
    if section.skip_if and condition_met(section.skip_if, values):
        return {}
    missing = {}
    for f in section.fields:
        if f.is_required(values) and is_blank(values.get(f.name)):
            missing[f.name] = f.message or REQUIRED_MSG
    for rule in section.rules:
        if rule["rule"] == "at_least_one" and all(is_blank(values.get(n)) for n in rule["fields"]):
            missing.setdefault(rule["fields"][0], rule["message"])
    return missing


def global_missing(values_by_section: dict[str, dict]) -> dict[str, dict[str, str]]:
    out: dict[str, dict[str, str]] = {}
    for rule in GLOBAL_RULES:
        if rule["rule"] == "at_least_one_applies":
            keys = rule["sections"]
            if all(values_by_section.get(k, {}).get(rule["field"]) is True for k in keys):
                for k in keys:
                    out.setdefault(k, {})[rule["field"]] = rule["message"]
    return out


def missing_by_section(values_by_section: dict[str, dict]) -> dict[str, dict[str, str]]:
    """Every patchable section → ``{field: message}`` (empty dict when complete)."""
    out = {k: section_missing(SECTIONS[k], values_by_section.get(k, {})) for k in PATCH_SECTIONS}
    for key, extra in global_missing(values_by_section).items():
        for name, msg in extra.items():
            out[key].setdefault(name, msg)
    return out


def completeness(values_by_section: dict[str, dict]) -> dict:
    """``{'sections': {key: {'complete', 'missing': [...]}}, 'complete': bool}``."""
    missing = missing_by_section(values_by_section)
    sections = {k: {"complete": not m, "missing": list(m)} for k, m in missing.items()}
    return {"sections": sections, "complete": all(s["complete"] for s in sections.values())}


def required_errors(values_by_section: dict[str, dict]) -> dict[str, dict[str, list[str]]]:
    """Only the sections with something missing, DRF-style ``{field: [message]}``."""
    return {
        k: {name: [msg] for name, msg in m.items()}
        for k, m in missing_by_section(values_by_section).items()
        if m
    }


# ── public schema ────────────────────────────────────────────────────────
def schema_json(today: date | None = None, *, public_start_enabled: bool = True) -> dict:
    return {
        "version": 2,
        "public_start_enabled": public_start_enabled,
        "steps": [s.to_json() for s in SECTIONS.values()],
        "patch_sections": list(PATCH_SECTIONS),
        "rules": list(GLOBAL_RULES),
        "choices": {**STATIC_CHOICES, "ciclo": cycle_choices(today)},
        "medical_fields": list(REGISTRATION_MEDICAL_FIELDS),
    }
