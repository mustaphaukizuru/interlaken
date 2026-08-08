"""
Cafeteria views: balance, transactions, top-up requests, admin sync operations.
"""
import logging
from datetime import timedelta

from django.db import models
from django.db.models.functions import TruncDate
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.decorators import method_decorator
from rest_framework import generics, permissions
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import StudentProfile, User
from apps.core.ratelimit import ratelimit

from .models import BalanceAdjustment, CafeteriaBalance, CafeteriaTransaction, TopUpRequest
from .serializers import (
    AdjustmentInputSerializer,
    BalanceAdjustmentSerializer,
    CafeteriaBalanceSerializer,
    CafeteriaTransactionSerializer,
    LowBalanceThresholdSerializer,
    LoyverseProfileSerializer,
    RefundInputSerializer,
    TopUpLogSerializer,
    TopUpRequestSerializer,
)
from .services import (
    add_points_to_customer,
    adjust_balance,
    reconcile_balances,
    refund_transaction,
    sync_all_balances,
    sync_purchases,
    sync_student_balance,
)

logger = logging.getLogger(__name__)


class IsParentOrAdmin(permissions.BasePermission):
    """Family portal actors: parent, student (school-email / Loyverse self-guardian), or admin."""

    def has_permission(self, request, view):
        user = request.user
        return bool(user and user.is_authenticated
                    and user.role in (User.Role.PARENT, User.Role.STUDENT, User.Role.ADMIN))


def _can_manage_student_cafeteria(user, student: StudentProfile) -> bool:
    """True if ``user`` may top up / manage cafeteria for ``student``.

    Parents need an explicit guardian link. Students may act on their own profile
    (family login with ``ci…@interlaken.com.mx``) or when linked as a guardian
    (Loyverse import adds the student to ``student.parents``).
    """
    if user.role == User.Role.ADMIN:
        return True
    if user.role == User.Role.PARENT:
        return student.parents.filter(pk=user.pk).exists()
    if user.role == User.Role.STUDENT:
        try:
            if user.student_profile.pk == student.pk:
                return True
        except StudentProfile.DoesNotExist:
            pass
        return student.parents.filter(pk=user.pk).exists()
    return False


class IsAdmin(permissions.BasePermission):
    def has_permission(self, request, view):
        user = request.user
        return bool(user and user.is_authenticated and user.role == User.Role.ADMIN)


class MyBalanceView(APIView):
    """
    GET /api/v1/cafeteria/balance/
    Returns balance(s) for the authenticated user's children (parent)
    or the student's own balance (student role).
    """
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        user = request.user

        if user.role == User.Role.STUDENT:
            try:
                profile = user.student_profile
            except StudentProfile.DoesNotExist:
                return Response({'error': 'Perfil de alumno no encontrado.'}, status=404)
            balance, _ = CafeteriaBalance.objects.get_or_create(student=profile)
            return Response(CafeteriaBalanceSerializer(balance).data)

        if user.role == User.Role.PARENT:
            students = StudentProfile.objects.filter(parents=user)
        else:
            students = StudentProfile.objects.all()

        balances = [CafeteriaBalance.objects.get_or_create(student=s)[0] for s in students]
        return Response(CafeteriaBalanceSerializer(balances, many=True).data)


