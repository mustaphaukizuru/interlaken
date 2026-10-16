from django.contrib import admin
from unfold.admin import ModelAdmin

from .models import BanorteCheckout, Payment


@admin.register(Payment)
class PaymentAdmin(ModelAdmin):
    """Read-mostly ledger of online gateway transactions (cafetería top-ups).

    Payments are created only by the portal top-up flow and settled only from
    Banorte's decrypted checkout result or the staff "Conciliar con MultiCobros"
    action, so the admin must never mint, edit or delete one by hand: flipping
    ``status`` here moved no money, left the wallet and the top-up out of step
    and let a late approval credit twice. Everything is read-only. Day-to-day
    operations (MultiCobros checks, refunds, top-up review, balances) live in the
    staff portal (/admin/cafeteria), not here.
    """
    list_display = ('user', 'amount', 'currency', 'payment_type', 'gateway',
                    'status', 'created_at')
    list_filter = ('status', 'payment_type', 'gateway', 'currency')
    search_fields = ('user__email', 'gateway_tx_id', 'gateway_ref', 'description')
    ordering = ('-created_at',)
    date_hierarchy = 'created_at'
    list_select_related = ('user',)
    readonly_fields = ('user', 'payment_type', 'amount', 'currency', 'status', 'description',
                       'gateway', 'gateway_ref', 'gateway_raw', 'gateway_tx_id',
                       'related_topup', 'completed_at', 'created_at', 'updated_at')

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(BanorteCheckout)
class BanorteCheckoutAdmin(ModelAdmin):
    """Read-only view of every Banorte attempt (for support and certification).

    The AES key material is never shown; staff verification happens in the
    staff portal (/admin/cafeteria), which records who verified and when.
    """
    list_display = ('control_number', 'payment', 'mode', 'resultado_payw', 'referencia',
                    'codigo_aut', 'verified_at', 'created_at')
    list_filter = ('mode', 'resultado_payw')
    search_fields = ('control_number', 'referencia', 'codigo_aut', 'payment__user__email')
    ordering = ('-created_at',)
    list_select_related = ('payment',)
    exclude = ('key_material',)

    def get_readonly_fields(self, request, obj=None):
        return [f.name for f in self.model._meta.fields if f.name != 'key_material']

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
