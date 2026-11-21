"""
admissions/process_serializers.py — input validation and output shapes of the
Expediente API (``process_views``). Messages are es-MX, usted form.
"""

from __future__ import annotations

from decimal import Decimal

from rest_framework import serializers

from apps.core.audit import redacted_changes

from . import cycles, process
from .ficha_schema import GRADE_LEVEL, level_label, normalize_grade
from .models import AdmissionDiscount, EnrollmentPayment, PreRegistration
from .validators import FichaValueError, normalize_phone

MSG_REASON = "Indique el motivo."


# ── fields ────────────────────────────────────────────────────────────────
def clean_text(value) -> str:
    return " ".join(str(value or "").split())


def split_child_name(name: str) -> tuple[str, str]:
    parts = clean_text(name).split()
    if not parts:
        return "", ""
    return parts[0][:100], " ".join(parts[1:])[:100]


class PhoneField(serializers.CharField):
    def to_internal_value(self, data):
        value = super().to_internal_value(data)
        try:
            return normalize_phone(value)
        except FichaValueError as exc:
            raise serializers.ValidationError(str(exc)) from None


class GradeField(serializers.CharField):
    def to_internal_value(self, data):
        value = normalize_grade(super().to_internal_value(data))
        if value not in GRADE_LEVEL:
            raise serializers.ValidationError("Elija un grado de la lista.")
        return value


class CycleChoiceField(serializers.CharField):
    """``actual`` / ``proximo`` (the ficha's keys) or a well-formed «AAAA-AAAA»."""

    def to_internal_value(self, data):
        value = super().to_internal_value(data).strip()
        cycle = cycles.cycle_for_choice(value)
        if cycle:
            return cycle
        if cycles.parse_cycle(value) is None:
            raise serializers.ValidationError("Elija el ciclo actual o el próximo.")
        return value


def _reason_required(attrs, closing: bool, field: str = "reason"):
    if closing and not clean_text(attrs.get(field)):
        raise serializers.ValidationError({field: [MSG_REASON]})


# ── «Nuevo prospecto» (the 7 Informes fields) ─────────────────────────────
class ProspectSerializer(serializers.Serializer):
    child_name = serializers.CharField(max_length=200)
    parent_name = serializers.CharField(max_length=200)
    parent_phone = PhoneField(max_length=20)
    previous_school = serializers.CharField(
        max_length=200, required=False, allow_blank=True, default=""
    )
    child_age = serializers.IntegerField(
        min_value=0, max_value=25, required=False, allow_null=True, default=None
    )
    grade_applying = GradeField(max_length=30)
    cycle = CycleChoiceField(max_length=20)
    # Optional extras.
    parent_email = serializers.EmailField(required=False, allow_blank=True, default="")
    relationship = serializers.CharField(
        max_length=50, required=False, allow_blank=True, default=""
    )
    referral_source = serializers.CharField(
        max_length=100, required=False, allow_blank=True, default=""
    )
    notes = serializers.CharField(required=False, allow_blank=True, default="")

    def validate_child_name(self, value):
        first, _last = split_child_name(value)
        if not first:
            raise serializers.ValidationError("Escriba el nombre del alumno.")
        return clean_text(value)

    def create(self, validated):
        first, last = split_child_name(validated["child_name"])
        grade = validated["grade_applying"]
        return PreRegistration.objects.create(
            child_first_name=first,
            child_last_name=last,
            level=GRADE_LEVEL[grade],
            grade_applying=grade,
            cycle=validated["cycle"],
            parent_name=clean_text(validated["parent_name"]),
            parent_email=validated.get("parent_email") or "",
            parent_phone=validated["parent_phone"],
            relationship=clean_text(validated.get("relationship")) or "Padre/Madre",
            referral_source=validated.get("referral_source") or "WhatsApp",
            previous_school=clean_text(validated.get("previous_school")),
            child_age=validated.get("child_age"),
            notes=validated.get("notes") or "",
            stage=PreRegistration.Stage.INFORMES,
            status=PreRegistration.Status.PENDING,
        )