class MyTransactionsView(generics.ListAPIView):
    """GET /api/v1/cafeteria/transactions/?student=&type=&from=&to=

    Paginated (global PageNumberPagination) and scoped by role: students see their
    own history, parents see their children's, admins see all. Optional filters:
    ``type`` (purchase|topup|refund), ``from``/``to`` (ISO date, inclusive).
    """
    serializer_class = CafeteriaTransactionSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        params = self.request.query_params
        student_id = params.get('student')

        if user.role == User.Role.STUDENT:
            try:
                qs = CafeteriaTransaction.objects.filter(student=user.student_profile)
            except StudentProfile.DoesNotExist:
                return CafeteriaTransaction.objects.none()
        elif user.role == User.Role.PARENT:
            my_students = StudentProfile.objects.filter(parents=user)
            if student_id:
                my_students = my_students.filter(id=student_id)
            qs = CafeteriaTransaction.objects.filter(student__in=my_students)
        elif user.role == User.Role.ADMIN:
            qs = CafeteriaTransaction.objects.all()
            if student_id:
                qs = qs.filter(student_id=student_id)
        else:
            return CafeteriaTransaction.objects.none()

        tx_type = params.get('type')
        if tx_type in CafeteriaTransaction.TxType.values:
            qs = qs.filter(transaction_type=tx_type)

        date_from = params.get('from')
        if date_from:
            qs = qs.filter(date__date__gte=date_from)
        date_to = params.get('to')
        if date_to:
            qs = qs.filter(date__date__lte=date_to)

        return qs


class MySpendingTrendView(APIView):
    """GET /api/v1/cafeteria/spending-trend/?days=30

    Daily cafeteria spending (purchases) for the caller's students over the last
    N days (clamped 7-90), zero-filled so the series is continuous. Powers the
    parent dashboard sparkline; scoped by role like the other 'my' endpoints.
    """
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        user = request.user
        try:
            days = int(request.query_params.get('days', 30))
        except (TypeError, ValueError):
            days = 30
        days = max(7, min(days, 90))

        if user.role == User.Role.STUDENT:
            students = StudentProfile.objects.filter(user=user)
        elif user.role == User.Role.PARENT:
            students = StudentProfile.objects.filter(parents=user)
        elif user.role == User.Role.ADMIN:
            students = StudentProfile.objects.all()
        else:
            students = StudentProfile.objects.none()

        # Optional per-child scoping (multi-kid families) — `students` is already
        # family-scoped, so an id outside the family yields an empty queryset
        # (no cross-family leakage).
        student_id = request.query_params.get('student')
        if student_id:
            students = students.filter(id=student_id)

        today = timezone.localdate()
        start = today - timedelta(days=days - 1)

        rows = (
            CafeteriaTransaction.objects
            .filter(student__in=students,
                    transaction_type=CafeteriaTransaction.TxType.PURCHASE,
                    date__date__gte=start)
            .annotate(day=TruncDate('date'))
            .values('day')
            .annotate(total=models.Sum('amount'))
        )
        by_day = {r['day']: float(r['total'] or 0) for r in rows}

        series, total = [], 0.0
        for i in range(days):
            d = start + timedelta(days=i)
            amt = round(by_day.get(d, 0.0), 2)
            total += amt
            series.append({'date': d.isoformat(), 'amount': amt})

        return Response({
            'days': days,
            'total': round(total, 2),
            'average': round(total / days, 2) if days else 0.0,
            'series': series,
        })


class UpdateLowBalanceThresholdView(APIView):
    """PATCH /api/v1/cafeteria/balance/<student_pk>/threshold/  ``{threshold}``

    Lets a family set the saldo-bajo warning level for their own child (default
    $50). Scoped: a parent/student may only change their own children's
    threshold; admins may change any.
    """
    permission_classes = [permissions.IsAuthenticated]

    def patch(self, request, student_pk):
        user = request.user
        student = get_object_or_404(StudentProfile, pk=student_pk)

        if user.role in (User.Role.PARENT, User.Role.STUDENT):
            if not _can_manage_student_cafeteria(user, student):
                return Response({'error': 'No autorizado para este alumno.'}, status=403)
        elif user.role != User.Role.ADMIN:
            return Response({'error': 'No autorizado.'}, status=403)

        serializer = LowBalanceThresholdSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        balance, _ = CafeteriaBalance.objects.get_or_create(student=student)
        balance.low_balance_threshold = serializer.validated_data['threshold']
        balance.save(update_fields=['low_balance_threshold'])
        return Response(CafeteriaBalanceSerializer(balance).data)


