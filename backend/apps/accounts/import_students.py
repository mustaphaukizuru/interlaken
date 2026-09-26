"""
accounts/import_students.py — carga masiva de alumnos (Data Ops C4).

    GET  /api/v1/accounts/admin/students/import/template/?fmt=csv|xlsx
    POST /api/v1/accounts/admin/students/import/   multipart ``file`` (.csv/.xlsx)
         dry_run=1 (default) | 0, report=csv|xlsx, valid_only=1

Columns (header names are accent/case/space-insensitive; aliases accepted):
  required: matricula, nombre, apellidos, grado
  optional: grupo, email_alumno, loyverse_id, nombre_padre, email_padre, telefono_padre

Semantics (idempotent: re-importing the same file changes nothing and every
row comes back ``omitir: Sin cambios``):
  * ``matricula`` is normalised first (``ci09932`` and ``09932`` are one key;
    the app stores the digits, see ``apps.core.matricula``), before the in-file
    duplicate check and the roster match.
  * new matrícula → student User (unusable password, synthetic
    ``<matricula>@alumnos.interlaken.edu.mx`` unless ``email_alumno``) +
    StudentProfile + the self-guardian link (school-email family login).
  * known matrícula → nombre / apellidos / grado (and grupo / loyverse_id when
    given) are updated.
  * ``email_padre`` is matched case-insensitively; a new address creates a
    parent account (unusable password), an existing parent is linked. An
    address that belongs to an admin, staff or another student is an error.

Every check the commit makes also runs in the dry run (the old importer only
found the student-email collision at commit time), each written row is
audited with ``context='import:students'`` and one summary row closes the run.
"""

from __future__ import annotations

from apps.core.importing import (
    ImportCol,
    ImportRow,
    ImportSpec,
    ImportTemplateView,
    ImportView,
    parse_email,
)
from apps.core.matricula import normalize_matricula

from .models import StudentProfile, User

STUDENT_EMAIL_DOMAIN = "alumnos.interlaken.edu.mx"
TEMPLATE_URL = "/api/v1/accounts/admin/students/import/template/"


def _split_name(full_name):
    parts = full_name.split()
    if len(parts) == 1:
        return parts[0], ""
    return " ".join(parts[:-1]), parts[-1]


def _max_len(limit: int):
    def check(value, data):
        return f"máximo {limit} caracteres" if value and len(str(value)) > limit else None

    return check


def _parse_matricula(value: str) -> str:
    matricula = normalize_matricula(value)
    if not matricula:
        raise ValueError("vacía después de quitar el prefijo ci")
    return matricula


def synthetic_email(matricula: str) -> str:
    return f"{matricula.lower()}@{STUDENT_EMAIL_DOMAIN}"


COLUMNS = [
    ImportCol(
        "matricula",
        ("matrícula", "student_id", "codigo", "código", "clave"),
        required=True,
        parse=_parse_matricula,
        validators=(_max_len(20),),
        example="09932",
        label="matricula",
    ),
    ImportCol(
        "nombre",
        ("nombres", "first_name"),
        True,
        validators=(_max_len(100),),
        example="Juan Antonio",
    ),
    ImportCol(
        "apellidos",
        ("apellido", "last_name"),
        True,
        validators=(_max_len(100),),
        example="Chávez López",
    ),
    ImportCol("grado", ("grade",), True, validators=(_max_len(20),), example="4° Primaria"),
    ImportCol("grupo", ("group",), validators=(_max_len(5),), example="A"),
    ImportCol(
        "email_alumno",
        ("correo_alumno", "email", "correo"),
        parse=parse_email,
        validators=(_max_len(254),),
        example="",
    ),
    ImportCol("loyverse_id", ("id_loyverse",), validators=(_max_len(100),), example=""),
    ImportCol(
        "nombre_padre",
        ("nombre_tutor", "tutor", "padre"),
        validators=(_max_len(200),),
        example="Laura López",
    ),
    ImportCol(
        "email_padre",
        ("correo_padre", "correo_tutor", "email_tutor"),
        parse=parse_email,
        validators=(_max_len(254),),
        example="laura.lopez@example.com",
    ),
    ImportCol(
        "telefono_padre",
        ("teléfono_padre", "telefono_tutor", "whatsapp", "celular"),
        validators=(_max_len(20),),
        example="5215512345678",
    ),
]


