"""
content/models.py — CMS Phase 1 (IK-CMS): admin-editable site settings.

`SiteSettings` is a singleton: one row (pk=1) that the public site reads
through a cached endpoint. Defaults mirror what the site shipped with, so
creating the row changes nothing until the school edits it. Social URLs
default to EMPTY — an empty URL hides the icon, which beats the previous
placeholder links to bare facebook.com/instagram.com/youtube.com.
"""
from django.core.cache import cache
from django.db import models

SETTINGS_CACHE_KEY = 'content.site-settings.v1'


class SiteSettings(models.Model):
    # ── Contacto ──────────────────────────────────────────
    phone_display = models.CharField(
        'Teléfono (texto visible)', max_length=50, blank=True,
        default='(55) 5379-1188',
        help_text='Como se muestra en pantalla, p. ej. “(55) 5379-1188”. '
                  'Vacío = se oculta el teléfono.')
    phone_e164 = models.CharField(
        'Teléfono (marcado)', max_length=25, blank=True,
        default='+525553791188',
        help_text='Formato internacional para enlaces tel:, p. ej. +525553791188.')
    whatsapp_number = models.CharField(
        'WhatsApp', max_length=20, blank=True,
        default='5215553791188',
        help_text='Solo dígitos con lada de país, p. ej. 5215553791188 '
                  '(se usa en enlaces wa.me). Vacío = se ocultan los botones de WhatsApp.')
    # .com.mx: the school's real monitored mailboxes (per-level directory, legal
    # notice, admin accounts) all live on interlaken.com.mx; .edu.mx is the web
    # domain only (GO-LIVE-AUDIT #19, resolved 2026-08-15).
    contact_email = models.EmailField(
        'Correo de contacto', blank=True, default='colegio@interlaken.com.mx')
    address = models.CharField(
        'Dirección', max_length=200, blank=True,
        default='Av. de los Reyes 67, Residencial el Dorado, Tlalnepantla, Estado de México')
    maps_url = models.URLField(
        'Enlace de Google Maps', blank=True,
        default='https://maps.app.goo.gl/Xd241Sht8TmrMHUe6')
    office_hours = models.CharField(
        'Horario de oficina', max_length=100, blank=True,
        default='Lunes–Viernes 8:00–16:00 hrs')

    # ── Video institucional (vacío = la sección no se muestra) ─
    video_url = models.URLField(
        'Video institucional', blank=True, default='',
        help_text='URL de YouTube o Vimeo. Vacío = la sección no se muestra en el sitio.')

    # ── Redes sociales (vacío = el ícono no se muestra) ───
    # Confirmado por el cliente: la única red social del colegio es Facebook.
    facebook_url = models.URLField(
        'Facebook', blank=True, default='https://www.facebook.com/colegiointerlaken')
    instagram_url = models.URLField('Instagram', blank=True, default='')
    youtube_url = models.URLField('YouTube', blank=True, default='')

    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'Ajustes del sitio'
        verbose_name_plural = 'Ajustes del sitio'

    def __str__(self):
        return 'Ajustes del sitio público'

    def save(self, *args, **kwargs):
        # Singleton: every save lands on pk=1; the public cache refreshes.
        self.pk = 1
        super().save(*args, **kwargs)
        cache.delete(SETTINGS_CACHE_KEY)

    @classmethod
    def load(cls) -> 'SiteSettings':
        obj, _created = cls.objects.get_or_create(pk=1)
        return obj


COSTS_CACHE_KEY = 'content.tuition-costs.v1'
# One bundle for the whole public pricing page (inscripción, colegiaturas,
# seguros, extraescolares, estancia, políticas). Any pricing model save/delete
# invalidates it so the admin sees changes within one request.
PRICING_CACHE_KEY = 'content.pricing-bundle.v1'


class TuitionCost(models.Model):
    """
    Costos por sección (Admisiones → Costos), editables por el colegio en el
    admin. `inscripcion` vacío se muestra como "SIN COSTO". El ciclo escolar
    NO se guarda aquí: el sitio lo calcula solo (p. ej. 2026-2027) cada año.
    """
    section      = models.CharField('Sección', max_length=60)
    inscripcion  = models.DecimalField(
        'Inscripción / reinscripción (MXN)', max_digits=8, decimal_places=2,
        null=True, blank=True,
        help_text='Vacío = se muestra "SIN COSTO".')
    colegiatura  = models.DecimalField(
        'Colegiatura mensual (MXN)', max_digits=8, decimal_places=2)
    order        = models.PositiveSmallIntegerField('Orden', default=0)
    is_active    = models.BooleanField('Visible en el sitio', default=True)
    updated_at   = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['order', 'id']
        verbose_name = 'Costo por sección'
        verbose_name_plural = 'Costos por sección'

    def __str__(self):
        return self.section

    def save(self, *args, **kwargs):
        super().save(*args, **kwargs)
        cache.delete(COSTS_CACHE_KEY)
        cache.delete(PRICING_CACHE_KEY)

    def delete(self, *args, **kwargs):
        super().delete(*args, **kwargs)
        cache.delete(COSTS_CACHE_KEY)
        cache.delete(PRICING_CACHE_KEY)


