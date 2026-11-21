"""
admissions/convert.py — registration → StudentProfile + family logins, as a service.

Moved out of ``pipeline.ConvertView`` (Fase 5) so «Marcar como inscrito» in
the Expediente runs exactly the same conversion. ``ConvertView`` keeps its
endpoint and behaviour (only an APPROVED inscripción converts there); the
Expediente also accepts a submitted or in-review ficha, because its own gates
(exam accepted, documents, payment) are the admission decision.

The registration row is locked for the whole conversion, so two concurrent
clicks cannot both create a student (the second one waits and gets
``already``). An existing account whose email matches parent1/2_email is
linked as guardian ONLY when it is a family (parent) account: the emails are
applicant-supplied, and linking a staff, admin or student account would expose
the child's file (medical data included) to it. Those are reported in
``unlinked`` for the admin to resolve by hand.
"""

from __future__ import annotations

import secrets
from dataclasses import dataclass, field

from django.db import IntegrityError, transaction
from django.utils import timezone
from rest_framework import status

from apps.core.audit import record

from .models import Registration

NOT_APPROVED = "Apruebe la solicitud antes de convertirla en alumno."
CONCURRENT = (
    "Otro proceso convirtió este expediente o tomó esa matrícula al mismo "
    "tiempo. Recargue el pipeline y revise antes de reintentar."
)


class ConvertError(Exception):
    """The conversion was refused: ``body`` and ``status_code`` are the API answer."""

    def __init__(self, body: dict, status_code: int = status.HTTP_400_BAD_REQUEST):
        super().__init__(str(body))
        self.body = body
        self.status_code = status_code


@dataclass
class ConvertResult:
    student: object
    student_id: str
    credentials: list = field(default_factory=list)
    unlinked: list = field(default_factory=list)
    already: bool = False

    def as_dict(self) -> dict:
        return {
            "student": self.student.pk,
            "student_id": self.student_id,
            "credentials": self.credentials,
            "unlinked": self.unlinked,
            "already": self.already,
        }


def password() -> str:
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789"
    return "".join(secrets.choice(alphabet) for _ in range(10))


def convert_registration(
    pk,
    actor,
    *,
    student_id="",
    grade="",
    group="",
    allowed_statuses=(Registration.Status.APPROVED,),
    context="admissions: conversión a alumno",
) -> ConvertResult:
    """Idempotent: a registration that already has a student returns it (``already``).

    Raises ``ConvertError`` (400 bad matrícula / not convertible, 409 race).
    Runs in its own transaction (a savepoint inside the caller's).
    """
    from apps.accounts.import_students import STUDENT_EMAIL_DOMAIN
    from apps.accounts.models import ParentProfile, StudentProfile, User
    from apps.core.matricula import normalize_matricula

    # Spelled like every other matrícula input: «ci09932» is stored as «09932».
    student_id_in = normalize_matricula(str(student_id or ""))
    if len(student_id_in) > StudentProfile._meta.get_field("student_id").max_length:
        raise ConvertError({"student_id": ["La matrícula es demasiado larga."]})
    grade_in = str(grade or "").strip()
    group = str(group or "").strip()[:5]
    credentials, unlinked = [], []
    try:
        with transaction.atomic():
            reg = Registration.objects.select_for_update().get(pk=pk)
            existing = StudentProfile.objects.filter(registration=reg).first()
            if existing:
                return ConvertResult(student=existing, student_id=existing.student_id, already=True)
            if reg.status not in allowed_statuses:
                raise ConvertError({"detail": NOT_APPROVED})
            new_id = student_id_in or f"{timezone.localdate().year % 100:02d}{reg.pk:04d}"
            if StudentProfile.objects.filter(student_id=new_id).exists():
                raise ConvertError({"student_id": ["Esa matrícula ya existe."]})
            grade_value = (grade_in or reg.grade_applying).strip()[:20]
            email = f"{new_id.lower()}@{STUDENT_EMAIL_DOMAIN}"
            su = User.objects.create_user(
                email=email,
                password=None,
                first_name=reg.child_first_name,
                last_name=reg.child_last_name,
                role=User.Role.STUDENT,
            )
            su.set_unusable_password()
            su.save(update_fields=["password"])
            sp = StudentProfile.objects.create(
                user=su,
                student_id=new_id,
                grade=grade_value,
                group=group,
                enrollment_date=timezone.localdate(),
                birth_date=reg.child_dob,
                curp=reg.child_curp,
                emergency_name=reg.emergency_name,
                emergency_phone=reg.emergency_phone,
                emergency_rel=reg.emergency_rel,
                blood_type=reg.blood_type,
                allergies=reg.allergies,
                medical_notes=reg.medical_notes,
                registration=reg,
            )
            sp.parents.add(su)
            parents = (
                (reg.parent1_name, reg.parent1_email, reg.parent1_phone),
                (reg.parent2_name, reg.parent2_email, reg.parent2_phone),
            )
            for name, mail, phone in parents:
                mail = (mail or "").strip().lower()
                if not mail:
                    continue
                parent = User.objects.filter(email__iexact=mail).first()
                if parent is not None and (parent.role != User.Role.PARENT or parent.is_superuser):
                    unlinked.append(
                        {
                            "email": mail,
                            "name": name,
                            "reason": f"Ese correo pertenece a una cuenta de «{parent.get_role_display()}», "
                            "no de una familia: no se vinculó. Vincule al tutor manualmente desde "
                            "el expediente del alumno.",
                        }
                    )
                    continue
                created = False
                if parent is None:
                    first, _, last = (name or mail).strip().partition(" ")
                    parent = User.objects.create_user(
                        email=mail,
                        password=None,
                        first_name=first,
                        last_name=last,
                        role=User.Role.PARENT,
                    )
                    pwd = password()
                    parent.set_password(pwd)
                    parent.save(update_fields=["password"])
                    ParentProfile.objects.get_or_create(
                        user=parent, defaults={"phone": phone or ""}
                    )
                    credentials.append({"email": mail, "password": pwd, "name": name})
                    created = True
                sp.parents.add(parent)
                if not created:
                    credentials.append({"email": mail, "password": None, "name": name})
            before = reg.status
            reg.status = Registration.Status.COMPLETE
            reg.save(update_fields=["status", "updated_at"])
            if before != Registration.Status.APPROVED:
                # The Expediente path: the registration skipped the review states.
                record(
                    "update", reg, {"status": [before, reg.status]}, actor=actor, context=context
                )
            record(
                "create",
                sp,
                {
                    "via": "admissions.convert",
                    "registration": reg.pk,
                    "guardians": [c["email"] for c in credentials],
                    "unlinked": [u["email"] for u in unlinked],
                },
                actor=actor,
                context=context,
            )
    except IntegrityError:
        # A concurrent request (or a hand-made account) took the matrícula
        # or the student email between our checks and the insert.
        raise ConvertError({"detail": CONCURRENT}, status.HTTP_409_CONFLICT) from None
    return ConvertResult(student=sp, student_id=new_id, credentials=credentials, unlinked=unlinked)
