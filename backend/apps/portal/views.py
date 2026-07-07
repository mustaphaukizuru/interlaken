"""
Portal views: role-aware dashboard, announcements, notifications.
"""
from django.db.models import Sum
from rest_framework import generics, permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import User, StudentProfile
from apps.cafeteria.models import CafeteriaBalance
from apps.payments.models import Payment
from apps.admissions.models import PreRegistration, Registration
from .models import Announcement, Notification
from .serializers import AnnouncementSerializer, NotificationSerializer


# `User.Role` values are singular (`parent`) while `Announcement.Audience`
# values are plural (`parents`); map between them so audience filters match.
ROLE_TO_AUDIENCE = {
    User.Role.PARENT:  Announcement.Audience.PARENTS,
    User.Role.STUDENT: Announcement.Audience.STUDENTS,
    User.Role.STAFF:   Announcement.Audience.STAFF,
}


def audiences_for_user(user):
    """Return the announcement audiences visible to `user` (always includes 'all')."""
    audiences = [Announcement.Audience.ALL]
    mapped = ROLE_TO_AUDIENCE.get(user.role)
    if mapped:
        audiences.append(mapped)
    return audiences


class DashboardView(APIView):
    """GET /api/v1/portal/dashboard/ — Role-aware summary."""
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        user = request.user
        data = {}

        if user.role == User.Role.PARENT:
            students = StudentProfile.objects.filter(parents=user).select_related('user')
            balances = CafeteriaBalance.objects.filter(student__in=students)
            recent_payments = Payment.objects.filter(user=user).order_by('-created_at')[:5]

            data = {
                'children_count': students.count(),
                'children': [
                    {
                        'id': s.id,
                        'name': s.user.full_name,
                        'grade': s.grade,
                        'group': s.group,
                        'student_id': s.student_id,
                    }
                    for s in students
                ],
                'cafeteria_balances': [
                    {
                        'student_name': b.student.user.full_name,
                        'balance': str(b.balance),
                        'low': b.is_low_balance,
                        'last_synced': b.last_synced,
                    }
                    for b in balances
                ],
                'recent_payments': [
                    {
                        'id': p.id,
                        'type': p.payment_type,
                        'amount': str(p.amount),
                        'status': p.status,
                        'date': p.created_at,
                    }
                    for p in recent_payments
                ],
            }

        elif user.role == User.Role.STUDENT:
            try:
                profile = user.student_profile
                balance, _ = CafeteriaBalance.objects.get_or_create(student=profile)
                data = {
                    'student_id': profile.student_id,
                    'grade': profile.grade,
                    'group': profile.group,
                    'cafeteria_balance': str(balance.balance),
                    'is_low_balance': balance.is_low_balance,
                }
            except StudentProfile.DoesNotExist:
                data = {}

        elif user.role == User.Role.ADMIN:
            total_revenue = Payment.objects.filter(
                status=Payment.Status.SUCCESS
            ).aggregate(total=Sum('amount'))['total'] or 0

            data = {
                'total_students': StudentProfile.objects.count(),
                'total_users': User.objects.count(),
                'pending_preregistrations': PreRegistration.objects.filter(status='pending').count(),
                'pending_registrations': Registration.objects.filter(status='submitted').count(),
                'pending_payments': Payment.objects.filter(status=Payment.Status.PENDING).count(),
                'total_revenue': str(total_revenue),
            }

        # Common: announcements + unread notifications
        announcements = Announcement.objects.filter(
            is_active=True, audience__in=audiences_for_user(user)
        )[:5]
        data['announcements'] = AnnouncementSerializer(announcements, many=True).data
        data['unread_notifications'] = Notification.objects.filter(user=user, is_read=False).count()

        return Response(data)


class AnnouncementListView(generics.ListAPIView):
    """GET /api/v1/portal/announcements/"""
    serializer_class = AnnouncementSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return Announcement.objects.filter(
            is_active=True,
            audience__in=audiences_for_user(self.request.user),
        )


class NotificationListView(generics.ListAPIView):
    """GET /api/v1/portal/notifications/"""
    serializer_class = NotificationSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return Notification.objects.filter(user=self.request.user)


class NotificationMarkReadView(APIView):
    """PATCH /api/v1/portal/notifications/<pk>/read/"""
    permission_classes = [permissions.IsAuthenticated]

    def patch(self, request, pk):
        try:
            notif = Notification.objects.get(pk=pk, user=request.user)
            notif.is_read = True
            notif.save(update_fields=['is_read'])
            return Response({'detail': 'Marcada como leída.'})
        except Notification.DoesNotExist:
            return Response({'error': 'No encontrada.'}, status=404)
