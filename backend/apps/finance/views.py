"""
finance/views.py — parent tuition portal + admin finance console.

Parents see and pay only their own children's invoices; online payment reuses the
Prompt 10 gateway (the invoice flips to *paid* on the signed webhook, never here).
Admin endpoints expose the finance dashboard, per-student ledger and audited
manual actions (mark-paid / adjust / cancel / bulk).
"""
from decimal import Decimal

from django.db.models import F, Q, Sum
from django.shortcuts import get_object_or_404
from rest_framework import generics, permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import StudentProfile, User

from . import services
from .models import Discount, FeeSchedule, Invoice
from .serializers import (
    AdjustInvoiceInputSerializer,
    CancelInvoiceInputSerializer,
    DiscountSerializer,
    FeeScheduleSerializer,
    GenerateInvoicesInputSerializer,
    InvoiceAdjustmentSerializer,
    InvoiceListSerializer,
    InvoicePayInputSerializer,
    InvoiceSerializer,
    MarkPaidInputSerializer,
    RefundOverpaymentInputSerializer,
)


class IsAdmin(permissions.BasePermission):
    def has_permission(self, request, view):
        user = request.user
        # AnonymousUser is truthy but has no `.role`; `is_authenticated` is the
        # correct guard (a bare truthiness check would raise AttributeError -> 500).
        return bool(user and user.is_authenticated and user.role == User.Role.ADMIN)


class AdminFeeScheduleListCreateView(generics.ListCreateAPIView):
    """GET/POST /api/v1/finance/admin/fee-schedules/ — tuition plans (Planes)."""
    queryset = FeeSchedule.objects.all().order_by('-active', 'level', 'grade', 'name')
    serializer_class = FeeScheduleSerializer
    permission_classes = [IsAdmin]


class AdminFeeScheduleDetailView(generics.RetrieveUpdateDestroyAPIView):
    """PATCH (edit / toggle active) or DELETE a tuition plan."""
    queryset = FeeSchedule.objects.all()
    serializer_class = FeeScheduleSerializer
    permission_classes = [IsAdmin]
    http_method_names = ['get', 'patch', 'delete']


class AdminDiscountListCreateView(generics.ListCreateAPIView):
    """GET (?student=<id>) / POST /api/v1/finance/admin/discounts/ — becas & descuentos."""
    serializer_class = DiscountSerializer
    permission_classes = [IsAdmin]

    def get_queryset(self):
        qs = Discount.objects.select_related('student__user').order_by('-active', '-created_at')
        student = self.request.query_params.get('student')
        return qs.filter(student_id=student) if student else qs


class AdminDiscountDetailView(generics.RetrieveUpdateDestroyAPIView):
    """PATCH (edit / toggle) or DELETE a beca / descuento."""
    queryset = Discount.objects.all()
    serializer_class = DiscountSerializer
    permission_classes = [IsAdmin]
    http_method_names = ['get', 'patch', 'delete']


def _parent_invoices(user):
    """Invoices visible to ``user`` in the family portal.

    Parents see linked children. Students also see their own ``StudentProfile``
    invoices (school-email family login), even when the self-guardian M2M row is
    missing — mirrors cafeteria ``_can_manage_student_cafeteria``. Admins see all.
    """
    if user.role == User.Role.ADMIN:
        return Invoice.objects.all()
    q = Q(student__parents=user)
    if user.role == User.Role.STUDENT:
        profile = StudentProfile.objects.filter(user_id=user.pk).only('pk').first()
        if profile is not None:
            q |= Q(student_id=profile.pk)
    return Invoice.objects.filter(q).distinct()


# ── Parent portal ─────────────────────────────────────────────────────────────

class MyInvoicesView(generics.ListAPIView):
    """GET /api/v1/finance/invoices/?student=&status=&period= — the parent's invoices."""
    serializer_class = InvoiceListSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        qs = (_parent_invoices(self.request.user)
              .select_related('student__user').distinct())
        params = self.request.query_params
        if params.get('student'):
            qs = qs.filter(student_id=params['student'])
        if params.get('status'):
            qs = qs.filter(status=params['status'])
        if params.get('period'):
            qs = qs.filter(period=params['period'])
        return qs.order_by('-period', 'student__user__last_name')


class InvoiceDetailView(generics.RetrieveAPIView):
    """GET /api/v1/finance/invoices/<pk>/ — full invoice with line items."""
    serializer_class = InvoiceSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return (_parent_invoices(self.request.user)
                .select_related('student__user').prefetch_related('line_items').distinct())