# ── stage cards ───────────────────────────────────────────────────────────
class InformesSerializer(serializers.Serializer):
    child_name = serializers.CharField(max_length=200, required=False)
    parent_name = serializers.CharField(max_length=200, required=False)
    parent_email = serializers.EmailField(required=False, allow_blank=True)
    parent_phone = PhoneField(max_length=20, required=False)
    relationship = serializers.CharField(max_length=50, required=False, allow_blank=True)
    previous_school = serializers.CharField(max_length=200, required=False, allow_blank=True)
    child_age = serializers.IntegerField(min_value=0, max_value=25, required=False, allow_null=True)
    grade_applying = GradeField(max_length=30, required=False)
    cycle = CycleChoiceField(max_length=20, required=False)
    referral_source = serializers.CharField(max_length=100, required=False, allow_blank=True)
    notes = serializers.CharField(required=False, allow_blank=True)
    costs_sent_at = serializers.DateTimeField(required=False, allow_null=True)
    visit_link_sent_at = serializers.DateTimeField(required=False, allow_null=True)
    outcome = serializers.ChoiceField(
        choices=PreRegistration.InformesOutcome.choices, required=False, allow_blank=True
    )
    reason = serializers.CharField(max_length=500, required=False, allow_blank=True, default="")

    def validate(self, attrs):
        _reason_required(attrs, attrs.get("outcome") == PreRegistration.InformesOutcome.NO_INTERESA)
        if "child_name" in attrs:
            first, last = split_child_name(attrs.pop("child_name"))
            if not first:
                raise serializers.ValidationError({"child_name": ["Escriba el nombre del alumno."]})
            attrs["child_first_name"], attrs["child_last_name"] = first, last
        if "grade_applying" in attrs:
            attrs["level"] = GRADE_LEVEL[attrs["grade_applying"]]
        for name in ("parent_name", "relationship", "previous_school"):
            if name in attrs:
                attrs[name] = clean_text(attrs[name])
        if attrs.get("parent_name") == "":
            raise serializers.ValidationError({"parent_name": ["Escriba el nombre del tutor."]})
        return attrs


class VisitaSerializer(serializers.Serializer):
    booking = serializers.IntegerField(required=False, allow_null=True)
    outcome = serializers.ChoiceField(
        choices=PreRegistration.VisitOutcome.choices, required=False, allow_blank=True
    )
    reschedule = serializers.BooleanField(required=False, default=False)
    reason = serializers.CharField(max_length=500, required=False, allow_blank=True, default="")
    note = serializers.CharField(max_length=500, required=False, allow_blank=True)

    def validate_booking(self, value):
        from apps.bookings.models import Booking

        if value is None:
            return None
        booking = Booking.objects.select_related("slot").filter(pk=value).first()
        if booking is None:
            raise serializers.ValidationError("No existe esa visita.")
        return booking

    def validate(self, attrs):
        V = PreRegistration.VisitOutcome
        outcome = attrs.get("outcome")
        _reason_required(
            attrs,
            outcome == V.NO_INTERESA or (outcome == V.NO_ASISTIO and not attrs.get("reschedule")),
        )
        booking = attrs.get("booking")
        lead = self.context.get("lead")
        if (
            booking is not None
            and lead is not None
            and booking.pre_registration_id not in (None, lead.pk)
        ):
            raise serializers.ValidationError(
                {"booking": ["Esa visita pertenece a otro expediente."]}
            )
        return attrs


class ExamenSerializer(serializers.Serializer):
    exam_at = serializers.DateTimeField(required=False, allow_null=True)
    exam_notes = serializers.CharField(required=False, allow_blank=True)
    exam_results_at = serializers.DateTimeField(required=False, allow_null=True)
    result = serializers.ChoiceField(
        choices=PreRegistration.ExamResult.choices, required=False, allow_blank=True
    )
    reason = serializers.CharField(max_length=500, required=False, allow_blank=True, default="")

    def validate(self, attrs):
        # «No aceptado» always needs its reason.
        _reason_required(attrs, attrs.get("result") == PreRegistration.ExamResult.NO_ACEPTADO)
        return attrs


class DocumentacionSerializer(serializers.Serializer):
    documents_waived = serializers.BooleanField(required=False)
    documents_waived_reason = serializers.CharField(
        max_length=500, required=False, allow_blank=True, default=""
    )
    agreements_note = serializers.CharField(required=False, allow_blank=True)


STAGE_SERIALIZERS = {
    "informes": InformesSerializer,
    "visita": VisitaSerializer,
    "examen": ExamenSerializer,
    "documentacion": DocumentacionSerializer,
}


class MoveSerializer(serializers.Serializer):
    stage = serializers.ChoiceField(choices=PreRegistration.Stage.choices)
    note = serializers.CharField(max_length=500, required=False, allow_blank=True, default="")


class CloseSerializer(serializers.Serializer):
    outcome = serializers.ChoiceField(
        choices=[(c, PreRegistration.ClosedOutcome(c).label) for c in process.CLOSE_OUTCOMES]
    )
    reason = serializers.CharField(max_length=500)


