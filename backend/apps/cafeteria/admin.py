from django.contrib import admin
from unfold.admin import ModelAdmin

from .models import (BalanceAdjustment, CafeteriaBalance, CafeteriaTransaction,
                     TopUpRequest)


@admin.register(CafeteriaBalance)
class CafeteriaBalanceAdmin(ModelAdmin):
    list_display = ('student', 'balance', 'is_low_balance', 'low_balance_threshold',
                    'last_synced')
    search_fields = ('student__user__email', 'student__user__first_name',
                     'student__user__last_name', 'student__student_id')
    list_select_related = ('student__user',)
    # Money is mutated only by the Loyverse sync and the console service layer
    # (which writes a BalanceAdjustment audit row) — never hand-edited here.
    readonly_fields = ('balance', 'last_synced', 'last_low_balance_alert_at')


@admin.register(CafeteriaTransaction)
class CafeteriaTransactionAdmin(ModelAdmin):
    list_display = ('student', 'transaction_type', 'amount', 'balance_after',
                    'date', 'loyverse_receipt_id')
    list_filter = ('transaction_type', 'date')
    search_fields = ('student__user__email', 'student__user__first_name',
                     'student__user__last_name', 'student__student_id',
                     'loyverse_receipt_id')
    date_hierarchy = 'date'
    list_select_related = ('student__user',)
    # Ledger rows come from the Loyverse sync / top-up services; the money and
    # provenance fields are immutable in the UI.
    readonly_fields = ('amount', 'balance_after', 'loyverse_receipt_id', 'items', 'date')


@admin.register(TopUpRequest)
class TopUpRequestAdmin(ModelAdmin):
    list_display = ('student', 'amount', 'method', 'status', 'created_at', 'processed_at')
    list_filter = ('status', 'method')
    search_fields = ('student__user__email', 'student__user__first_name',
                     'student__user__last_name', 'student__student_id', 'payment_ref')
    ordering = ('-created_at',)
    date_hierarchy = 'created_at'
    list_select_related = ('student__user',)
    # Top-ups are created by the online flow / the staff console; the amount and
    # gateway reference are immutable once the request exists.
    readonly_fields = ('amount', 'payment_ref', 'created_at', 'processed_at')


@admin.register(BalanceAdjustment)
class BalanceAdjustmentAdmin(ModelAdmin):
    """Read-only: adjustment rows are the wallet's audit trail (service-layer only)."""
    list_display = ('student', 'kind', 'amount', 'balance_after', 'admin', 'created_at')
    list_filter = ('kind', 'created_at')
    search_fields = ('student__user__email', 'reason')
    ordering = ('-created_at',)
    list_select_related = ('student__user', 'admin')
    readonly_fields = ('student', 'admin', 'kind', 'amount', 'reason', 'balance_after',
                       'transaction', 'source_transaction', 'created_at')

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
