from django.contrib import admin
from .models import Payment

@admin.register(Payment)
class PaymentAdmin(admin.ModelAdmin):
    list_display = ('user', 'amount', 'currency', 'payment_type', 'status', 'created_at')
    list_filter = ('status', 'payment_type', 'currency')
    search_fields = ('user__email', 'gateway_tx_id', 'description')
    ordering = ('-created_at',)
    readonly_fields = ('gateway_raw', 'gateway_tx_id', 'created_at', 'updated_at')
    date_hierarchy = 'created_at'