class ReopenSerializer(serializers.Serializer):
    note = serializers.CharField(max_length=500)
    stage = serializers.ChoiceField(
        choices=[(s, process.stage_label(s)) for s in process.OPEN_STAGES],
        required=False,
        allow_blank=True,
        default="",
    )


class EnrollSerializer(serializers.Serializer):
    student_id = serializers.CharField(max_length=40, required=False, allow_blank=True, default="")
    grade = serializers.CharField(max_length=30, required=False, allow_blank=True, default="")
    group = serializers.CharField(max_length=10, required=False, allow_blank=True, default="")
    override_documents = serializers.BooleanField(required=False, default=False)
    override_reason = serializers.CharField(
        max_length=500, required=False, allow_blank=True, default=""
    )

    def validate(self, attrs):
        _reason_required(attrs, attrs.get("override_documents"), "override_reason")
        return attrs


class ActionSerializer(serializers.Serializer):
    channel = serializers.ChoiceField(
        choices=[("email", "Correo"), ("whatsapp", "WhatsApp")],
        required=False,
        allow_blank=True,
        allow_null=True,
        default=None,
    )
    override = serializers.BooleanField(required=False, default=False)


# ── discounts and payments ────────────────────────────────────────────────
class DiscountSerializer(serializers.ModelSerializer):
    summary = serializers.SerializerMethodField()
    months = serializers.SerializerMethodField()
    kind_label = serializers.CharField(source="get_kind_display", read_only=True)
    duration_label = serializers.CharField(source="get_duration_display", read_only=True)
    created_by = serializers.SerializerMethodField()

    class Meta:
        model = AdmissionDiscount
        fields = [
            "id",
            "kind",
            "kind_label",
            "percent",
            "amount",
            "duration",
            "duration_label",
            "start_month",
            "end_month",
            "authorized_by",
            "note",
            "summary",
            "months",
            "created_by",
            "created_at",
            "updated_at",
            "voided_at",
            "void_reason",
        ]
        read_only_fields = ["id", "created_at", "updated_at", "voided_at", "void_reason"]
        extra_kwargs = {"authorized_by": {"error_messages": {"blank": "Indique quién autorizó."}}}

    def get_summary(self, obj):
        return process.discount_summary(obj)

    def get_months(self, obj):
        return process.months_between(*process.discount_period(obj))

    def get_created_by(self, obj):
        return getattr(obj.created_by, "email", "") if obj.created_by_id else ""

    def validate(self, attrs):
        K, D = AdmissionDiscount.Kind, AdmissionDiscount.Duration
        inst = self.instance

        def value(name):
            return attrs[name] if name in attrs else getattr(inst, name, None)

        percent, amount = value("percent"), value("amount")
        if (percent is None) == (amount is None):
            raise serializers.ValidationError(
                {"percent": ["Indique un porcentaje o un monto fijo (solo uno)."]}
            )
        if percent is not None and not (Decimal("0") < percent <= Decimal("100")):
            raise serializers.ValidationError({"percent": ["El porcentaje va de 0.01 a 100."]})
        if amount is not None and amount <= 0:
            raise serializers.ValidationError({"amount": ["El monto debe ser mayor que cero."]})
        kind, duration = value("kind"), value("duration") or ""
        if kind == K.INSCRIPCION:
            attrs["duration"], attrs["start_month"], attrs["end_month"] = "", None, None
        elif not duration:
            raise serializers.ValidationError(
                {"duration": ["Elija la duración de la beca o el descuento."]}
            )
        start, end = value("start_month"), value("end_month")
        if start:
            attrs["start_month"] = start.replace(day=1)
        if end:
            attrs["end_month"] = end.replace(day=1)
        if kind != K.INSCRIPCION and duration == D.PERSONALIZADO:
            if not start or not end:
                raise serializers.ValidationError(
                    {"start_month": ["Indique el primer y el último mes."]}
                )
            if end < start:
                raise serializers.ValidationError(
                    {"end_month": ["El último mes debe ser después del primero."]}
                )
            if process.months_between(start.replace(day=1), end.replace(day=1)) > 36:
                raise serializers.ValidationError(
                    {"end_month": ["El periodo no puede pasar de 36 meses."]}
                )
        elif kind != K.INSCRIPCION and duration != D.PERSONALIZADO:
            attrs["end_month"] = None
        if "authorized_by" in attrs:
            attrs["authorized_by"] = clean_text(attrs["authorized_by"])
            if not attrs["authorized_by"]:
                raise serializers.ValidationError({"authorized_by": ["Indique quién autorizó."]})
        return attrs


