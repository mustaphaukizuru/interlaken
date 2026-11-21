"""
admissions/models.py — Pre-registration, Registration (the ficha), guardians, documents
"""
from uuid import uuid4

from django.conf import settings
from django.db import models
from django.db.models.functions import Lower
from django.utils import timezone

from apps.core.fields import EncryptedTextField


def current_school_cycle() -> str:
    """Admissions cycle string, e.g. '2026-2027': the cycle the public form
    advertises. Matches the frontend `CURRENT_CYCLE` (current calendar year to
    next), so a record stores exactly the cycle the applicant saw.

    Used as the model default (Data Ops Phase 4): the hard-coded '2025-2026'
    default went stale on 1 January and stamped every new registration with
    last year's cycle."""
    year = timezone.localdate().year
    return f'{year}-{year + 1}'


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
    # Nullable since the ficha (2026-11): its public start (step 0) creates the
    # lead before the family reaches the student's birth date.
    child_dob        = models.DateField(null=True, blank=True, verbose_name='Fecha de nacimiento')
    level            = models.CharField(max_length=20, choices=Level.choices, verbose_name='Nivel educativo')
    grade_applying   = models.CharField(max_length=30, verbose_name='Grado a solicitar')
    cycle            = models.CharField(max_length=20, default=current_school_cycle, verbose_name='Ciclo escolar')

    # Parent/guardian contact
    parent_name  = models.CharField(max_length=200, verbose_name='Nombre del padre/tutor')
    # Blank allowed since the Expediente (Fase 5): «Informes» mostly arrive by
    # WhatsApp, with a phone and no email yet.
    parent_email = models.EmailField(blank=True, verbose_name='Correo electrónico')
    parent_phone = models.CharField(max_length=20, verbose_name='Teléfono / WhatsApp')
    relationship = models.CharField(max_length=50, default='Padre/Madre', verbose_name='Parentesco')

    # How did they find us?
    referral_source = models.CharField(max_length=100, blank=True, verbose_name='¿Cómo nos conoció?')
    message         = models.TextField(blank=True, verbose_name='Comentarios adicionales')
    # BACKLOG P1-G2: the family asked for a school visit from the pre-registro form.
    wants_visit     = models.BooleanField(default=False, verbose_name='Desea agendar visita')

    # Status
    status     = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)
    notes      = models.TextField(blank=True, verbose_name='Notas internas')

    # ── Proceso de admisión, «Expediente» (Fase 5) ─────────────────────────
    # ``stage`` drives the process; the legacy ``status`` is kept in sync both
    # ways for the screens and exports that still read it (admissions.process:
    # STAGE_STATUS / sync_stage_with_status, run from ``save``).
    class Stage(models.TextChoices):
        INFORMES      = 'informes',      'Informes'
        VISITA        = 'visita',        'Visita guiada'
        EXAMEN        = 'examen',        'Examen'
        DOCUMENTACION = 'documentacion', 'Documentación y acuerdos'
        INSCRITO      = 'inscrito',      'Inscrito'
        CERRADO       = 'cerrado',       'Cerrado'

    class ClosedOutcome(models.TextChoices):
        NONE        = '',            'Abierto'
        NO_INTERESA = 'no_interesa', 'No le interesa'
        NO_ASISTIO  = 'no_asistio',  'No asistió'
        NO_ACEPTADO = 'no_aceptado', 'No aceptado'
        # Legacy «No procedió» (status rejected before the Expediente existed).
        NO_PROCEDIO = 'no_procedio', 'No procedió'

    class InformesOutcome(models.TextChoices):
        NONE            = '',                'Sin registrar'
        CONTINUA_VISITA = 'continua_visita', 'Continúa a visita guiada'
        NO_INTERESA     = 'no_interesa',     'No le interesa'

    class VisitOutcome(models.TextChoices):
        NONE          = '',              'Sin registrar'
        AGENDA_EXAMEN = 'agenda_examen', 'Asistió y agenda examen'
        NO_INTERESA   = 'no_interesa',   'Asistió, no le interesa'
        NO_ASISTIO    = 'no_asistio',    'No asistió'

    class ExamResult(models.TextChoices):
        NONE        = '',            'Sin resultado'
        ACEPTADO    = 'aceptado',    'Aceptado'
        NO_ACEPTADO = 'no_aceptado', 'No aceptado'

    previous_school   = models.CharField(max_length=200, blank=True, verbose_name='Colegio de procedencia')
    child_age         = models.PositiveSmallIntegerField(null=True, blank=True, verbose_name='Edad')
    stage             = models.CharField(max_length=20, choices=Stage.choices, default=Stage.INFORMES,
                                         verbose_name='Etapa')
    stage_changed_at  = models.DateTimeField(null=True, blank=True, verbose_name='En la etapa desde')
    closed_outcome    = models.CharField(max_length=20, choices=ClosedOutcome.choices, blank=True, default='',
                                         verbose_name='Motivo de cierre')
    closed_reason     = models.CharField(max_length=500, blank=True, default='', verbose_name='Detalle del cierre')
    closed_from_stage = models.CharField(max_length=20, blank=True, default='', verbose_name='Cerrado en la etapa')
    closed_at         = models.DateTimeField(null=True, blank=True, verbose_name='Cerrado el')
    # 1 Informes
    costs_sent_at      = models.DateTimeField(null=True, blank=True, verbose_name='Cuotas enviadas')
    visit_link_sent_at = models.DateTimeField(null=True, blank=True, verbose_name='Liga de visita enviada')
    informes_outcome   = models.CharField(max_length=20, choices=InformesOutcome.choices, blank=True, default='',
                                          verbose_name='Resultado de informes')
    # 2 Visita guiada
    visit_outcome    = models.CharField(max_length=20, choices=VisitOutcome.choices, blank=True, default='',
                                        verbose_name='Resultado de la visita')
    visit_outcome_at = models.DateTimeField(null=True, blank=True)
    visit_note       = models.CharField(max_length=500, blank=True, default='', verbose_name='Nota de la visita')
    # 3 Examen
    exam_at             = models.DateTimeField(null=True, blank=True, verbose_name='Examen')
    exam_notes          = models.TextField(blank=True, default='', verbose_name='Notas del examen')
    exam_results_at     = models.DateTimeField(null=True, blank=True, verbose_name='Entrega de resultados')
    exam_result         = models.CharField(max_length=20, choices=ExamResult.choices, blank=True, default='',
                                           verbose_name='Resultado del examen')
    exam_result_reason  = models.CharField(max_length=500, blank=True, default='',
                                           verbose_name='Motivo del resultado')
    exam_date_sent_at   = models.DateTimeField(null=True, blank=True)
    exam_result_sent_at = models.DateTimeField(null=True, blank=True)
    ficha_link_sent_at  = models.DateTimeField(null=True, blank=True, verbose_name='Liga de ficha enviada')
    # 4 Documentación y acuerdos (discounts: AdmissionDiscount)
    documents_waived        = models.BooleanField(default=False, verbose_name='Documentos dispensados')
    documents_waived_reason = models.CharField(max_length=500, blank=True, default='')
    documents_waived_at     = models.DateTimeField(null=True, blank=True)
    agreements_note         = models.TextField(blank=True, default='', verbose_name='Acuerdos')
    # 5 Inscrito (payments: EnrollmentPayment)
    enrolled_at = models.DateTimeField(null=True, blank=True, verbose_name='Inscrito el')

    class Meta:
        verbose_name = 'Pre-registro'
        verbose_name_plural = 'Pre-registros'
        ordering = ['-created_at']
        indexes = [
            # Console list filtered by status, newest first (Data Ops Phase 1).
            models.Index(fields=['status', '-created_at'], name='adm_prereg_status_created'),
            # Case-insensitive dedupe key for the fair-sheet importer.
            models.Index(Lower('parent_email'), name='adm_prereg_email_lower'),
            # Expediente: cases by stage, and the exams week view.
            models.Index(fields=['stage', '-created_at'], name='adm_prereg_stage_created'),
            models.Index(fields=['exam_at'], name='adm_prereg_exam_at'),
        ]

    def __str__(self):
        return f'{self.child_first_name} {self.child_last_name} — {self.level} ({self.status})'

    def save(self, *args, **kwargs):
        # A legacy ``status`` write (console, bulk, invite, imports) moves the
        # stage with it; the Expediente writes both consistently.
        from .process import sync_stage_with_status

        touched = sync_stage_with_status(self)
        if touched and kwargs.get('update_fields') is not None:
            kwargs['update_fields'] = list(dict.fromkeys([*kwargs['update_fields'], *touched]))
        super().save(*args, **kwargs)


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

    class FichaVersion(models.IntegerChoices):
        LEGACY = 1, 'Formulario anterior'
        FICHA  = 2, 'Ficha de inscripción'

    # Which form fills this record. 1 = the old /inscripcion wizard (lax submit,
    # kept until Fase 2 replaces it); 2 = the ficha (step 0 start or any save
    # through the /ficha/ endpoints): submit runs the full required rules.
    ficha_version = models.PositiveSmallIntegerField(
        choices=FichaVersion.choices, default=FichaVersion.LEGACY, verbose_name='Versión del formulario')

    # ── Antes de empezar (step 0): who fills the ficha in ──────────────────
    # parent1_* is derived from this contact (admissions.guardians).
    contact_name         = models.CharField(max_length=200, blank=True, verbose_name='Nombre de quien llena la ficha')
    contact_email        = models.EmailField(blank=True, verbose_name='Correo de quien llena la ficha')
    contact_phone        = models.CharField(max_length=20, blank=True, verbose_name='Celular de quien llena la ficha')
    contact_relationship = models.CharField(max_length=50, blank=True, verbose_name='Parentesco con el alumno')

    # Student info. child_first_name / child_last_name are kept in sync from the
    # ficha's given names and surnames (lists, emails, dedupe, exports, convert).
    child_first_name = models.CharField(max_length=100)
    child_last_name  = models.CharField(max_length=100)
    child_given_names      = models.CharField(max_length=100, blank=True, verbose_name='Nombre(s)')
    child_paternal_surname = models.CharField(max_length=100, blank=True, verbose_name='Apellido paterno')
    child_maternal_surname = models.CharField(max_length=100, blank=True, verbose_name='Apellido materno')
    # Nullable since the ficha: the public start comes before the birth date.
    child_dob        = models.DateField(null=True, blank=True, verbose_name='Fecha de nacimiento')
    child_sex        = models.CharField(max_length=10, blank=True, verbose_name='Sexo')
    child_birth_country = models.CharField(max_length=60, blank=True, verbose_name='País de nacimiento')
    child_birth_state   = models.CharField(max_length=60, blank=True, verbose_name='Estado de nacimiento')
    child_curp       = models.CharField(max_length=20, blank=True, verbose_name='CURP')
    child_nationality= models.CharField(max_length=50, default='Mexicana')
    previous_school  = models.CharField(max_length=200, blank=True, verbose_name='Escuela anterior')
    level            = models.CharField(max_length=20)
    grade_applying   = models.CharField(max_length=30)
    cycle            = models.CharField(max_length=20, default=current_school_cycle)

    # ── Domicilio ─────────────────────────────────────────────────────────
    address_street          = models.CharField(max_length=150, blank=True, verbose_name='Calle')
    address_ext_number      = models.CharField(max_length=20, blank=True, verbose_name='Núm. exterior')
    address_int_number      = models.CharField(max_length=20, blank=True, verbose_name='Núm. interior')
    address_between_streets = models.CharField(max_length=200, blank=True, verbose_name='Entre calles')
    address_state           = models.CharField(max_length=60, blank=True, verbose_name='Estado')
    address_municipality    = models.CharField(max_length=100, blank=True, verbose_name='Municipio o alcaldía')
    address_neighborhood    = models.CharField(max_length=100, blank=True, verbose_name='Colonia')
    address_postal_code     = models.CharField(max_length=5, blank=True, verbose_name='Código postal')
    home_phone              = models.CharField(max_length=20, blank=True, verbose_name='Teléfono de casa')

    # Parent 1
    parent1_name     = models.CharField(max_length=200)
    parent1_email    = models.EmailField()
    parent1_phone    = models.CharField(max_length=20)
    parent1_occupation = models.CharField(max_length=100, blank=True)

    # Parent 2 (optional)
    parent2_name     = models.CharField(max_length=200, blank=True)
    parent2_email    = models.EmailField(blank=True)
    parent2_phone    = models.CharField(max_length=20, blank=True)

    # Emergency contact. emergency_name is kept in sync from the ficha's
    # given names + surnames (convert copies it to the student file).
    emergency_name   = models.CharField(max_length=200, blank=True)
    emergency_surnames     = models.CharField(max_length=150, blank=True, verbose_name='Apellido(s) del contacto')
    emergency_given_names  = models.CharField(max_length=100, blank=True, verbose_name='Nombre(s) del contacto')
    emergency_phone  = models.CharField(max_length=20, blank=True)
    emergency_mobile = models.CharField(max_length=20, blank=True, verbose_name='Celular del contacto')
    emergency_rel    = models.CharField(max_length=50, blank=True)

    # Medical — sensitive personal data, ENCRYPTED AT REST (IK-LEGAL B4) and gated
    # on MEDICAL_DATA consent + role in the serializer.
    blood_type       = EncryptedTextField(blank=True, default='')
    allergies        = EncryptedTextField(blank=True, default='')
    medical_notes    = EncryptedTextField(blank=True, default='')
    estatura         = EncryptedTextField(blank=True, default='', verbose_name='Estatura')
    peso             = EncryptedTextField(blank=True, default='', verbose_name='Peso')
    # Ficha «Datos adicionales»: '' | 'si' | 'no' (``allergies`` holds «¿cuáles?»).
    has_allergies      = EncryptedTextField(blank=True, default='', verbose_name='¿Tiene alergias?')
    chronic_conditions = EncryptedTextField(blank=True, default='', verbose_name='Enfermedades crónicas')

    # Status
    status       = models.CharField(max_length=20, choices=Status.choices, default=Status.DRAFT)
    submitted_at = models.DateTimeField(null=True, blank=True)
    created_at   = models.DateTimeField(default=timezone.now)
    updated_at   = models.DateTimeField(auto_now=True)
    admin_notes  = models.TextField(blank=True)

    # ── Consent (IK-LEGAL B2) — captured on the anonymous registration itself ─────
    # (Applicants aren't guardian User accounts yet, so LFPDPPP acceptance is
    # recorded here, tied to the exact notice version; medical fields are gated on
    # consent_medical_data at submit.)
    privacy_notice_version = models.ForeignKey('legal.PrivacyNoticeVersion', null=True,
                                               blank=True, on_delete=models.SET_NULL,
                                               related_name='+')
    privacy_accepted_at    = models.DateTimeField(null=True, blank=True)
    consent_photos_media   = models.BooleanField(default=False)
    consent_medical_data   = models.BooleanField(default=False)
    # Ficha step 7: the full name typed as signature, when and from where.
    signed_name = models.CharField(max_length=200, blank=True, verbose_name='Nombre completo (firma)')
    signed_at   = models.DateTimeField(null=True, blank=True, verbose_name='Firmada')
    signed_ip   = models.GenericIPAddressField(null=True, blank=True, verbose_name='IP de la firma')

    class Meta:
        verbose_name = 'Inscripción'
        verbose_name_plural = 'Inscripciones'
        ordering = ['-created_at']
        indexes = [
            # Console list and pipeline by status (Data Ops Phase 1).
            models.Index(fields=['status', '-updated_at'], name='adm_reg_status_updated'),
            models.Index(fields=['status', '-created_at'], name='adm_reg_status_created'),
            # Case-insensitive guardian lookups (dedupe, search, convert).
            models.Index(Lower('parent1_email'), name='adm_reg_p1email_lower'),
            models.Index(Lower('parent2_email'), name='adm_reg_p2email_lower'),
            models.Index(fields=['child_curp'], name='adm_reg_child_curp'),
            # «Continuar mi ficha» looks drafts up by the contact's email.
            models.Index(Lower('contact_email'), name='adm_reg_contact_email_lower'),
        ]

    def __str__(self):
        return f'{self.child_first_name} {self.child_last_name} — {self.grade_applying} ({self.status})'

    def submit(self):
        self.status = self.Status.SUBMITTED
        self.submitted_at = timezone.now()
        self.save()