@method_decorator(ratelimit('cafeteria-topup', '20/m', key='ip', method='POST'), name='dispatch')
class TopUpRequestCreateView(generics.CreateAPIView):
    """POST /api/v1/cafeteria/topup/  ``{student, amount, method, gateway?}``

    ``method=office`` records a pending request for an admin to apply at the school
    cashier (unchanged). ``method=online`` additionally creates a linked, pending
    ``Payment(type=cafeteria)`` and returns the gateway **redirect/HPP URL** the
    parent is sent to. The balance is only credited later, by the verified webhook
    (spec §2.2) — never here.
    """
    serializer_class = TopUpRequestSerializer
    permission_classes = [IsParentOrAdmin]

    def create(self, request, *args, **kwargs):
        from django.db import transaction

        from apps.payments.gateways import GATEWAY_CHOICES, get_gateway
        from apps.payments.models import Payment
        from apps.payments.services import reuse_or_clear_cafeteria_checkout

        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        student = serializer.validated_data['student']

        # Family may only top up linked children; admins may top up anyone.
        # Student-role school-email logins are self-guardians (see Loyverse import).
        user = request.user
        if not _can_manage_student_cafeteria(user, student):
            return Response({'error': 'No autorizado para este alumno.'}, status=403)

        method = serializer.validated_data.get('method') or TopUpRequest.Method.OFFICE
        if method == TopUpRequest.Method.ONLINE:
            gateway_name = (request.data.get('gateway') or '').lower() or None
            if gateway_name and gateway_name not in GATEWAY_CHOICES:
                return Response({'error': 'Pasarela de pago no válida.'}, status=400)
            gateway = get_gateway(gateway_name)
            amount = serializer.validated_data['amount']

            with transaction.atomic():
                existing = reuse_or_clear_cafeteria_checkout(
                    student, amount=amount, gateway_name=gateway.name)
                if existing is not None:
                    payment = existing
                    topup = payment.related_topup
                else:
                    topup = serializer.save()
                    if user.role == User.Role.ADMIN:
                        payer = student.parents.first() or user
                    else:
                        payer = user
                    payment = Payment.objects.create(
                        user=payer,
                        payment_type=Payment.Type.CAFETERIA,
                        amount=topup.amount,
                        description=f'Recarga cafetería — {student.user.full_name}',
                        gateway=gateway.name,
                        related_topup=topup,
                        status=Payment.Status.PENDING,
                    )

            data = dict(self.get_serializer(topup).data)
            try:
                redirect_url = gateway.create_checkout(payment)
            except Exception as e:
                logger.exception(
                    'create_checkout failed for cafeteria top-up payment=%s gateway=%s student=%s',
                    payment.id, gateway.name, student.id,
                )
                payment.mark_failed(e, stage='create_checkout')
                return Response({'error': f'No se pudo iniciar el pago: {e}'}, status=502)

            if not redirect_url:
                payment.mark_failed('gateway returned no checkout URL', stage='create_checkout')
                return Response({'error': 'No se pudo iniciar el pago.'}, status=502)

            data.update({
                'payment_id': payment.id,
                'gateway': gateway.name,
                'redirect_url': redirect_url,
            })
            headers = self.get_success_headers(data)
            return Response(data, status=201, headers=headers)

        topup = serializer.save()
        data = dict(self.get_serializer(topup).data)
        headers = self.get_success_headers(data)
        return Response(data, status=201, headers=headers)


class AdminBalancesView(generics.ListAPIView):
    """GET /api/v1/cafeteria/admin/balances/"""
    serializer_class = CafeteriaBalanceSerializer
    permission_classes = [IsAdmin]

    def get_queryset(self):
        return CafeteriaBalance.objects.select_related('student__user').all()


