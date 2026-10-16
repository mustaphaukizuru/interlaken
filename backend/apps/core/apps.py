from django.apps import AppConfig


class CoreConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.core'
    verbose_name = 'Núcleo'

    def ready(self):
        from . import audit
        from . import checks  # noqa: F401  (registers the deploy system checks)
        audit.connect_default_tracking()
