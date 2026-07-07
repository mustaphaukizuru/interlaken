"""
Cafeteria views: balance, transactions, top-up requests, admin sync operations.
"""
from django.utils import timezone
from django.utils.decorators import method_decorator
from django.shortcuts import get_object_or_404
from rest_framework import generics, permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.ratelimit import ratelimit
from apps.accounts.models import User, StudentProfile
from .models import CafeteriaBalance, CafeteriaTransaction, TopUpRequest
from .serializers import CafeteriaBalanceSerializer, CafeteriaTransactionSerializer, TopUpRequestSerializer
from .services import sync_student_balance, sync_all_balances, add_points_to_customer


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
    """GET /api/v1/cafeteria/transactions/"""
    serializer_class = CafeteriaTransactionSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        student_id = self.request.query_params.get('student')

        if user.role == User.Role.STUDENT:
            try:
                return CafeteriaTransaction.objects.filter(student=user.student_profile)
            except StudentProfile.DoesNotExist:
                return CafeteriaTransaction.objects.none()

        if user.role == User.Role.PARENT:
            my_students = StudentProfile.objects.filter(parents=user)
            if student_id:
                my_students = my_students.filter(id=student_id)
            return CafeteriaTransaction.objects.filter(student__in=my_students)

        if user.role == User.Role.ADMIN:
            qs = CafeteriaTransaction.objects.all()
            if student_id:
                qs = qs.filter(student_id=student_id)
            return qs

        return CafeteriaTransaction.objects.none()


@method_decorator(ratelimit('cafeteria-topup', '20/m', key='ip', method='POST'), name='dispatch')
class TopUpRequestCreateView(generics.CreateAPIView):
    """POST /api/v1/cafeteria/topup/"""
    serializer_class = TopUpRequestSerializer
    permission_classes = [IsParentOrAdmin]


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
