from django.contrib import admin
from unfold.admin import ModelAdmin, TabularInline

from .models import (
    Discount,
    FeeSchedule,
    Invoice,
    InvoiceAdjustment,
    InvoiceLineItem,
    InvoicePayment,
)


@admin.register(FeeSchedule)
class FeeScheduleAdmin(ModelAdmin):
    """Precios que se FACTURAN. Al cambiarlos, actualice también los costos
    informativos del sitio público en Contenido → Costos por sección."""
    list_display = ('name', 'grade', 'level', 'monthly_amount', 'due_day',
                    'late_fee_type', 'active')
    list_filter = ('active', 'late_fee_type', 'level')
    search_fields = ('name', 'grade', 'level')
    list_editable = ('active',)

    def changelist_view(self, request, extra_context=None):
        from django.contrib import messages
        messages.info(request, 'Recuerde: al actualizar precios, actualice '
                               'también «Contenido → Costos por sección» '
                               '(los costos que muestra el sitio público).')
        return super().changelist_view(request, extra_context)


@admin.register(Discount)
class DiscountAdmin(ModelAdmin):
    list_display = ('student', 'name', 'kind', 'method', 'value', 'active',
                    'start_period', 'end_period')
    list_filter = ('active', 'kind', 'method')
    search_fields = ('student__user__first_name', 'student__user__last_name', 'name')
    raw_id_fields = ('student',)
    list_select_related = ('student__user',)
    readonly_fields = ('created_at',)


class InvoiceLineItemInline(TabularInline):
    model = InvoiceLineItem
    extra = 0
    readonly_fields = ('created_at',)


class InvoiceAdjustmentInline(TabularInline):
    model = InvoiceAdjustment
    extra = 0
    readonly_fields = ('kind', 'admin', 'amount', 'reason', 'status_after',
                       'amount_after', 'amount_paid_after', 'created_at')
    can_delete = False


@admin.register(Invoice)
class InvoiceAdmin(ModelAdmin):
    list_display = ('student', 'period', 'amount', 'amount_paid', 'status', 'due_date')
    list_filter = ('status', 'period', 'late_fee_applied')
    search_fields = ('student__user__first_name', 'student__user__last_name',
                     'student__student_id')
    raw_id_fields = ('student', 'fee_schedule')
    date_hierarchy = 'due_date'
    list_select_related = ('student__user',)
    readonly_fields = ('subtotal', 'discount_total', 'late_fee_total', 'amount',
                       'amount_paid', 'paid_at', 'created_at', 'updated_at')
    inlines = [InvoiceLineItemInline, InvoiceAdjustmentInline]


@admin.register(InvoicePayment)
class InvoicePaymentAdmin(ModelAdmin):
    """Read-only: rows are written by the payment-application service only."""
    list_display = ('invoice', 'payment', 'amount', 'created_at')
    raw_id_fields = ('invoice', 'payment')
    list_select_related = ('invoice__student__user', 'payment')
    readonly_fields = ('invoice', 'payment', 'amount', 'created_at')

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(InvoiceAdjustment)
class InvoiceAdjustmentAdmin(ModelAdmin):
    """Read-only: adjustment rows are the tuition ledger's audit trail."""
    list_display = ('invoice', 'kind', 'amount', 'admin', 'created_at')
    list_filter = ('kind',)
    date_hierarchy = 'created_at'
    list_select_related = ('invoice__student__user', 'admin')
    readonly_fields = ('invoice', 'admin', 'kind', 'amount', 'reason', 'status_after',
                       'amount_after', 'amount_paid_after', 'created_at')

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
