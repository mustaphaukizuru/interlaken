from django.contrib import admin
from unfold.admin import ModelAdmin

from .models import Payment


@admin.register(Payment)
class PaymentAdmin(ModelAdmin):
    """Read-mostly ledger of online gateway transactions (cafetería top-ups).

    Payments are created only by the portal top-up flow and settled only by
    signed gateway webhooks, so the admin must never mint or delete one by
    hand (a hand-made row has no checkout session and credits nothing). Staff
    can still flip ``status`` for manual reconciliation; everything else is
    read-only. Day-to-day operations (refunds, top-up review, balances) live in
    the staff portal (/admin/cafeteria), not here.
    """
    list_display = ('user', 'amount', 'currency', 'payment_type', 'gateway',
                    'status', 'created_at')
    list_filter = ('status', 'payment_type', 'gateway', 'currency')
    search_fields = ('user__email', 'gateway_tx_id', 'gateway_ref', 'description')
    ordering = ('-created_at',)
    date_hierarchy = 'created_at'
    list_select_related = ('user',)
    readonly_fields = ('user', 'payment_type', 'amount', 'currency', 'description',
                       'gateway', 'gateway_ref', 'gateway_raw', 'gateway_tx_id',
                       'related_topup', 'completed_at', 'created_at', 'updated_at')

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
