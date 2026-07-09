from django.contrib import admin
from unfold.admin import ModelAdmin

from .models import SiteSettings, TuitionCost


@admin.register(TuitionCost)
class TuitionCostAdmin(ModelAdmin):
    """Costos por sección — el colegio los actualiza cada ciclo escolar."""
    list_display = ('section', 'inscripcion', 'colegiatura', 'order',
                    'is_active', 'updated_at')
    list_editable = ('inscripcion', 'colegiatura', 'order', 'is_active')
    ordering = ('order',)


@admin.register(SiteSettings)
class SiteSettingsAdmin(ModelAdmin):
    """Singleton: one row, editable, never deletable."""
    list_display = ('__str__', 'phone_display', 'contact_email', 'updated_at')
    readonly_fields = ('updated_at',)
    fieldsets = (
        ('Contacto', {
            'fields': ('phone_display', 'phone_e164', 'whatsapp_number',
                       'contact_email', 'address', 'maps_url', 'office_hours'),
        }),
        ('Redes sociales', {
            'description': 'Deje un campo vacío para ocultar ese ícono en el sitio.',
            'fields': ('facebook_url', 'instagram_url', 'youtube_url'),
        }),
        (None, {'fields': ('updated_at',)}),
    )

    def has_add_permission(self, request):
        return not SiteSettings.objects.exists()

    def has_delete_permission(self, request, obj=None):
        return False
