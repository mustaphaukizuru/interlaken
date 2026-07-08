"""
core/audit.py — append-only audit recording + automatic signal wiring (IK-SEC A3).

`record(action, instance, changes)` writes an immutable `AuditLog` row. The actor
is resolved (in priority order) from an explicit argument, an `audit_context(...)`
block (used to stamp automated jobs as `system:<job>`), or the current request's
authenticated user (captured lazily so DRF's JWT auth has already run). Signals
auto-record diffs for money, wallet, minor-data, and role/permission mutations.
"""
import threading
from contextlib import contextmanager
from decimal import Decimal

from django.db.models.signals import m2m_changed, post_delete, post_save, pre_save

_local = threading.local()


# ── actor context ─────────────────────────────────────────
@contextmanager
def audit_context(actor=None, actor_label='', context=''):
    """Stamp all audit records inside the block with this actor/label/context.

    Use `actor_label='system:<job>'` around webhook and cron money movements.
    """
    prev = getattr(_local, 'ctx', None)
    _local.ctx = {'actor': actor, 'actor_label': actor_label, 'context': context}
    try:
        yield
    finally:
        _local.ctx = prev


def _resolve(actor, actor_label, context):
    ctx = getattr(_local, 'ctx', None) or {}
    actor = actor or ctx.get('actor')
    label = actor_label or ctx.get('actor_label')
    context = context or ctx.get('context', '')
    if actor is None and not label:
        req = getattr(_local, 'request', None)
        user = getattr(req, 'user', None) if req is not None else None
        if user is not None and getattr(user, 'is_authenticated', False):
            actor = user
            context = context or getattr(req, 'path', '')
    if actor is not None:
        label = label or getattr(actor, 'email', '') or str(actor)
    return actor, (label or 'system'), context


def _jsonable(value):
    if isinstance(value, Decimal):
        return str(value)
    if hasattr(value, 'isoformat'):
        return value.isoformat()
    return value


def record(action, instance, changes=None, *, actor=None, actor_label='', context=''):
    """Write one immutable AuditLog row for a mutation on `instance`."""
    from .models import AuditLog
    resolved_actor, label, ctx = _resolve(actor, actor_label, context)
    AuditLog.objects.create(
        actor=resolved_actor if getattr(resolved_actor, 'pk', None) else None,
        actor_label=label[:150],
        action=action,
        object_type=f'{instance._meta.app_label}.{instance._meta.model_name}',
        object_id=str(instance.pk),
        changes=changes or {},
        context=(ctx or '')[:200],
    )


# ── request actor middleware ──────────────────────────────
class AuditActorMiddleware:
    """Expose the current request so `record()` can attribute the acting user.

    Stored (not read) here; the user is read lazily at record time, after DRF's
    authentication has resolved `request.user`.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        _local.request = request
        try:
            return self.get_response(request)
        finally:
            _local.request = None


# ── automatic signal-based auditing ───────────────────────
_TRACKED = {}


def register_audit(model, fields, context_label=''):
    """Auto-record create/update(diff)/delete on `model` for `fields`."""
    _TRACKED[model] = (list(fields), context_label)
    uid = f'audit:{model._meta.label}'
    pre_save.connect(_pre_save, sender=model, dispatch_uid=uid + ':pre')
    post_save.connect(_post_save, sender=model, dispatch_uid=uid + ':post')
    post_delete.connect(_post_delete, sender=model, dispatch_uid=uid + ':del')


def register_m2m(model, field_name, context_label='permission'):
    """Auto-record add/remove/clear on a m2m (e.g. groups / user_permissions)."""
    through = getattr(model, field_name).through
    m2m_changed.connect(
        lambda sender, instance, action, pk_set, **kw: _m2m(
            model, field_name, context_label, instance, action, pk_set),
        sender=through,
        weak=False,
        dispatch_uid=f'audit:m2m:{model._meta.label}:{field_name}',
    )


def _pre_save(sender, instance, **kwargs):
    if not instance.pk:
        instance._audit_old = None
        return
    fields, _ = _TRACKED[sender]
    instance._audit_old = sender.objects.filter(pk=instance.pk).values(*fields).first()


def _post_save(sender, instance, created, **kwargs):
    fields, label = _TRACKED[sender]
    if created:
        record('create', instance,
               {f: [None, _jsonable(getattr(instance, f))] for f in fields},
               context=label)
        return
    old = getattr(instance, '_audit_old', None) or {}
    diff = {}
    for f in fields:
        new = getattr(instance, f)
        if old.get(f) != new:
            diff[f] = [_jsonable(old.get(f)), _jsonable(new)]
    if diff:
        record('update', instance, diff, context=label)


def _post_delete(sender, instance, **kwargs):
    _, label = _TRACKED[sender]
    record('delete', instance, context=label)


def _m2m(model, field_name, label, instance, action, pk_set):
    # Only the forward side (instance is the tracked model), on real changes.
    if action not in ('post_add', 'post_remove', 'post_clear'):
        return
    if not isinstance(instance, model):
        return
    record('permission', instance,
           {field_name: [action, sorted(pk_set) if pk_set else []]},
           context=label)


def connect_default_tracking():
    """Wire the target models (called from CoreConfig.ready)."""
    from apps.accounts.models import StudentProfile, User
    from apps.admissions.models import Registration
    from apps.cafeteria.models import CafeteriaBalance, CafeteriaTransaction
    from apps.payments.models import Payment

    # Money + all money movements (webhook/automated set actor via audit_context).
    register_audit(Payment, ['status', 'amount', 'gateway_tx_id'], 'payments')
    # Wallet (cycle-independent ledger).
    register_audit(CafeteriaBalance, ['balance'], 'cafeteria.wallet')
    register_audit(CafeteriaTransaction, ['amount', 'transaction_type', 'balance_after'],
                   'cafeteria.wallet')
    # Student personal + medical fields.
    register_audit(StudentProfile, ['grade', 'group', 'loyverse_id', 'is_active'],
                   'student.personal')
    register_audit(Registration, ['blood_type', 'allergies', 'medical_notes'],
                   'student.medical')
    # Role + permission changes.
    register_audit(User, ['role', 'is_staff', 'is_superuser', 'is_active'],
                   'account.permission')
    register_m2m(User, 'groups')
    register_m2m(User, 'user_permissions')