class AdminApplyTopUpView(APIView):
    """POST /api/v1/cafeteria/admin/topup/<pk>/apply/"""
    permission_classes = [IsAdmin]

    def post(self, request, pk):
        topup = get_object_or_404(TopUpRequest, pk=pk)

        if topup.status != TopUpRequest.Status.PENDING:
            return Response({'error': 'Esta recarga ya fue procesada.'}, status=400)

        # Only OFFICE (cash-at-the-counter) top-ups are applied manually. ONLINE
        # top-ups are credited exclusively by the signed gateway webhook
        # (complete_online_topup); applying one here would double-credit once the
        # webhook later settles the same payment — the two paths share no
        # idempotency key.
        if topup.method != TopUpRequest.Method.OFFICE:
            return Response(
                {'error': 'Las recargas en línea se acreditan automáticamente al '
                          'confirmarse el pago; no se aplican manualmente.'},
                status=400)

        # Guard against a non-positive request slipping through (older rows, or a
        # request created before the serializer floor existed): a negative amount
        # would DEBIT the child's balance.
        if topup.amount is None or topup.amount <= 0:
            return Response({'error': 'El monto de la recarga debe ser positivo.'},
                            status=400)

        student = topup.student
        if not student.loyverse_id:
            return Response({'error': 'Alumno sin ID de Loyverse configurado.'}, status=400)

        try:
            # Pass a stable reference so the credit writes a TOPUP ledger row and
            # is idempotent (re-applying the same request is a no-op) — without it
            # the balance moved with no CafeteriaTransaction, breaking the
            # balance-equals-ledger invariant and leaving no audit trail.
            add_points_to_customer(
                loyverse_customer_id=student.loyverse_id,
                points=topup.amount,
                note=f'Recarga en caja — #{topup.id}',
                reference=f'topup-request-{topup.id}',
            )
        except Exception as e:
            return Response({'error': str(e)}, status=502)

        topup.status = TopUpRequest.Status.COMPLETED
        topup.processed_at = timezone.now()
        topup.save(update_fields=['status', 'processed_at'])
        # NB: do NOT re-pull the balance from Loyverse here — add_points_to_customer
        # already credited the local ledger (the source of truth per R1); a sync
        # would overwrite that credit with the (un-writable) Loyverse points.

        return Response({'detail': 'Recarga aplicada correctamente.'})


@method_decorator(ratelimit('cafeteria-refresh', '6/m', key='user', method='POST'), name='dispatch')
class RefreshFromLoyverseView(APIView):
    """POST /api/v1/cafeteria/refresh/

    On-demand Loyverse purchase poll so parents/staff can pull the latest POS
    spend without waiting for cron. Rate-limited (6/min/user) to protect the
    Loyverse API. Idempotent — safe to spam.
    """
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        try:
            result = sync_purchases()
        except Exception as e:
            logger.exception('cafeteria refresh failed')
            return Response({'error': str(e)}, status=502)
        return Response({
            'detail': 'Sincronización con Loyverse completada.',
            'receipts': result.get('receipts', 0),
            'created': result.get('created', 0),
            'notified': result.get('notified', 0),
            'students': result.get('students', 0),
        })


class AdminSyncBalanceView(APIView):
    """POST /api/v1/cafeteria/admin/sync/<pk>/"""
    permission_classes = [IsAdmin]

    def post(self, request, pk):
        student = get_object_or_404(StudentProfile, pk=pk)
        try:
            new_balance = sync_student_balance(student)
            # Also pull any new POS purchases so the admin detail stays fresh.
            purchases = sync_purchases()
            return Response({
                'balance': str(new_balance),
                'purchases_created': purchases.get('created', 0),
            })
        except Exception as e:
            return Response({'error': str(e)}, status=502)


class AdminSyncAllView(APIView):
    """POST /api/v1/cafeteria/admin/sync-all/

    Seeds any missing opening balances AND polls Loyverse receipts so purchases
    + parent alerts catch up immediately (not just on the next cron tick).
    """
    permission_classes = [IsAdmin]

    def post(self, request):
        try:
            balances = sync_all_balances()
            purchases = sync_purchases()
            return Response({
                'detail': 'Sincronización completada.',
                'balances_ok': balances.get('synced', 0),
                'balances_failed': balances.get('failed', 0),
                'receipts': purchases.get('receipts', 0),
                'purchases_created': purchases.get('created', 0),
                'notified': purchases.get('notified', 0),
            })
        except Exception as e:
            return Response({'error': str(e)}, status=502)


