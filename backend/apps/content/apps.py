from django.apps import AppConfig


class ContentConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.content'
    verbose_name = 'Contenido del sitio'

    def ready(self):
        # Edits to public site data (phone, socials…) land in the audit trail —
        # they change what every visitor sees.
        from apps.core.audit import register_audit

        from .models import SiteSettings

        register_audit(
            SiteSettings,
            ['phone_display', 'phone_e164', 'whatsapp_number', 'contact_email',
             'address', 'maps_url', 'office_hours',
             'facebook_url', 'instagram_url', 'youtube_url'],
            'content.settings',
        )
