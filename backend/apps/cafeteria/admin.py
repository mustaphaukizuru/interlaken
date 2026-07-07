from django.contrib import admin
from .models import CafeteriaBalance, CafeteriaTransaction, TopUpRequest

@admin.register(CafeteriaBalance)
class CafeteriaBalanceAdmin(admin.ModelAdmin):
    list_display = ('student', 'balance', 'is_low_balance', 'last_synced')
    search_fields = ('student__user__email', 'student__student_id')
    readonly_fields = ('last_synced',)

@admin.register(CafeteriaTransaction)
class CafeteriaTransactionAdmin(admin.ModelAdmin):
    list_display = ('student', 'transaction_type', 'amount', 'date', 'loyverse_receipt_id')
    list_filter = ('transaction_type', 'date')
    search_fields = ('student__user__email', 'loyverse_receipt_id')
    date_hierarchy = 'date'

@admin.register(TopUpRequest)
class TopUpRequestAdmin(admin.ModelAdmin):
    list_display = ('student', 'amount', 'method', 'status', 'created_at', 'processed_at')
    list_filter = ('status', 'method')
    search_fields = ('student__user__email',)
    ordering = ('-created_at',)
    readonly_fields = ('created_at', 'processed_at')
