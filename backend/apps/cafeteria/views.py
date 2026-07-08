"""
Cafeteria views: balance, transactions, top-up requests, admin sync operations.
"""
from django.db import models
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.decorators import method_decorator
from rest_framework import generics, permissions
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import StudentProfile, User
from apps.core.ratelimit import ratelimit

from .models import (BalanceAdjustment, CafeteriaBalance, CafeteriaTransaction,
                     TopUpRequest)
from .serializers import (
    AdjustmentInputSerializer,
    BalanceAdjustmentSerializer,
    CafeteriaBalanceSerializer,
    CafeteriaTransactionSerializer,
    RefundInputSerializer,
    TopUpLogSerializer,
    TopUpRequestSerializer,
)
from .services import (add_points_to_customer, adjust_balance, reconcile_balances,
                       refund_transaction, sync_all_balances, sync_student_balance)


class IsParentOrAdmin(permissions.BasePermission):
    def has_permission(self, request, view):
        return request.user.role in (User.Role.PARENT, User.Role.ADMIN)


class IsAdmin(permissions.BasePermission):
    def has_permission(self, request, view):
        return request.user.role == User.Role.ADMIN


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
        from apps.payments.gateways import GATEWAY_CHOICES, get_gateway
        from apps.payments.models import Payment

        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        student = serializer.validated_data['student']

        # A parent may only top up their own children (admins may top up anyone).
        user = request.user
        if user.role == User.Role.PARENT and not student.parents.filter(pk=user.pk).exists():
            return Response({'error': 'No autorizado para este alumno.'}, status=403)

        topup = serializer.save()
        data = dict(self.get_serializer(topup).data)

        if topup.method == TopUpRequest.Method.ONLINE:
            gateway_name = (request.data.get('gateway') or '').lower() or None
            if gateway_name and gateway_name not in GATEWAY_CHOICES:
                return Response({'error': 'Pasarela de pago no válida.'}, status=400)
            gateway = get_gateway(gateway_name)

            payer = user if user.role == User.Role.PARENT else (student.parents.first() or user)
            payment = Payment.objects.create(
                user=payer,
                payment_type=Payment.Type.CAFETERIA,
                amount=topup.amount,
                description=f'Recarga cafetería — {student.user.full_name}',
                gateway=gateway.name,
                related_topup=topup,
                status=Payment.Status.PENDING,
            )
            try:
                redirect_url = gateway.create_checkout(payment)
            except Exception as e:
                return Response({'error': f'No se pudo iniciar el pago: {e}'}, status=502)

            data.update({
                'payment_id': payment.id,
                'gateway': gateway.name,
                'redirect_url': redirect_url,
            })

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

        student = topup.student
        if not student.loyverse_id:
            return Response({'error': 'Alumno sin ID de Loyverse configurado.'}, status=400)

        try:
            add_points_to_customer(
                loyverse_customer_id=student.loyverse_id,
                points=float(topup.amount),
                note=f'Recarga portal — #{topup.id}',
            )
        except Exception as e:
            return Response({'error': str(e)}, status=502)

        topup.status = TopUpRequest.Status.COMPLETED
        topup.processed_at = timezone.now()
        topup.save(update_fields=['status', 'processed_at'])
        sync_student_balance(student)

        return Response({'detail': 'Recarga aplicada correctamente.'})


class AdminSyncBalanceView(APIView):
    """POST /api/v1/cafeteria/admin/sync/<pk>/"""
    permission_classes = [IsAdmin]

    def post(self, request, pk):
        student = get_object_or_404(StudentProfile, pk=pk)
        try:
            new_balance = sync_student_balance(student)
            return Response({'balance': str(new_balance)})
        except Exception as e:
            return Response({'error': str(e)}, status=502)


class AdminSyncAllView(APIView):
    """POST /api/v1/cafeteria/admin/sync-all/"""
    permission_classes = [IsAdmin]

    def post(self, request):
        try:
            sync_all_balances()
            return Response({'detail': 'Sincronización completada.'})
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
            StudentProfile.objects.select_related('user'), pk=pk)
        balance, _ = CafeteriaBalance.objects.get_or_create(student=student)
        transactions = CafeteriaTransaction.objects.filter(student=student)[:200]
        adjustments = BalanceAdjustment.objects.filter(student=student)

        parents = [
            {'id': p.id, 'full_name': p.full_name, 'email': p.email, 'whatsapp': p.whatsapp}
            for p in student.parents.all()
        ]

        return Response({
            'balance': CafeteriaBalanceSerializer(balance).data,
            'parents': parents,
            'transactions': CafeteriaTransactionSerializer(transactions, many=True).data,
            'adjustments': BalanceAdjustmentSerializer(adjustments, many=True).data,
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

    Compare each linked student's local ledger vs Loyverse points and flag drift.
    ``?only=drift`` returns only the out-of-sync/errored rows.
    """
    permission_classes = [IsAdmin]

    def get(self, request):
        rows = reconcile_balances()

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
