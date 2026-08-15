from django.contrib import admin
from unfold.admin import ModelAdmin

from .models import (
    DaycareRate, EnrollmentFee, ExtracurricularActivity, FixedConcept,
    PricingPolicy, SiteSettings, TuitionCost,
)


@admin.register(TuitionCost)
class TuitionCostAdmin(ModelAdmin):
    """Costos INFORMATIVOS del sitio público — el colegio los actualiza cada
    ciclo. Los precios que se facturan viven en Finanzas → Planes de cobro."""
    list_display = ('section', 'inscripcion', 'colegiatura', 'order',
                    'is_active', 'updated_at')
    list_editable = ('inscripcion', 'colegiatura', 'order', 'is_active')
    ordering = ('order',)

    def changelist_view(self, request, extra_context=None):
        from django.contrib import messages
        messages.info(request, 'Estos costos son informativos (sitio público). '
                               'Los precios que se facturan se configuran en '
                               '«Finanzas → Planes de cobro»; mantenga ambos '
                               'en sincronía.')
        return super().changelist_view(request, extra_context)


@admin.register(EnrollmentFee)
class EnrollmentFeeAdmin(ModelAdmin):
    """Inscripción/reinscripción 2026 (informativo — sitio público)."""
    list_display = ('section', 'modality', 'gastos_administrativos', 'cuota',
                    'order', 'is_active', 'updated_at')
    list_editable = ('gastos_administrativos', 'cuota', 'order', 'is_active')
    list_filter = ('modality',)
    ordering = ('modality', 'order')


@admin.register(FixedConcept)
class FixedConceptAdmin(ModelAdmin):
    """Seguros y credenciales (informativo — sitio público)."""
    list_display = ('name', 'cost', 'mandatory', 'order', 'is_active', 'updated_at')
    list_editable = ('cost', 'mandatory', 'order', 'is_active')
    ordering = ('order',)


@admin.register(ExtracurricularActivity)
class ExtracurricularAdmin(ModelAdmin):
    """Extraescolares: anualidad en 10 parcialidades sep-jun (informativo)."""
    list_display = ('name', 'levels', 'annual_cost', 'order', 'is_active', 'updated_at')
    list_editable = ('annual_cost', 'order', 'is_active')
    ordering = ('order',)


@admin.register(DaycareRate)
class DaycareRateAdmin(ModelAdmin):
    """Estancia / horario extendido (informativo — sitio público)."""
    list_display = ('schedule', 'service', 'daily_cost', 'monthly_cost',
                    'monthly_note', 'order', 'is_active', 'updated_at')
    list_editable = ('daily_cost', 'monthly_cost', 'order', 'is_active')
    ordering = ('order',)


@admin.register(PricingPolicy)
class PricingPolicyAdmin(ModelAdmin):
    """Letra chica de precios: parcialidades, devoluciones, recargos, becas."""
    list_display = ('__str__', 'order', 'is_active', 'updated_at')
    list_editable = ('order', 'is_active')
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
