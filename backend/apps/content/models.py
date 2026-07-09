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
    contact_email = models.EmailField(
        'Correo de contacto', blank=True, default='colegio@interlaken.edu.mx')
    address = models.CharField(
        'Dirección', max_length=200, blank=True,
        default='Tlalnepantla de Baz, Estado de México')
    maps_url = models.URLField(
        'Enlace de Google Maps', blank=True,
        default='https://maps.google.com/?q=Tlalnepantla+de+Baz')
    office_hours = models.CharField(
        'Horario de oficina', max_length=100, blank=True,
        default='Lunes–Viernes 8:00–16:00 hrs')

    # ── Redes sociales (vacío = el ícono no se muestra) ───
    facebook_url = models.URLField('Facebook', blank=True, default='')
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
