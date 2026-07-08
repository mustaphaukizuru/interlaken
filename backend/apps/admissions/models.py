"""
admissions/models.py — Pre-registration, Registration, Open School Day
"""
from uuid import uuid4

from django.db import models
from django.utils import timezone


class PreRegistration(models.Model):
    """Public pre-registration form — no login required."""

    class Status(models.TextChoices):
        PENDING   = 'pending',   'Pendiente'
        CONTACTED = 'contacted', 'Contactado'
        ENROLLED  = 'enrolled',  'Inscrito'
        REJECTED  = 'rejected',  'No Procedió'

    class Level(models.TextChoices):
        PRESCHOOL   = 'preescolar', 'Preescolar'
        PRIMARY     = 'primaria',   'Primaria'
        SECONDARY   = 'secundaria', 'Secundaria'

    # Child info
    child_first_name = models.CharField(max_length=100, verbose_name='Nombre del alumno')
    child_last_name  = models.CharField(max_length=100, verbose_name='Apellidos del alumno')
    child_dob        = models.DateField(verbose_name='Fecha de nacimiento')
    level            = models.CharField(max_length=20, choices=Level.choices, verbose_name='Nivel educativo')
    grade_applying   = models.CharField(max_length=30, verbose_name='Grado a solicitar')
    cycle            = models.CharField(max_length=20, default='2025-2026', verbose_name='Ciclo escolar')

    # Parent/guardian contact
    parent_name  = models.CharField(max_length=200, verbose_name='Nombre del padre/tutor')
    parent_email = models.EmailField(verbose_name='Correo electrónico')
    parent_phone = models.CharField(max_length=20, verbose_name='Teléfono / WhatsApp')
    relationship = models.CharField(max_length=50, default='Padre/Madre', verbose_name='Parentesco')

    # How did they find us?
    referral_source = models.CharField(max_length=100, blank=True, verbose_name='¿Cómo nos conoció?')
    message         = models.TextField(blank=True, verbose_name='Comentarios adicionales')

    # Status
    status     = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)
    notes      = models.TextField(blank=True, verbose_name='Notas internas')

    class Meta:
        verbose_name = 'Pre-registro'
        verbose_name_plural = 'Pre-registros'
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.child_first_name} {self.child_last_name} — {self.level} ({self.status})'


def document_upload_path(instance, filename):
    return f'admissions/{instance.registration.id}/{filename}'


class Registration(models.Model):
    """Full enrollment registration with document uploads."""

    class Status(models.TextChoices):
        DRAFT      = 'draft',      'Borrador'
        SUBMITTED  = 'submitted',  'Enviado'
        REVIEWING  = 'reviewing',  'En Revisión'
        APPROVED   = 'approved',   'Aprobado'
        REJECTED   = 'rejected',   'Rechazado'
        COMPLETE   = 'complete',   'Inscripción Completa'

    # Internal opaque id (no longer a secret capability — see the hashed tokens
    # below). Kept for stable admin/reference URLs.
    access_token = models.UUIDField(default=uuid4, editable=False, unique=True)

    # ── Access tokens (IK-SEC A2) ─────────────────────────────────────────────
    # Only SHA-256 hashes are stored. The one-time INVITE token is returned once
    # at creation and exchanged (POST) for a short-lived SESSION token that gates
    # subsequent steps. Tokens never appear in a URL. See admissions/tokens.py.
    invite_token_hash  = models.CharField(max_length=64, blank=True, default='')
    invite_expires_at  = models.DateTimeField(null=True, blank=True)
    invite_used_at     = models.DateTimeField(null=True, blank=True)
    session_token_hash = models.CharField(max_length=64, blank=True, default='')
    session_expires_at = models.DateTimeField(null=True, blank=True)

    # Link to pre-registration if available
    pre_registration = models.ForeignKey(PreRegistration, null=True, blank=True,
                                         on_delete=models.SET_NULL, related_name='registrations')

    # Student info
    child_first_name = models.CharField(max_length=100)
    child_last_name  = models.CharField(max_length=100)
    child_dob        = models.DateField()
    child_curp       = models.CharField(max_length=20, blank=True, verbose_name='CURP')
    child_nationality= models.CharField(max_length=50, default='Mexicana')
    level            = models.CharField(max_length=20)
    grade_applying   = models.CharField(max_length=30)
    cycle            = models.CharField(max_length=20, default='2025-2026')

    # Parent 1
    parent1_name     = models.CharField(max_length=200)
    parent1_email    = models.EmailField()
    parent1_phone    = models.CharField(max_length=20)
    parent1_occupation = models.CharField(max_length=100, blank=True)

    # Parent 2 (optional)
    parent2_name     = models.CharField(max_length=200, blank=True)
    parent2_email    = models.EmailField(blank=True)
    parent2_phone    = models.CharField(max_length=20, blank=True)

    # Emergency contact
    emergency_name   = models.CharField(max_length=200, blank=True)
    emergency_phone  = models.CharField(max_length=20, blank=True)
    emergency_rel    = models.CharField(max_length=50, blank=True)

    # Medical
    blood_type       = models.CharField(max_length=5, blank=True)
    allergies        = models.TextField(blank=True)
    medical_notes    = models.TextField(blank=True)

    # Status
    status       = models.CharField(max_length=20, choices=Status.choices, default=Status.DRAFT)
    submitted_at = models.DateTimeField(null=True, blank=True)
    created_at   = models.DateTimeField(default=timezone.now)
    updated_at   = models.DateTimeField(auto_now=True)
    admin_notes  = models.TextField(blank=True)

    class Meta:
        verbose_name = 'Inscripción'
        verbose_name_plural = 'Inscripciones'
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.child_first_name} {self.child_last_name} — {self.grade_applying} ({self.status})'

    def submit(self):
        self.status = self.Status.SUBMITTED
        self.submitted_at = timezone.now()
        self.save()