class PaymentSerializer(serializers.ModelSerializer):
    summary = serializers.SerializerMethodField()
    method_label = serializers.CharField(source="get_method_display", read_only=True)
    recorded_by = serializers.SerializerMethodField()

    class Meta:
        model = EnrollmentPayment
        fields = [
            "id",
            "paid_on",
            "amount",
            "method",
            "method_label",
            "reference",
            "note",
            "summary",
            "recorded_by",
            "created_at",
            "updated_at",
            "voided_at",
            "void_reason",
        ]
        read_only_fields = ["id", "created_at", "updated_at", "voided_at", "void_reason"]

    def get_summary(self, obj):
        return process.payment_summary(obj)

    def get_recorded_by(self, obj):
        return getattr(obj.recorded_by, "email", "") if obj.recorded_by_id else ""

    def validate_amount(self, value):
        if value <= 0:
            raise serializers.ValidationError("El monto debe ser mayor que cero.")
        return value

    def validate_paid_on(self, value):
        from django.utils import timezone

        if value > timezone.localdate():
            raise serializers.ValidationError("La fecha de pago no puede ser futura.")
        return value


class VoidSerializer(serializers.Serializer):
    reason = serializers.CharField(max_length=300, required=False, allow_blank=True, default="")


# ── output ────────────────────────────────────────────────────────────────
def _label(choices_cls, value) -> str:
    return choices_cls(value).label if value in choices_cls.values else (value or "")


def case_row(lead) -> dict:
    return {
        "id": lead.pk,
        "child_name": f"{lead.child_first_name} {lead.child_last_name}".strip(),
        "parent_name": lead.parent_name,
        "parent_phone": lead.parent_phone,
        "parent_email": lead.parent_email,
        "level": lead.level,
        "level_label": level_label(lead.level),
        "grade_applying": lead.grade_applying,
        "cycle": lead.cycle,
        "stage": lead.stage,
        "stage_label": process.stage_label(lead.stage),
        "closed_outcome": lead.closed_outcome,
        "closed_outcome_label": lead.get_closed_outcome_display() if lead.closed_outcome else "",
        "status": lead.status,
        "next_action": process.next_action(lead),
        "days_waiting": process.days_waiting(lead),
        "stage_changed_at": lead.stage_changed_at,
        "exam_at": lead.exam_at,
        "created_at": lead.created_at,
        "updated_at": lead.updated_at,
    }


def _booking(b) -> dict:
    return {
        "id": b.pk,
        "date": b.slot.date,
        "start_time": b.slot.start_time.strftime("%H:%M"),
        "end_time": b.slot.end_time.strftime("%H:%M"),
        "visit_type": b.slot.visit_type,
        "visit_type_label": b.slot.get_visit_type_display(),
        "status": b.status,
        "status_label": b.get_status_display(),
        "outcome": b.outcome,
        "outcome_label": b.get_outcome_display() if b.outcome else "",
        "outcome_note": b.outcome_note,
        "num_attendees": b.num_attendees,
        "source": b.source,
        "created_at": b.created_at,
    }


def ficha_summary(lead, reg) -> dict | None:
    if reg is None:
        return None
    from . import ficha
    from .ficha_schema import completeness

    try:
        complete = completeness(ficha.all_values(reg))
    except Exception:  # a legacy record the schema cannot read must not break the case
        complete = None
    student = getattr(reg, "student_profile", None)
    docs = process.documents_state(lead, reg)
    return {
        "id": reg.pk,
        "status": reg.status,
        "status_label": reg.get_status_display(),
        "ficha_version": reg.ficha_version,
        "submitted_at": reg.submitted_at,
        "invite_expires_at": reg.invite_expires_at,
        "invite_used_at": reg.invite_used_at,
        "completeness": complete,
        "documents": docs,
        "student": ({"id": student.pk, "student_id": student.student_id} if student else None),
        "created_at": reg.created_at,
        "updated_at": reg.updated_at,
    }


HISTORY_LABELS = {
    "admissions.preregistration": "Expediente",
    "admissions.registration": "Ficha",
    "admissions.registrationdocument": "Documento",
    "admissions.admissiondiscount": "Beca o descuento",
    "admissions.enrollmentpayment": "Pago de inscripción",
    "bookings.booking": "Visita",
    "accounts.studentprofile": "Alumno",
}
HISTORY_LIMIT = 200


