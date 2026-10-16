from django.contrib import admin
from unfold.admin import ModelAdmin

from .models import (
    BalanceAdjustment,
    CafeteriaBalance,
    CafeteriaTransaction,
    LoyverseProfile,
    TopUpRequest,
)


@admin.register(LoyverseProfile)
class LoyverseProfileAdmin(ModelAdmin):
    """Read-only mirror of the full Loyverse customer record (synced by
    ``sync_loyverse_profiles``); never hand-edited."""
    list_display = ('customer_code', 'name', 'total_visits', 'total_spent',
                    'total_points', 'last_visit', 'synced_at')
    list_filter = ('last_visit', 'synced_at')
    search_fields = ('customer_code', 'name', 'email', 'loyverse_id',
                     'student__user__email')
    date_hierarchy = 'last_visit'
    list_select_related = ('student__user',)
    readonly_fields = ('student', 'loyverse_id', 'customer_code', 'name', 'email',
                       'phone_number', 'address_code', 'note', 'first_visit',
                       'last_visit', 'total_visits', 'total_spent', 'total_points',
                       'loyverse_created_at', 'loyverse_updated_at', 'raw', 'synced_at')

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(CafeteriaBalance)
class CafeteriaBalanceAdmin(ModelAdmin):
    list_display = ('student', 'balance', 'is_low_balance', 'low_balance_threshold',
                    'last_synced')
    search_fields = ('student__user__email', 'student__user__first_name',
                     'student__user__last_name', 'student__student_id')
    list_select_related = ('student__user',)
    # Money is mutated only by the Loyverse sync and the console service layer
    # (which writes a BalanceAdjustment audit row) — never hand-edited here.
    # ``student`` too: repointing a wallet moves its money to another child,
    # and the seed stamps decide what the POS mirror may credit.
    readonly_fields = ('student', 'balance', 'last_synced', 'seeded_at',
                       'last_low_balance_alert_at', 'last_budget_alert_at')

    # Operated from the staff portal (/admin/cafeteria); the Django admin is a
    # read-only system-of-record view. See docs/ADMIN-VS-PORTAL.md.
    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


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
    # Ledger rows come from the Loyverse sync / top-up services and are
    # immutable: retyping a row's student or type moves money (a refund of a
    # "purchase" credits, of a "top-up" debits). Corrections go through the
    # console's audited adjustment/refund instead.
    readonly_fields = ('student', 'transaction_type', 'amount', 'description', 'date',
                       'loyverse_receipt_id', 'items', 'balance_after', 'recorded_at',
                       'applied', 'refund_of')

    # Operated from the staff portal (/admin/cafeteria); the Django admin is a
    # read-only system-of-record view. See docs/ADMIN-VS-PORTAL.md.
    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(TopUpRequest)
class TopUpRequestAdmin(ModelAdmin):
    list_display = (
        'student', 'amount', 'method', 'status',
        'pos_loaded_at', 'pos_unload_needed_at', 'pos_unloaded_at',
        'created_at', 'processed_at',
    )
    list_filter = ('status', 'method')
    search_fields = ('student__user__email', 'student__user__first_name',
                     'student__user__last_name', 'student__student_id', 'payment_ref')
    ordering = ('-created_at',)
    date_hierarchy = 'created_at'
    list_select_related = ('student__user',)
    # Top-ups are created by the online flow / the staff console. Everything
    # that decides money is immutable here: flipping a completed online top-up
    # to office + pending and applying it in the console credited it twice.
    # Only ``notes`` stays editable.
    readonly_fields = (
        'student', 'amount', 'method', 'status', 'payment_ref', 'created_at', 'processed_at',
        'pos_loaded_at', 'pos_loaded_by',
        'pos_unload_needed_at', 'pos_unloaded_at', 'pos_unloaded_by',
    )

    # Operated from the staff portal (/admin/cafeteria); the Django admin is a
    # read-only system-of-record view. See docs/ADMIN-VS-PORTAL.md.
    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


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
