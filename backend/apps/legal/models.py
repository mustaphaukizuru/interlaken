"""
legal/models.py — LFPDPPP consent data model (IK-LEGAL B1).

Privacy-notice versions are tracked so consent is always tied to the exact text
the guardian accepted. ConsentRecord is IMMUTABLE and granular per purpose:
revoking consent is a NEW record (granted=False), never an edit. Current state
for a (guardian, purpose[, student]) is "the latest record wins".
"""
from datetime import timedelta

from django.conf import settings
from django.db import IntegrityError, models
from django.utils import timezone


def add_business_days(start_date, days):
    """Return the date `days` business days (Mon–Fri) after `start_date`."""
    d, added = start_date, 0
    while added < days:
        d += timedelta(days=1)
        if d.weekday() < 5:
            added += 1
    return d


class ConsentPurpose(models.TextChoices):
    ACADEMIC_PROCESSING      = 'academic_processing',      'Tratamiento académico'
    CAFETERIA                = 'cafeteria',                'Cafetería'
    PHOTOS_MEDIA             = 'photos_media',             'Fotografías y medios'
    COMMUNICATIONS_MARKETING = 'communications_marketing', 'Comunicaciones y marketing'
    MEDICAL_DATA             = 'medical_data',             'Datos de salud'


# Public current-notice cache (see legal/views.py CurrentNoticeView). Mirrors
# the content-app pattern: TTL + explicit invalidation on every version save.
NOTICE_CACHE_KEY = 'legal:current-notice'


class PrivacyNoticeVersion(models.Model):
    """A versioned Aviso de Privacidad (ADCE EDUCACIÓN A.C.)."""
    version              = models.CharField(max_length=30, unique=True)  # e.g. '2026.1'
    title                = models.CharField(max_length=200, default='Aviso de Privacidad')
    body                 = models.TextField(verbose_name='Texto del aviso')
    integral_notice_url  = models.URLField(blank=True, default='',
                                           verbose_name='URL del aviso integral')
    effective_date       = models.DateField()
    is_active            = models.BooleanField(default=False, verbose_name='Vigente')
    created_at           = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ['-effective_date', '-created_at']
        verbose_name = 'Versión del aviso de privacidad'
        verbose_name_plural = 'Versiones del aviso de privacidad'

    def __str__(self):
        return f'Aviso de Privacidad v{self.version}'

    @classmethod
    def current(cls):
        """The active notice version applicants must accept (newest active)."""
        return cls.objects.filter(is_active=True).order_by('-effective_date').first()

    def save(self, *args, **kwargs):
        # Any edit/activation may change which notice is "current" — drop the
        # public cache so CurrentNoticeView re-reads on the next request.
        from django.core.cache import cache
        result = super().save(*args, **kwargs)
        cache.delete(NOTICE_CACHE_KEY)
        return result

    def delete(self, *args, **kwargs):
        from django.core.cache import cache
        result = super().delete(*args, **kwargs)
        cache.delete(NOTICE_CACHE_KEY)
        return result


class ConsentRecordQuerySet(models.QuerySet):
    """Immutable: consent is captured, never edited or deleted in place."""

    def update(self, *args, **kwargs):
        raise IntegrityError('ConsentRecord is immutable; revocation is a new record.')

    def delete(self, *args, **kwargs):
        raise IntegrityError('ConsentRecord is immutable; it cannot be deleted.')


class ConsentRecord(models.Model):
    """An immutable, granular record of consent granted or revoked."""

    guardian        = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT,
                                        related_name='consent_records')
    # Present when the consent is about a specific minor (e.g. photos, medical data).
    student         = models.ForeignKey('accounts.StudentProfile', null=True, blank=True,
                                        on_delete=models.SET_NULL, related_name='consent_records')
    notice_version  = models.ForeignKey(PrivacyNoticeVersion, on_delete=models.PROTECT,
                                        related_name='consent_records')
    purpose         = models.CharField(max_length=40, choices=ConsentPurpose.choices)
    granted         = models.BooleanField()   # True = granted, False = revoked
    captured_at     = models.DateTimeField(default=timezone.now)
    capture_context = models.CharField(max_length=80, blank=True, default='')
    capture_ip      = models.GenericIPAddressField(null=True, blank=True)

    objects = ConsentRecordQuerySet.as_manager()

    class Meta:
        ordering = ['-captured_at']
        verbose_name = 'Registro de consentimiento'
        verbose_name_plural = 'Registros de consentimiento'
        indexes = [
            models.Index(fields=['guardian', 'purpose', 'captured_at']),
            models.Index(fields=['student', 'purpose', 'captured_at']),
        ]

    def __str__(self):
        state = 'otorgado' if self.granted else 'revocado'
        return f'{self.get_purpose_display()} {state} — {self.guardian_id}'

    def save(self, *args, **kwargs):
        if self.pk is not None:
            raise IntegrityError('ConsentRecord is immutable; revocation is a new record.')
        return super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise IntegrityError('ConsentRecord is immutable; it cannot be deleted.')


# LFPDPPP art. 32: the responsable must answer an ARCO request within 20 business days.
ARCO_RESPONSE_BUSINESS_DAYS = 20


class ArcoRequest(models.Model):
    """A data-subject rights request (Acceso, Rectificación, Cancelación, Oposición)."""

    class Type(models.TextChoices):
        ACCESS        = 'access',        'Acceso'
        RECTIFICATION = 'rectification', 'Rectificación'
        CANCELLATION  = 'cancellation',  'Cancelación'
        OPPOSITION    = 'opposition',    'Oposición'

    class Status(models.TextChoices):
        RECEIVED  = 'received',  'Recibida'
        IN_REVIEW = 'in_review', 'En revisión'
        RESOLVED  = 'resolved',  'Resuelta'
        REJECTED  = 'rejected',  'Rechazada'

    requester          = models.ForeignKey(settings.AUTH_USER_MODEL, null=True,
                                           on_delete=models.SET_NULL, related_name='arco_requests')
    requester_email    = models.EmailField()   # snapshot, survives account deletion
    request_type       = models.CharField(max_length=20, choices=Type.choices)
    details            = models.TextField(blank=True, default='')
    status             = models.CharField(max_length=20, choices=Status.choices,
                                          default=Status.RECEIVED)
    resolution_note    = models.TextField(blank=True, default='')
    statutory_deadline = models.DateField()
    created_at         = models.DateTimeField(default=timezone.now)
    updated_at         = models.DateTimeField(auto_now=True)
    resolved_at        = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-created_at']
        verbose_name = 'Solicitud ARCO'
        verbose_name_plural = 'Solicitudes ARCO'

    def __str__(self):
        return f'{self.get_request_type_display()} — {self.requester_email} ({self.status})'

    def save(self, *args, **kwargs):
        if not self.statutory_deadline:
            self.statutory_deadline = add_business_days(
                timezone.now().date(), ARCO_RESPONSE_BUSINESS_DAYS)
        return super().save(*args, **kwargs)