def case_history(lead, regs, bookings, discounts, payments) -> list:
    from django.db.models import Q

    from apps.core.models import AuditLog

    ids = {
        "admissions.preregistration": [str(lead.pk)],
        "admissions.registration": [str(r.pk) for r in regs],
        "admissions.registrationdocument": [str(d.pk) for r in regs for d in r.documents.all()],
        "admissions.admissiondiscount": [str(d.pk) for d in discounts],
        "admissions.enrollmentpayment": [str(p.pk) for p in payments],
        "bookings.booking": [str(b.pk) for b in bookings],
        "accounts.studentprofile": [
            str(r.student_profile.pk)
            for r in regs
            if getattr(r, "student_profile", None) is not None
        ],
    }
    q = Q()
    for object_type, values in ids.items():
        if values:
            q |= Q(object_type=object_type, object_id__in=values)
    rows = (
        AuditLog.objects.filter(q)
        .select_related("actor")
        .order_by("-created_at", "-pk")[:HISTORY_LIMIT]
    )
    return [
        {
            "id": e.pk,
            "at": e.created_at,
            "actor": e.actor_label,
            "action": e.action,
            "object_type": e.object_type,
            "object_label": HISTORY_LABELS.get(e.object_type, e.object_type),
            "object_id": e.object_id,
            "changes": redacted_changes(e),
            "context": e.context,
        }
        for e in rows
    ]


def case_detail(lead, *, user=None) -> dict:
    reg = process.case_registration(lead)
    regs = list(lead.registrations.all())
    bookings = sorted(lead.bookings.all(), key=lambda b: (b.created_at, b.pk), reverse=True)
    discounts = list(lead.discounts.all())
    payments = list(lead.enrollment_payments.all())
    gate = process.ficha_link_gate(lead)
    return {
        **case_row(lead),
        "lead": {
            "child_first_name": lead.child_first_name,
            "child_last_name": lead.child_last_name,
            "child_dob": lead.child_dob,
            "child_age": lead.child_age,
            "previous_school": lead.previous_school,
            "relationship": lead.relationship,
            "referral_source": lead.referral_source,
            "message": lead.message,
            "wants_visit": lead.wants_visit,
            "notes": lead.notes,
        },
        "closed": (
            {
                "outcome": lead.closed_outcome,
                "outcome_label": lead.get_closed_outcome_display() if lead.closed_outcome else "",
                "reason": lead.closed_reason,
                "from_stage": lead.closed_from_stage,
                "at": lead.closed_at,
            }
            if lead.stage == PreRegistration.Stage.CERRADO
            else None
        ),
        "informes": {
            "costs_sent_at": lead.costs_sent_at,
            "visit_link_sent_at": lead.visit_link_sent_at,
            "outcome": lead.informes_outcome,
            "outcome_label": _label(PreRegistration.InformesOutcome, lead.informes_outcome),
        },
        "visita": {
            "outcome": lead.visit_outcome,
            "outcome_label": _label(PreRegistration.VisitOutcome, lead.visit_outcome),
            "outcome_at": lead.visit_outcome_at,
            "note": lead.visit_note,
            "bookings": [_booking(b) for b in bookings],
        },
        "examen": {
            "exam_at": lead.exam_at,
            "exam_notes": lead.exam_notes,
            "exam_results_at": lead.exam_results_at,
            "result": lead.exam_result,
            "result_label": _label(PreRegistration.ExamResult, lead.exam_result),
            "reason": lead.exam_result_reason,
            "date_sent_at": lead.exam_date_sent_at,
            "result_sent_at": lead.exam_result_sent_at,
        },
        "documentacion": {
            "documents_waived": lead.documents_waived,
            "documents_waived_reason": lead.documents_waived_reason,
            "documents_waived_at": lead.documents_waived_at,
            "agreements_note": lead.agreements_note,
            "discounts": DiscountSerializer(
                [d for d in discounts if d.voided_at is None], many=True
            ).data,
        },
        "inscrito": {
            "enrolled_at": lead.enrolled_at,
            "payments": PaymentSerializer(
                [p for p in payments if p.voided_at is None], many=True
            ).data,
            "gates": process.enroll_gates(lead, reg),
        },
        "ficha": ficha_summary(lead, reg),
        "ficha_link": {
            **gate,
            "sent_at": lead.ficha_link_sent_at,
            "can_override": gate["overridable"] and process.is_admin_role(user),
        },
        "history": case_history(lead, regs, bookings, discounts, payments),
    }