class RegistrationGuardian(models.Model):
    """«Datos del padre» / «Datos de la madre» of the ficha (one row per role).

    A block may be «No aplica» (single-parent families) and either may be the
    legal guardian. The legacy ``Registration.parent1_*`` / ``parent2_*``
    fields are derived from these rows and the step-0 contact by
    ``admissions.guardians.sync_legacy_parents`` (convert, lists, emails).
    """

    class Role(models.TextChoices):
        PADRE = 'padre', 'Padre'
        MADRE = 'madre', 'Madre'

    registration      = models.ForeignKey(Registration, on_delete=models.CASCADE, related_name='guardians')
    role              = models.CharField(max_length=10, choices=Role.choices, verbose_name='Bloque')
    not_applicable    = models.BooleanField(default=False, verbose_name='No aplica')
    is_legal_guardian = models.BooleanField(default=False, verbose_name='Es tutor/a legal')

    paternal_surname  = models.CharField(max_length=100, blank=True, verbose_name='Apellido paterno')
    maternal_surname  = models.CharField(max_length=100, blank=True, verbose_name='Apellido materno')
    given_names       = models.CharField(max_length=100, blank=True, verbose_name='Nombre(s)')
    sex               = models.CharField(max_length=10, blank=True, verbose_name='Sexo')
    dob               = models.DateField(null=True, blank=True, verbose_name='Fecha de nacimiento')
    birth_country     = models.CharField(max_length=60, blank=True, verbose_name='País de nacimiento')
    birth_state       = models.CharField(max_length=60, blank=True, verbose_name='Estado de nacimiento')
    curp              = models.CharField(max_length=20, blank=True, verbose_name='CURP')
    marital_status    = models.CharField(max_length=20, blank=True, verbose_name='Estado civil')
    education_level   = models.CharField(max_length=20, blank=True, verbose_name='Grado académico')
    occupation        = models.CharField(max_length=40, blank=True, verbose_name='Ocupación')
    occupation_other  = models.CharField(max_length=100, blank=True, verbose_name='Otra ocupación')
    mobile            = models.CharField(max_length=20, blank=True, verbose_name='Celular')
    office_phone      = models.CharField(max_length=20, blank=True, verbose_name='Teléfono de oficina')
    office_ext        = models.CharField(max_length=10, blank=True, verbose_name='Extensión')
    email             = models.EmailField(blank=True, verbose_name='Correo electrónico')

    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'Padre, madre o tutor (ficha)'
        verbose_name_plural = 'Padres, madres o tutores (ficha)'
        ordering = ['registration_id', 'role']
        constraints = [
            models.UniqueConstraint(fields=['registration', 'role'], name='adm_guardian_role_unique'),
        ]

    def __str__(self):
        return f'{self.get_role_display()} de la inscripción {self.registration_id}'


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
    # Fase 4: the document of the per-level list this file is for. ``doc_type``
    # stays for compatibility (old wizard, exports); new uploads by key store
    # the matching legacy code or ``other`` (admissions.required_docs).
    required_document = models.ForeignKey('admissions.RequiredDocument', null=True, blank=True,
                                          on_delete=models.PROTECT, related_name='uploads')
    file         = models.FileField(upload_to=document_upload_path)
    filename     = models.CharField(max_length=255)
    file_size    = models.PositiveIntegerField(default=0)  # bytes
    uploaded_at  = models.DateTimeField(default=timezone.now)
    is_verified  = models.BooleanField(default=False)

    # Per-document review (BACKLOG P1-G4). ``is_verified`` mirrors approved so
    # existing badges/filters keep working.
    class Review(models.TextChoices):
        PENDING = 'pending', 'Pendiente'
        APPROVED = 'approved', 'Aprobado'
        REJECTED = 'rejected', 'Rechazado'

    status       = models.CharField(max_length=10, choices=Review.choices, default=Review.PENDING)
    review_note  = models.CharField(max_length=300, blank=True)

    class Meta:
        verbose_name = 'Documento'
        verbose_name_plural = 'Documentos'

    def __str__(self):
        return f'{self.get_doc_type_display()} — {self.registration}'


