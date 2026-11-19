"""
core/money_queries.py: the row-locked querysets of the money paths, runnable
against the real database (``manage.py check_money_queries``).

Why it exists: SQLite, which the test suite runs on, ignores row locks.
PostgreSQL refuses ``SELECT ... FOR UPDATE`` on the nullable side of an outer
join and together with GROUP BY or DISTINCT, so such a query passes every test
and fails only in production. On 2026-11-18 every «Verificar en MultiCobros»
was a 500 (``checkout_for_verify`` locked a LEFT JOIN), and before that a forms
bulk delete failed the same way (a Count annotation made a GROUP BY).

Each entry builds the queryset shape the code locks (same model, joins, ``of=``
and evaluation: ``.first()``, ``.get()``, a ``values_list``) filtered to a
primary key that cannot exist, so it matches no row and takes no row lock.
PostgreSQL still parses and plans it, which is where both errors are raised.
``run_checks`` evaluates every entry inside ONE transaction that is always
rolled back, with short statement and lock timeouts: nothing is written and
nothing waits, so it is safe on production at any time.

The bulk entries are discovered: every routed ``AdminBulkView`` subclass is
checked with the lock ``run_bulk`` takes (``get_queryset()`` filtered to the
chunk ids, ``select_for_update(of=("self",))``).

When you add a ``select_for_update`` to a money path, add it here too.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

from django.db import DatabaseError, connection, transaction

# No row has this primary key (ids start at 1): the query is planned, matches
# nothing and therefore locks nothing.
MISSING = -1

# Django's QuerySet.get() fetches at most this many rows (MAX_GET_RESULTS).
_GET_LIMIT = 21

# Bounds for the whole check on PostgreSQL: a statement that waits on a lock
# held by a migration (or anything else) fails fast instead of hanging a deploy.
STATEMENT_TIMEOUT = "5s"
LOCK_TIMEOUT = "2s"


@dataclass(frozen=True)
class LockedQuery:
    name: str  # what it protects, as staff would name it
    source: str  # where the real query lives
    build: Callable  # () -> QuerySet, already shaped like the real evaluation


@dataclass(frozen=True)
class Result:
    name: str
    source: str
    error: str = ""

    @property
    def ok(self) -> bool:
        return not self.error


def _first(qs):
    """The query ``.first()`` runs: ordered by pk unless already ordered, LIMIT 1."""
    return (qs if qs.ordered else qs.order_by("pk"))[:1]


def _get(qs):
    """The query ``.get()`` (and ``get_or_create``'s read) runs: unordered, LIMIT 21."""
    return qs.order_by()[:_GET_LIMIT]


def _payment_checks() -> list[LockedQuery]:
    from apps.payments.models import BanorteCheckout, Payment
    from apps.payments.multicobros import checkout_for_verify

    return [
        LockedQuery(
            # One lock for both ways in: the per-payment dialog and the report
            # upload verify through the same ``verify_approval``.
            "Verificar en MultiCobros, uno por uno o con el reporte (checkout + pago)",
            "apps/payments/multicobros.py checkout_for_verify (verify_approval)",
            lambda: _first(checkout_for_verify(MISSING)),
        ),
        LockedQuery(
            "Resultado Banorte (checkout)",
            "apps/payments/views.py BanorteResultView.post",
            lambda: _first(BanorteCheckout.objects.select_for_update().filter(payment_id=MISSING)),
        ),
        LockedQuery(
            "Cerrar checkout abierto (pago)",
            "apps/payments/services.py fail_checkout_if_still_open",
            lambda: _first(Payment.objects.select_for_update().filter(pk=MISSING)),
        ),
        LockedQuery(
            "Liquidar evento de pago (pago)",
            "apps/payments/settlement.py apply_event",
            lambda: _get(Payment.objects.select_for_update().filter(pk=MISSING)),
        ),
        LockedQuery(
            "Conciliar con MultiCobros (pago)",
            "apps/payments/multicobros.py _locked",
            lambda: _first(Payment.objects.select_for_update().filter(pk=MISSING)),
        ),
        LockedQuery(
            "Conciliar con MultiCobros (checkout)",
            "apps/payments/multicobros.py _locked",
            lambda: _first(BanorteCheckout.objects.select_for_update().filter(payment_id=MISSING)),
        ),
    ]


def _cafeteria_checks() -> list[LockedQuery]:
    from apps.accounts.models import StudentProfile
    from apps.cafeteria.models import CafeteriaBalance, TopUpRequest
    from apps.payments.models import Payment

    return [
        LockedQuery(
            "Recarga en línea pagada (recarga + alumno)",
            "apps/cafeteria/services.py complete_online_topup",
            lambda: _get(
                TopUpRequest.objects.select_for_update()
                .select_related("student")
                .filter(pk=MISSING)
            ),
        ),
        LockedQuery(
            "Aplicar / devolver recarga pagada (recarga + alumno + usuario)",
            "apps/cafeteria/services.py apply_paid_topup, refund_paid_topup",
            lambda: _get(
                TopUpRequest.objects.select_for_update()
                .select_related("student__user")
                .filter(pk=MISSING)
            ),
        ),
        LockedQuery(
            "Reverso de recarga en línea (recarga)",
            "apps/cafeteria/services.py reverse_online_topup",
            lambda: _get(TopUpRequest.objects.select_for_update().filter(pk=MISSING)),
        ),
        LockedQuery(
            "Pago de una recarga pagada (pago)",
            "apps/cafeteria/services.py _paid_payment(lock=True)",
            lambda: _first(
                Payment.objects.filter(related_topup_id=MISSING, status=Payment.Status.SUCCESS)
                .select_for_update()
                .order_by("-created_at", "-pk")
            ),
        ),
        LockedQuery(
            "Espejo de recargas en caja (recargas pagadas)",
            "apps/cafeteria/services.py mirror_pos_topups",
            lambda: TopUpRequest.objects.select_for_update()
            .filter(pk__in=[MISSING], status=TopUpRequest.Status.PAID)
            .values_list("pk", flat=True),
        ),
        LockedQuery(
            "Saldo del monedero (get_or_create / get)",
            "apps/cafeteria/services.py _record_receipt, sync_student_balance, "
            "complete_online_topup, apply_paid_topup, add_points_to_customer, adjust_balance, "
            "reconcile_to_loyverse, refund_transaction, reverse_phantom_topup; "
            "apps/accounts/staff_import.py _seed_once",
            lambda: _get(CafeteriaBalance.objects.select_for_update().filter(student_id=MISSING)),
        ),
        LockedQuery(
            "Saldo del monedero (first)",
            "apps/cafeteria/services.py reset_wallet_seed, mirror_pos_topups",
            lambda: _first(CafeteriaBalance.objects.select_for_update().filter(student_id=MISSING)),
        ),
        LockedQuery(
            "Aplicar recarga en caja (recarga + alumno)",
            "apps/cafeteria/views.py AdminApplyTopUpView.post",
            lambda: _get(
                TopUpRequest.objects.select_for_update()
                .select_related("student")
                .filter(pk=MISSING)
            ),
        ),
        # Staff cafetería accounts (2026-11-18): the wallet's Loyverse link.
        LockedQuery(
            "Vincular a Loyverse al guardar (alumno)",
            "apps/cafeteria/services.py link_profile_on_save",
            lambda: _get(StudentProfile.objects.select_for_update().filter(pk=MISSING)),
        ),
        LockedQuery(
            "Importar personal: vincular o convertir (alumno + usuario)",
            "apps/accounts/staff_import.py _apply_row",
            lambda: _get(
                StudentProfile.objects.select_for_update().select_related("user").filter(pk=MISSING)
            ),
        ),
    ]


def _routed_views(patterns):
    """Every class-based view reachable from the URLconf."""
    from django.urls import URLPattern, URLResolver

    for pattern in patterns:
        if isinstance(pattern, URLResolver):
            yield from _routed_views(pattern.url_patterns)
        elif isinstance(pattern, URLPattern):
            callback = pattern.callback
            cls = getattr(callback, "view_class", None) or getattr(callback, "cls", None)
            if isinstance(cls, type):
                yield cls


def bulk_views() -> list[type]:
    """The routed ``AdminBulkView`` subclasses, sorted by dotted path."""
    from django.urls import get_resolver

    from apps.core.bulk import AdminBulkView

    found = {
        f"{cls.__module__}.{cls.__qualname__}": cls
        for cls in _routed_views(get_resolver().url_patterns)
        if issubclass(cls, AdminBulkView) and cls is not AdminBulkView
    }
    return [found[key] for key in sorted(found)]


def _bulk_locked_queryset(view_class):
    """The lock ``run_bulk`` takes for one chunk of ``view_class``.

    No bulk ``get_queryset`` reads the request today. One that starts to fails
    here as "could not be built" (in CI first), so the check is updated with it.
    """
    view = view_class()
    view.request, view.args, view.kwargs = None, (), {}
    return view.get_queryset().filter(pk__in=[MISSING]).select_for_update(of=("self",))


def _bulk_checks() -> list[LockedQuery]:
    checks = []
    for cls in bulk_views():
        path = cls.__module__.replace(".", "/") + ".py"
        checks.append(
            LockedQuery(
                f"Acción masiva: {cls.entity or cls.__name__}",
                f"{path} {cls.__qualname__} (lock taken by apps/core/bulk.py run_bulk)",
                lambda cls=cls: _bulk_locked_queryset(cls),
            )
        )
    return checks


def all_checks() -> list[LockedQuery]:
    return [*_payment_checks(), *_cafeteria_checks(), *_bulk_checks()]


def _describe(exc: Exception) -> str:
    """One line: the exception class and the first line of its message."""
    message = (str(exc).strip().splitlines() or [""])[0][:300]
    return f"{type(exc).__name__}: {message}" if message else type(exc).__name__


def run_checks(checks: list[LockedQuery] | None = None) -> list[Result]:
    """Evaluate every check in one transaction that is always rolled back.

    A database error fails that check only (its savepoint is rolled back and
    the next check runs). A check that cannot even be built (a renamed field,
    a view that needs something new) fails too: it no longer mirrors the code.
    """
    checks = all_checks() if checks is None else checks
    results: list[Result] = []
    with transaction.atomic():
        if connection.vendor == "postgresql":
            with connection.cursor() as cursor:
                cursor.execute(f"SET LOCAL statement_timeout = '{STATEMENT_TIMEOUT}'")
                cursor.execute(f"SET LOCAL lock_timeout = '{LOCK_TIMEOUT}'")
        for check in checks:
            try:
                with transaction.atomic():
                    list(check.build())
            except DatabaseError as exc:
                results.append(Result(check.name, check.source, _describe(exc)))
            except Exception as exc:  # the check no longer mirrors the code: report it
                results.append(
                    Result(check.name, check.source, f"could not be built: {_describe(exc)}")
                )
            else:
                results.append(Result(check.name, check.source))
        # Read-only by construction; rolled back regardless.
        transaction.set_rollback(True)
    return results