class InvoicePayView(APIView):
    """POST /api/v1/finance/invoices/<pk>/pay/  ``{gateway?}`` → hosted-page URL.

    Creates a pending payment linked to the invoice and returns the redirect URL.
    The balance is only settled later, by the verified webhook.
    """
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, pk):
        invoice = get_object_or_404(
            _parent_invoices(request.user).select_related('student__user'), pk=pk)

        serializer = InvoicePayInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        gateway = serializer.validated_data.get('gateway') or None

        try:
            payment, redirect_url = services.start_invoice_payment(invoice, request.user, gateway)
        except ValueError as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)
        except Exception as e:
            # Gateway / checkout failures: payment already mark_failed inside
            # start_invoice_payment when a row was created.
            return Response(
                {
                    'error': f'No se pudo iniciar el pago: {e}',
                    'detail': 'No se pudo iniciar el pago con el proveedor. Intenta de nuevo más tarde.',
                },
                status=status.HTTP_502_BAD_GATEWAY,
            )

        return Response({
            'payment_id': payment.id,
            'invoice_id': invoice.id,
            'amount': str(payment.amount),
            'gateway': payment.gateway,
            'redirect_url': redirect_url,
            'hpp_url': redirect_url,
        }, status=status.HTTP_201_CREATED)


class InvoiceReceiptView(APIView):
    """GET /api/v1/finance/invoices/<pk>/receipt/ — PDF receipt for a paid invoice."""
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, pk):
        invoice = get_object_or_404(
            _parent_invoices(request.user).select_related('student__user')
            .prefetch_related('line_items'), pk=pk)
        if invoice.status != Invoice.Status.PAID:
            return Response({'error': 'La factura aún no está pagada.'},
                            status=status.HTTP_400_BAD_REQUEST)
        from .receipts import invoice_receipt_pdf
        return invoice_receipt_pdf(invoice)


# ── Admin finance console ─────────────────────────────────────────────────────

class AdminDashboardView(APIView):
    """GET /api/v1/finance/admin/dashboard/?period= — revenue / outstanding / rate."""
    permission_classes = [IsAdmin]

    def get(self, request):
        period = request.query_params.get('period') or None
        return Response(services.dashboard_summary(period))


class AdminInvoiceListView(generics.ListAPIView):
    """GET /api/v1/finance/admin/invoices/?status=&period=&student=&grade=&q=

    ``status=overpaid`` is a pseudo-filter for invoices with ``amount_paid > amount``
    (saldo a favor / credit waiting on a manual refund).
    """
    serializer_class = InvoiceListSerializer
    permission_classes = [IsAdmin]

    def get_queryset(self):
        qs = Invoice.objects.select_related('student__user')
        p = self.request.query_params
        status_filter = p.get('status')
        if status_filter == 'overpaid':
            qs = qs.filter(amount_paid__gt=F('amount'))
        elif status_filter:
            qs = qs.filter(status=status_filter)
        if p.get('period'):
            qs = qs.filter(period=p['period'])
        if p.get('student'):
            qs = qs.filter(student_id=p['student'])
        if p.get('grade'):
            qs = qs.filter(student__grade=p['grade'])
        if p.get('q'):
            term = p['q']
            qs = qs.filter(Q(student__user__first_name__icontains=term)
                           | Q(student__user__last_name__icontains=term)
                           | Q(student__student_id__icontains=term))
        return qs.order_by('-period', 'student__user__last_name')


class AdminInvoiceDetailView(APIView):
    """GET /api/v1/finance/admin/invoices/<pk>/ — invoice + audit trail."""
    permission_classes = [IsAdmin]

    def get(self, request, pk):
        invoice = get_object_or_404(
            Invoice.objects.select_related('student__user').prefetch_related(
                'line_items', 'adjustments'), pk=pk)
        return Response({
            'invoice': InvoiceSerializer(invoice).data,
            'adjustments': InvoiceAdjustmentSerializer(
                invoice.adjustments.all(), many=True).data,
        })


class AdminStudentLedgerView(APIView):
    """GET /api/v1/finance/admin/student/<pk>/ — a student's invoices + balance owed."""
    permission_classes = [IsAdmin]

    def get(self, request, pk):
        student = get_object_or_404(StudentProfile.objects.select_related('user'), pk=pk)
        # Balance owed aggregated in SQL over the FULL history; the serialized
        # list is capped to the most recent 24 periods (2 school years) so one
        # long-tenured student can't balloon the response.
        outstanding = (student.invoices
                       .exclude(status=Invoice.Status.CANCELLED)
                       .aggregate(due=Sum(F('amount') - F('amount_paid')))['due']
                       or Decimal('0'))
        invoices = (student.invoices.select_related('student__user')
                    .prefetch_related('line_items').order_by('-period')[:24])
        return Response({
            'student': {
                'id': student.id, 'name': student.user.full_name,
                'student_code': student.student_id,
                'grade': f'{student.grade} {student.group}'.strip(),
            },
            'outstanding': f'{outstanding:.2f}',
            'invoices': InvoiceSerializer(invoices, many=True).data,
        })


