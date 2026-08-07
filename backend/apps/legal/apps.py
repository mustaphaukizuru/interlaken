from django.apps import AppConfig


class LegalConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.legal'
    verbose_name = 'Legal y Privacidad'

    def ready(self):
        # Register consent + ARCO mutations in the append-only audit log (IK-SEC A3).
        from apps.core.audit import register_audit

        from .models import ArcoRequest, ConsentRecord
        register_audit(ConsentRecord, ['purpose', 'granted'], 'legal.consent')
        register_audit(ArcoRequest, ['status'], 'legal.arco')