# ── Admin console (Phase D) ──────────────────────────────────────────────────


class AdminTopUpLogView(generics.ListAPIView):
    """GET /api/v1/cafeteria/admin/topups/?status=&method=&from=&to=

    Deposits/top-up log: every ``TopUpRequest`` (office + online) enriched with its
    linked gateway ``Payment`` state. Paginated; filters by ``status``, ``method``
    and a ``from``/``to`` created-date range (spec §5).
    """
    serializer_class = TopUpLogSerializer
    permission_classes = [IsAdmin]

    def get_queryset(self):
        qs = (TopUpRequest.objects
              .select_related('student__user')
              .prefetch_related('payments')
              .all())
        params = self.request.query_params

        status_f = params.get('status')
        if status_f in TopUpRequest.Status.values:
            qs = qs.filter(status=status_f)

        method_f = params.get('method')
        if method_f in TopUpRequest.Method.values:
            qs = qs.filter(method=method_f)

        date_from = params.get('from')
        if date_from:
            qs = qs.filter(created_at__date__gte=date_from)
        date_to = params.get('to')
        if date_to:
            qs = qs.filter(created_at__date__lte=date_to)

        return qs


class AdminStudentDetailView(APIView):
    """GET /api/v1/cafeteria/admin/student/<pk>/

    Per-student console: balance, linked parents, full transaction ledger and the
    audit trail of manual adjustments/refunds (spec §5 "Per-student detail").
    """
    permission_classes = [IsAdmin]

    def get(self, request, pk):
        student = get_object_or_404(
            StudentProfile.objects.select_related('user', 'loyverse_profile'), pk=pk)
        balance, _ = CafeteriaBalance.objects.get_or_create(student=student)
        transactions = CafeteriaTransaction.objects.filter(student=student)[:200]
        adjustments = BalanceAdjustment.objects.filter(student=student)

        parents = [
            {'id': p.id, 'full_name': p.full_name, 'email': p.email, 'whatsapp': p.whatsapp}
            for p in student.parents.all()
        ]

        # Full Loyverse customer snapshot (visit history + lifetime spend), if
        # synced (sync_loyverse_profiles). Null when never synced.
        loyverse = getattr(student, 'loyverse_profile', None)

        return Response({
            'balance': CafeteriaBalanceSerializer(balance).data,
            'parents': parents,
            'transactions': CafeteriaTransactionSerializer(transactions, many=True).data,
            'adjustments': BalanceAdjustmentSerializer(adjustments, many=True).data,
            'loyverse': LoyverseProfileSerializer(loyverse).data if loyverse else None,
        })


class AdminAdjustBalanceView(APIView):
    """POST /api/v1/cafeteria/admin/adjust/<student_pk>/  ``{amount, reason}``

    Audited manual credit (+) or debit (−) to a student's balance. Writes a
    ``BalanceAdjustment`` and an ``ADJUSTMENT`` ledger row, then notifies parents.
    """
    permission_classes = [IsAdmin]

    def post(self, request, student_pk):
        student = get_object_or_404(StudentProfile, pk=student_pk)
        serializer = AdjustmentInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            adj = adjust_balance(
                student,
                serializer.validated_data['amount'],
                serializer.validated_data['reason'],
                admin=request.user,
            )
        except ValueError as e:
            return Response({'error': str(e)}, status=400)

        return Response(BalanceAdjustmentSerializer(adj).data, status=201)