class StudentImport:
    """Per-request lookups with small caches, so a 2,000-row file costs one
    query per distinct matrícula / email instead of three per row."""

    def __init__(self):
        self._students: dict[str, StudentProfile | None] = {}
        self._users: dict[str, User | None] = {}

    # -- lookups ---------------------------------------------------------
    def student(self, matricula: str) -> StudentProfile | None:
        if matricula not in self._students:
            self._students[matricula] = (
                StudentProfile.objects.select_related("user")
                .filter(student_id__iexact=matricula)
                .order_by("pk")
                .first()
            )
        return self._students[matricula]

    def user(self, email: str) -> User | None:
        key = email.lower()
        if key not in self._users:
            self._users[key] = User.objects.filter(email__iexact=key).first()
        return self._users[key]

    # -- spec hooks ------------------------------------------------------
    def validate_row(self, data: dict, row: ImportRow) -> None:
        matricula = data.get("matricula")
        email_padre = data.get("email_padre") or ""
        if (data.get("nombre_padre") or data.get("telefono_padre")) and not email_padre:
            row.error("email_padre es requerido cuando hay datos del padre/tutor.")
        if not matricula or row.action == "error":
            return
        existing = self.student(matricula)
        email_alumno = data.get("email_alumno") or ""
        if existing is None:
            email = email_alumno or synthetic_email(matricula)
            if self.user(email) is not None:
                row.error(f"El correo del alumno ya existe: {email}.")
        elif email_alumno and email_alumno != existing.user.email.lower():
            row.warn("email_alumno se ignora al actualizar un alumno existente.")
        if email_padre:
            parent = self.user(email_padre)
            is_self = existing is not None and parent is not None and parent.pk == existing.user_id
            if parent is None:
                row.warn(f"Se creará la cuenta del tutor {email_padre}.")
            elif parent.role != User.Role.PARENT and not is_self:
                row.error(
                    f"El correo {email_padre} pertenece a una cuenta con rol "
                    f"«{parent.get_role_display()}», no a un padre/tutor."
                )

    def db_match(self, data: dict):
        return self.student(data["matricula"]) if data.get("matricula") else None

    def skip_reason(self, data: dict, existing) -> str | None:
        if existing is None:
            return None
        user = existing.user
        unchanged = (
            user.first_name == data["nombre"]
            and user.last_name == data["apellidos"]
            and existing.grade == data["grado"]
            and (not data.get("grupo") or existing.group == data["grupo"])
            and (not data.get("loyverse_id") or existing.loyverse_id == data["loyverse_id"])
            and existing.parents.filter(pk=user.pk).exists()
        )
        if unchanged and data.get("email_padre"):
            unchanged = existing.parents.filter(email__iexact=data["email_padre"]).exists()
        return "Sin cambios." if unchanged else None

    # -- writes ----------------------------------------------------------
    def create(self, data: dict, actor) -> StudentProfile:
        matricula = data["matricula"]
        email = data.get("email_alumno") or synthetic_email(matricula)
        if User.objects.filter(email__iexact=email).exists():
            raise ValueError(f"El correo del alumno ya existe: {email}.")
        user = User.objects.create_user(
            email=email,
            password=None,
            first_name=data["nombre"],
            last_name=data["apellidos"],
            role=User.Role.STUDENT,
        )
        profile = StudentProfile.objects.create(
            user=user,
            student_id=matricula,
            grade=data["grado"],
            group=data.get("grupo") or "",
            loyverse_id=data.get("loyverse_id") or "",
        )
        # School-email family login: the alumno is its own guardian.
        profile.parents.add(user)
        self._link_parent(profile, data, actor)
        return profile

    def update(self, profile: StudentProfile, data: dict, actor) -> StudentProfile:
        user = profile.user
        user_fields = [
            f
            for f, v in (("first_name", data["nombre"]), ("last_name", data["apellidos"]))
            if getattr(user, f) != v
        ]
        if user_fields:
            user.first_name, user.last_name = data["nombre"], data["apellidos"]
            user.save(update_fields=user_fields)
        fields = []
        if profile.grade != data["grado"]:
            profile.grade = data["grado"]
            fields.append("grade")
        if data.get("grupo") and profile.group != data["grupo"]:
            profile.group = data["grupo"]
            fields.append("group")
        if data.get("loyverse_id") and profile.loyverse_id != data["loyverse_id"]:
            profile.loyverse_id = data["loyverse_id"]
            fields.append("loyverse_id")
        if fields:
            profile.save(update_fields=fields)
        profile.parents.add(user)
        self._link_parent(profile, data, actor)
        return profile

    def _link_parent(self, profile: StudentProfile, data: dict, actor) -> None:
        from apps.core.audit import record

        email = data.get("email_padre") or ""
        if not email:
            return
        parent = User.objects.filter(email__iexact=email).first()
        if parent is None:
            first, last = _split_name(data.get("nombre_padre") or "Padre/Tutor")
            parent = User.objects.create_user(
                email=email,
                password=None,
                first_name=first,
                last_name=last,
                role=User.Role.PARENT,
                whatsapp=data.get("telefono_padre") or "",
            )
            record(
                "create",
                parent,
                {"via": "import:students", "linked_to": profile.student_id},
                actor=actor,
                context="import:students",
            )
        elif parent.role != User.Role.PARENT and parent.pk != profile.user_id:
            raise ValueError(f"El correo {email} no pertenece a un padre/tutor.")
        profile.parents.add(parent)

    def spec(self) -> ImportSpec:
        return ImportSpec(
            entity="students",
            label="Alumnos",
            columns=COLUMNS,
            dedupe_keys=[("matricula",), ("email_alumno",)],
            key_of=lambda d: d.get("matricula") or "",
            db_match=self.db_match,
            validate_row=self.validate_row,
            skip_reason=self.skip_reason,
            create=self.create,
            update=self.update,
        )


class ImportStudentsView(ImportView):
    """POST .../admin/students/import/ — dry run by default; see the module docstring."""

    template_url = TEMPLATE_URL

    def get_spec(self) -> ImportSpec:
        return StudentImport().spec()


class ImportStudentsTemplateView(ImportTemplateView):
    """GET .../admin/students/import/template/?fmt=csv|xlsx"""

    def get_spec(self) -> ImportSpec:
        return StudentImport().spec()