class PricingRow(models.Model):
    """Base for admin-editable pricing catalog rows (ciclo 2026-2027 flyer).

    Like TuitionCost these are INFORMATIVE (public site); billed prices live in
    Finanzas. Every save/delete invalidates the pricing-bundle cache.
    """
    order      = models.PositiveSmallIntegerField('Orden', default=0)
    is_active  = models.BooleanField('Visible en el sitio', default=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True
        ordering = ['order', 'id']

    def save(self, *args, **kwargs):
        super().save(*args, **kwargs)
        cache.delete(PRICING_CACHE_KEY)

    def delete(self, *args, **kwargs):
        super().delete(*args, **kwargs)
        cache.delete(PRICING_CACHE_KEY)


class EnrollmentFee(PricingRow):
    """Inscripción/reinscripción por sección: gastos administrativos + cuota."""
    class Modality(models.TextChoices):
        NUEVO_INGRESO = 'nuevo_ingreso', 'Nuevo ingreso'
        REINSCRIPCION = 'reinscripcion', 'Reinscripción (alumnos Interlaken)'

    section  = models.CharField('Sección', max_length=60)
    modality = models.CharField('Modalidad', max_length=20, choices=Modality.choices)
    gastos_administrativos = models.DecimalField(
        'Gastos administrativos (MXN)', max_digits=8, decimal_places=2)
    cuota = models.DecimalField(
        'Cuota de inscripción (MXN)', max_digits=8, decimal_places=2)

    class Meta(PricingRow.Meta):
        verbose_name = 'Cuota de inscripción'
        verbose_name_plural = 'Cuotas de inscripción'
        constraints = [models.UniqueConstraint(
            fields=['section', 'modality'], name='uniq_enrollment_section_modality')]

    def __str__(self):
        return f'{self.section} — {self.get_modality_display()}'


class FixedConcept(PricingRow):
    """Conceptos fijos anuales: seguros y credenciales (obligatorios)."""
    name      = models.CharField('Concepto', max_length=80)
    cost      = models.DecimalField('Costo (MXN)', max_digits=8, decimal_places=2)
    mandatory = models.BooleanField('Obligatorio', default=True)

    class Meta(PricingRow.Meta):
        verbose_name = 'Seguro / credencial'
        verbose_name_plural = 'Seguros y credenciales'

    def __str__(self):
        return self.name


class ExtracurricularActivity(PricingRow):
    """Clases extraescolares: anualidad en 10 parcialidades (sep-jun)."""
    name        = models.CharField('Clase', max_length=80)
    levels      = models.CharField('Niveles', max_length=120)
    annual_cost = models.DecimalField('Anualidad (MXN)', max_digits=8, decimal_places=2)

    class Meta(PricingRow.Meta):
        verbose_name = 'Extraescolar'
        verbose_name_plural = 'Extraescolares'

    def __str__(self):
        return self.name


class DaycareRate(PricingRow):
    """Estancia (horario extendido): tarifa por horario."""
    schedule     = models.CharField('Horario', max_length=60)
    service      = models.CharField('Servicio', max_length=120)
    daily_cost   = models.DecimalField(
        'Costo diario (MXN)', max_digits=8, decimal_places=2)
    monthly_cost = models.DecimalField(
        'Costo mensual (MXN)', max_digits=8, decimal_places=2, null=True, blank=True,
        help_text='Vacío = sin tarifa mensual (p. ej. multa).')
    monthly_note = models.CharField(
        'Nota de mensualidad', max_length=120, blank=True, default='',
        help_text='Texto mostrado en lugar (o además) del costo mensual.')

    class Meta(PricingRow.Meta):
        verbose_name = 'Tarifa de estancia'
        verbose_name_plural = 'Estancia'

    def __str__(self):
        return f'{self.schedule} — {self.service}'


class PricingPolicy(PricingRow):
    """Letra chica del flyer: parcialidades, devoluciones, recargos, becas."""
    text = models.TextField('Política')

    class Meta(PricingRow.Meta):
        verbose_name = 'Política de precios'
        verbose_name_plural = 'Políticas de precios'

    def __str__(self):
        return self.text[:60]
