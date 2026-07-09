from django.contrib import admin
from unfold.admin import ModelAdmin

from .models import (BalanceAdjustment, CafeteriaBalance, CafeteriaTransaction,
                     TopUpRequest)


@admin.register(CafeteriaBalance)
class CafeteriaBalanceAdmin(ModelAdmin):
    list_display = ('student', 'balance', 'is_low_balance', 'last_synced')
    search_fields = ('student__user__email', 'student__student_id')
    readonly_fields = ('last_synced',)

@admin.register(CafeteriaTransaction)
class CafeteriaTransactionAdmin(ModelAdmin):
    list_display = ('student', 'transaction_type', 'amount', 'date', 'loyverse_receipt_id')
    list_filter = ('transaction_type', 'date')
    search_fields = ('student__user__email', 'loyverse_receipt_id')
    date_hierarchy = 'date'

@admin.register(TopUpRequest)
class TopUpRequestAdmin(ModelAdmin):
    list_display = ('student', 'amount', 'method', 'status', 'created_at', 'processed_at')
    list_filter = ('status', 'method')
    search_fields = ('student__user__email',)
    ordering = ('-created_at',)
    readonly_fields = ('created_at', 'processed_at')


@admin.register(BalanceAdjustment)
class BalanceAdjustmentAdmin(ModelAdmin):
    list_display = ('student', 'kind', 'amount', 'balance_after', 'admin', 'created_at')
    list_filter = ('kind', 'created_at')
    search_fields = ('student__user__email', 'reason')
    ordering = ('-created_at',)
    # Audit rows are immutable â€” created only through the service layer.
    readonly_fields = ('student', 'admin', 'kind', 'amount', 'reason', 'balance_after',
                       'transaction', 'source_transaction', 'created_at')