class AdminMarkPaidView(APIView):
    """POST /api/v1/finance/admin/invoices/<pk>/mark-paid/ — audited manual settle."""
    permission_classes = [IsAdmin]

    def post(self, request, pk):
        invoice = get_object_or_404(Invoice.objects.select_related('student__user'), pk=pk)
        serializer = MarkPaidInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        adj = services.mark_invoice_paid(
            invoice,
            reason=serializer.validated_data.get('reason', ''),
            admin=request.user,
            method=serializer.validated_data.get('method') or 'efectivo',
        )
        if adj is None:
            return Response({'detail': 'La factura ya estaba pagada.'})
        invoice.refresh_from_db()
        return Response(InvoiceSerializer(invoice).data)


class AdminAdjustInvoiceView(APIView):
    """POST /api/v1/finance/admin/invoices/<pk>/adjust/  ``{amount, reason}`` (audited)."""
    permission_classes = [IsAdmin]

    def post(self, request, pk):
        invoice = get_object_or_404(Invoice.objects.select_related('student__user'), pk=pk)
        serializer = AdjustInvoiceInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            services.adjust_invoice(
                invoice, serializer.validated_data['amount'],
                serializer.validated_data['reason'], admin=request.user)
        except ValueError as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)
        invoice.refresh_from_db()
        return Response(InvoiceSerializer(invoice).data)


class AdminCancelInvoiceView(APIView):
    """POST /api/v1/finance/admin/invoices/<pk>/cancel/  ``{reason}`` (audited)."""
    permission_classes = [IsAdmin]

    def post(self, request, pk):
        invoice = get_object_or_404(Invoice.objects.select_related('student__user'), pk=pk)
        serializer = CancelInvoiceInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            adj = services.cancel_invoice(
                invoice, serializer.validated_data['reason'], admin=request.user)
        except ValueError as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)
        if adj is None:
            return Response({'detail': 'La factura ya estaba cancelada.'})
        invoice.refresh_from_db()
        return Response(InvoiceSerializer(invoice).data)


class AdminRefundOverpaymentView(APIView):
    """POST /api/v1/finance/admin/invoices/<pk>/refund/  ``{reason, payment_id?}``.

    Records an offline refund of an applied online overpayment: Payment→REFUNDED,
    invoice credit reversed, audited. Provider capture is not contacted.
    """
    permission_classes = [IsAdmin]

    def post(self, request, pk):
        invoice = get_object_or_404(Invoice.objects.select_related('student__user'), pk=pk)
        serializer = RefundOverpaymentInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            services.refund_invoice_overpayment(
                invoice,
                payment_id=serializer.validated_data.get('payment_id'),
                reason=serializer.validated_data['reason'],
                admin=request.user,
            )
        except ValueError as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)
        invoice.refresh_from_db()
        return Response(InvoiceSerializer(invoice).data)


class AdminGenerateInvoicesView(APIView):
    """POST /api/v1/finance/admin/generate/  ``{period?}`` — run generation (idempotent)."""
    permission_classes = [IsAdmin]

    def post(self, request):
        serializer = GenerateInvoicesInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        period = serializer.validated_data.get('period') or None
        return Response(services.generate_invoices(period), status=status.HTTP_200_OK)


class AdminBulkActionView(APIView):
    """POST /api/v1/finance/admin/bulk/  ``{invoice_ids: [], action, reason?}``.

    Supported ``action``: ``mark_paid``, ``cancel``, ``remind``. Applies the same
    audited service call to each invoice; returns per-invoice results.
    """
    permission_classes = [IsAdmin]

    def post(self, request):
        ids = request.data.get('invoice_ids') or []
        action = request.data.get('action')
        reason = request.data.get('reason', '') or 'Acción masiva'
        if not isinstance(ids, list) or not ids:
            return Response({'error': 'invoice_ids requerido.'}, status=400)
        if action not in ('mark_paid', 'cancel', 'remind'):
            return Response({'error': 'Acción no válida.'}, status=400)

        invoices = Invoice.objects.select_related('student__user').filter(pk__in=ids)
        done = failed = skipped = 0
        for invoice in invoices:
            try:
                if action == 'mark_paid':
                    services.mark_invoice_paid(invoice, reason=reason, admin=request.user)
                elif action == 'cancel':
                    services.cancel_invoice(invoice, reason=reason, admin=request.user)
                else:  # remind — only invoices that actually owe money
                    if (invoice.status == Invoice.Status.CANCELLED
                            or invoice.balance_due <= 0):
                        skipped += 1
                        continue  # don't send a "$0.00 saldo" reminder
                    services._notify_invoice(
                        invoice, 'Recordatorio de colegiatura',
                        (f'Le recordamos que la colegiatura de '
                         f'{services._period_label(invoice.period)} de '
                         f'{invoice.student.user.full_name} tiene un saldo de '
                         f'${invoice.balance_due:.2f}.'), whatsapp=True)
                done += 1
            except ValueError:
                failed += 1
        return Response({'action': action, 'done': done, 'failed': failed,
                         'skipped': skipped})
