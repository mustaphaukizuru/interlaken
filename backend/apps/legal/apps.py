from django.apps import AppConfig


class LegalConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.legal'
    verbose_name = 'Legal y Privacidad'

    def ready(self):
        # Register consent mutations in the append-only audit log (IK-SEC A3).
        from apps.core.audit import register_audit

        from .models import ConsentRecord
        register_audit(ConsentRecord, ['purpose', 'granted'], 'legal.consent')