# ── Proceso de admisión: acuerdos y pago de inscripción (Fase 5) ───────────
# RECORD ONLY: the platform never charges colegiaturas or inscripción. These
# rows write down what the school agreed and received, for the Expediente and
# the «Marcar como inscrito» gate. Deleting one voids it (``voided_at``), so the
# case history keeps it.
class AdmissionDiscount(models.Model):
    """A beca or descuento agreed during «Documentación y acuerdos»."""

    class Kind(models.TextChoices):
        INSCRIPCION           = 'inscripcion',           'Descuento en inscripción'
        BECA_COLEGIATURA      = 'beca_colegiatura',      'Beca en colegiatura'
        DESCUENTO_COLEGIATURA = 'descuento_colegiatura', 'Descuento en colegiatura'

    class Duration(models.TextChoices):
        NONE          = '',              'Sin duración'
        TRES_MESES    = '3_meses',       '3 meses'
        SEIS_MESES    = '6_meses',       '6 meses'
        CICLO         = 'ciclo',         '1 ciclo'
        PERMANENTE    = 'permanente',    'Permanente'
        PERSONALIZADO = 'personalizado', 'Meses a la medida'

    pre_registration = models.ForeignKey(PreRegistration, on_delete=models.CASCADE, related_name='discounts')
    kind        = models.CharField(max_length=30, choices=Kind.choices, verbose_name='Tipo')
    percent     = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True,
                                      verbose_name='Porcentaje')
    amount      = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True,
                                      verbose_name='Monto fijo (MXN)')
    duration    = models.CharField(max_length=20, choices=Duration.choices, blank=True, default='',
                                   verbose_name='Duración')
    # First day of the first / last month (custom range; optional start otherwise).
    start_month = models.DateField(null=True, blank=True, verbose_name='Desde')
    end_month   = models.DateField(null=True, blank=True, verbose_name='Hasta')
    authorized_by = models.CharField(max_length=150, verbose_name='Autorizó')
    note        = models.TextField(blank=True, default='', verbose_name='Nota')
    created_by  = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL,
                                    related_name='+')
    created_at  = models.DateTimeField(default=timezone.now)
    updated_at  = models.DateTimeField(auto_now=True)
    voided_at   = models.DateTimeField(null=True, blank=True)
    void_reason = models.CharField(max_length=300, blank=True, default='')

    class Meta:
        verbose_name = 'Beca o descuento (admisión)'
        verbose_name_plural = 'Becas y descuentos (admisión)'
        ordering = ['created_at', 'id']

    def __str__(self):
        return f'{self.get_kind_display()} del expediente {self.pre_registration_id}'