class RegistrationDocument(models.Model):
    """Documents uploaded as part of a registration."""

    class DocType(models.TextChoices):
        BIRTH_CERT   = 'birth_cert',   'Acta de Nacimiento'
        CURP_DOC     = 'curp_doc',     'CURP'
        PHOTO        = 'photo',        'Fotografía'
        REPORT_CARD  = 'report_card',  'Boleta Anterior'
        PROOF_ADDR   = 'proof_addr',   'Comprobante de Domicilio'
        VACCINATION  = 'vaccination',  'Cartilla de Vacunación'
        OTHER        = 'other',        'Otro Documento'

    registration = models.ForeignKey(Registration, on_delete=models.CASCADE, related_name='documents')
    doc_type     = models.CharField(max_length=30, choices=DocType.choices)
    file         = models.FileField(upload_to=document_upload_path)
    filename     = models.CharField(max_length=255)
    file_size    = models.PositiveIntegerField(default=0)  # bytes
    uploaded_at  = models.DateTimeField(default=timezone.now)
    is_verified  = models.BooleanField(default=False)

    class Meta:
        verbose_name = 'Documento'
        verbose_name_plural = 'Documentos'

    def __str__(self):
        return f'{self.get_doc_type_display()} — {self.registration}'


class OpenSchoolDay(models.Model):
    """Open school day / campus visit sign-up form."""

    class Status(models.TextChoices):
        CONFIRMED = 'confirmed', 'Confirmado'
        CANCELLED = 'cancelled', 'Cancelado'
        ATTENDED  = 'attended',  'Asistió'

    event_date   = models.DateField(verbose_name='Fecha del evento')
    event_time   = models.CharField(max_length=20, verbose_name='Horario')
    event_name   = models.CharField(max_length=200, default='Puertas Abiertas', verbose_name='Nombre del evento')
    max_capacity = models.PositiveIntegerField(default=30)

    # Attendee info
    parent_name  = models.CharField(max_length=200)
    parent_email = models.EmailField()
    parent_phone = models.CharField(max_length=20)
    child_name   = models.CharField(max_length=200, blank=True)
    child_age    = models.PositiveSmallIntegerField(null=True, blank=True)
    level_interest = models.CharField(max_length=30, blank=True)
    message      = models.TextField(blank=True)

    status     = models.CharField(max_length=20, choices=Status.choices, default=Status.CONFIRMED)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        verbose_name = 'Puertas Abiertas'
        verbose_name_plural = 'Puertas Abiertas'
        ordering = ['event_date', 'event_time']

    def __str__(self):
        return f'{self.parent_name} — {self.event_date} {self.event_time}'

    @property
    def spots_remaining(self):
        confirmed = OpenSchoolDay.objects.filter(
            event_date=self.event_date,
            event_time=self.event_time,
            status=self.Status.CONFIRMED
        ).count()
        return max(0, self.max_capacity - confirmed)
