from django.contrib import admin
from unfold.admin import ModelAdmin

from .models import Payment


@admin.register(Payment)
class PaymentAdmin(ModelAdmin):
    list_display = ('user', 'amount', 'currency', 'payment_type', 'gateway',
                    'status', 'created_at')
    list_filter = ('status', 'payment_type', 'gateway', 'currency')
    search_fields = ('user__email', 'gateway_tx_id', 'gateway_ref', 'description')
    ordering = ('-created_at',)
    date_hierarchy = 'created_at'
    list_select_related = ('user',)
    # Money and gateway provenance are written by the payment flow/webhooks
    # only; status stays editable for manual reconciliation.
    readonly_fields = ('amount', 'currency', 'gateway', 'gateway_ref', 'gateway_raw',
                       'gateway_tx_id', 'related_topup', 'completed_at',
                       'created_at', 'updated_at')