class AdminRefundView(APIView):
    """POST /api/v1/cafeteria/admin/refund/<tx_pk>/  ``{reason?}``

    Reverse a transaction: undo its balance effect, mark any linked ``Payment``
    refunded, audit it, notify parents (spec §5 / §6.11).
    """
    permission_classes = [IsAdmin]

    def post(self, request, tx_pk):
        tx = get_object_or_404(CafeteriaTransaction, pk=tx_pk)
        serializer = RefundInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            adj = refund_transaction(
                tx,
                reason=serializer.validated_data.get('reason', ''),
                admin=request.user,
            )
        except ValueError as e:
            return Response({'error': str(e)}, status=400)

        return Response(BalanceAdjustmentSerializer(adj).data, status=201)


class AdminReconcileView(APIView):
    """GET /api/v1/cafeteria/admin/reconcile/

    Compare linked students' local ledger vs Loyverse points and flag drift.
    Paginated via ``?limit=`` / ``?offset=`` (default limit 50) so large rosters
    don't time out. ``?only=drift`` returns only the out-of-sync/errored rows
    within the page.
    """
    permission_classes = [IsAdmin]

    def get(self, request):
        try:
            limit = int(request.query_params.get('limit', 50))
        except (TypeError, ValueError):
            limit = 50
        try:
            offset = int(request.query_params.get('offset', 0))
        except (TypeError, ValueError):
            offset = 0

        batch = reconcile_balances(limit=limit, offset=offset)
        rows = batch['rows']

        def _ser(r):
            return {
                **r,
                'local_balance': str(r['local_balance']),
                'loyverse_balance': None if r['loyverse_balance'] is None else str(r['loyverse_balance']),
                'drift': None if r['drift'] is None else str(r['drift']),
            }

        data = [_ser(r) for r in rows]
        if request.query_params.get('only') == 'drift':
            data = [r for r in data if not r['in_sync']]

        return Response({
            'count': len(data),
            'drift_count': sum(1 for r in data if not r['in_sync']),
            'checked': batch['checked'],
            'total': batch['total'],
            'offset': batch['offset'],
            'limit': batch['limit'],
            'has_more': batch['has_more'],
            'results': data,
        })


class AdminLowBalanceView(APIView):
    """GET /api/v1/cafeteria/admin/low-balance/

    Students whose balance is at or below their low-balance threshold, for
    proactive outreach (spec §5).
    """
    permission_classes = [IsAdmin]

    def get(self, request):
        balances = (CafeteriaBalance.objects
                    .select_related('student__user')
                    .filter(balance__lte=models.F('low_balance_threshold'))
                    .order_by('balance'))
        return Response(CafeteriaBalanceSerializer(balances, many=True).data)


class ParentExportView(APIView):
    """GET /api/v1/cafeteria/export/

    CSV of cafeteria transactions for children linked to the authenticated user
    (``user.children``). Parents, student-role family logins (self-guardian),
    and admins may call it.
    """
    permission_classes = [IsParentOrAdmin]

    def get(self, request):
        from . import exports

        user = request.user
        if user.role not in (User.Role.PARENT, User.Role.STUDENT, User.Role.ADMIN):
            return Response({'error': 'No autorizado.'}, status=403)
        return exports.parent_family_statement_csv(user)


class AdminExportStudentView(APIView):
    """GET /api/v1/cafeteria/admin/export/student/<pk>/?fmt=csv|pdf"""
    permission_classes = [IsAdmin]

    def get(self, request, pk):
        from . import exports

        student = get_object_or_404(
            StudentProfile.objects.select_related('user'), pk=pk)
        fmt = (request.query_params.get('fmt') or 'csv').lower()
        if fmt == 'pdf':
            return exports.student_statement_pdf(student)
        return exports.student_statement_csv(student)


class AdminExportSchoolView(APIView):
    """GET /api/v1/cafeteria/admin/export/school/?fmt=csv|pdf"""
    permission_classes = [IsAdmin]

    def get(self, request):
        from . import exports

        fmt = (request.query_params.get('fmt') or 'csv').lower()
        if fmt == 'pdf':
            return exports.school_statement_pdf()
        return exports.school_statement_csv()