class EnrollmentPayment(models.Model):
    """The inscripción payment as the school received it (record only)."""

    class Method(models.TextChoices):
        EFECTIVO      = 'efectivo',      'Efectivo'
        TRANSFERENCIA = 'transferencia', 'Transferencia'
        TARJETA       = 'tarjeta',       'Tarjeta'
        OTRO          = 'otro',          'Otro'

    # PROTECT: a money record never disappears with its case.
    pre_registration = models.ForeignKey(PreRegistration, on_delete=models.PROTECT,
                                         related_name='enrollment_payments')
    paid_on     = models.DateField(verbose_name='Fecha de pago')
    amount      = models.DecimalField(max_digits=10, decimal_places=2, verbose_name='Monto (MXN)')
    method      = models.CharField(max_length=20, choices=Method.choices, verbose_name='Forma de pago')
    reference   = models.CharField(max_length=100, blank=True, default='', verbose_name='Referencia')
    note        = models.CharField(max_length=300, blank=True, default='', verbose_name='Nota')
    recorded_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL,
                                    related_name='+')
    created_at  = models.DateTimeField(default=timezone.now)
    updated_at  = models.DateTimeField(auto_now=True)
    voided_at   = models.DateTimeField(null=True, blank=True)
    void_reason = models.CharField(max_length=300, blank=True, default='')

    class Meta:
        verbose_name = 'Pago de inscripción (registro)'
        verbose_name_plural = 'Pagos de inscripción (registro)'
        ordering = ['paid_on', 'id']

    def __str__(self):
        return f'Pago de inscripción del expediente {self.pre_registration_id}'


# Fase 4: required documents by level and the office's manual states.
from .document_models import RegistrationDocumentState, RequiredDocument  # noqa: E402,F401
