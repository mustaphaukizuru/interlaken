"""
Portal views: role-aware dashboard, announcements, notifications.
"""
import logging

from django.db.models import Count, Q, Sum
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.decorators import method_decorator
from rest_framework import generics, permissions
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import StudentProfile, User
from apps.admissions.models import PreRegistration, Registration
from apps.cafeteria.models import CafeteriaBalance
from apps.core.ratelimit import ratelimit
from apps.payments.models import Payment

from .models import Announcement, AnnouncementComment, AnnouncementRead, Notification
from .serializers import (
    AnnouncementAdminSerializer,
    AnnouncementCommentSerializer,
    AnnouncementSerializer,
    NotificationSerializer,
)
from .services import emergency_broadcast, fanout_and_stamp


def audiences_for_user(user):
    """Announcement audiences visible to ``user`` (always includes 'all').

    Families are a merged parent/student login (a self-guardian student is in
    its own ``parents`` set), so a family account sees BOTH parent- and
    student-targeted comunicados regardless of the single role it carries —
    otherwise a parent-role family silently misses 'Alumnos' avisos and a
    student-role family misses 'Padres' ones. Staff/admin oversee every audience.
    """
    audiences = [Announcement.Audience.ALL]
    role = getattr(user, 'role', None)
    if role in (User.Role.PARENT, User.Role.STUDENT):
        audiences += [Announcement.Audience.PARENTS, Announcement.Audience.STUDENTS]
    elif role == User.Role.STAFF:
        audiences.append(Announcement.Audience.STAFF)
    elif role == User.Role.ADMIN:
        audiences += [Announcement.Audience.PARENTS, Announcement.Audience.STUDENTS,
                      Announcement.Audience.STAFF]
    return audiences


class DashboardView(APIView):
    """GET /api/v1/portal/dashboard/ — Role-aware summary."""
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        user = request.user
        data = {}

        # student == family login (shared account): a self-guardian student is in
        # its own `parents` set, so anyone who guards students — a parent OR a
        # self-guardian student — gets the full family dashboard.
        family_students = StudentProfile.objects.filter(parents=user).select_related('user')
        if user.role in (User.Role.PARENT, User.Role.STUDENT) and family_students.exists():
            students = family_students
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
        ).annotate(
            visible_comment_count=Count('comments', filter=Q(comments__is_hidden=False)),
        )


class AnnouncementDetailView(generics.RetrieveAPIView):
    """GET /api/v1/portal/announcements/<pk>/ — one comunicado (audience-scoped)."""
    serializer_class = AnnouncementSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return Announcement.objects.filter(
            is_active=True,
            audience__in=audiences_for_user(self.request.user),
        ).annotate(
            visible_comment_count=Count('comments', filter=Q(comments__is_hidden=False)),
        )


class AnnouncementCommentListCreateView(generics.ListCreateAPIView):
    """GET / POST /api/v1/portal/announcements/<pk>/comments/

    Families can read and post replies on any comunicado they can see; hidden
    (moderated) comments are never listed. The author is the current user.
    """
    serializer_class = AnnouncementCommentSerializer
    permission_classes = [permissions.IsAuthenticated]

    def _announcement(self):
        # 404s (not 403) if the comunicado isn't visible to this family — never
        # leaks the existence of an announcement targeted at another audience.
        return get_object_or_404(
            Announcement.objects.filter(
                is_active=True,
                audience__in=audiences_for_user(self.request.user)),
            pk=self.kwargs['pk'])

    def get_queryset(self):
        return AnnouncementComment.objects.filter(
            announcement=self._announcement(), is_hidden=False,
        ).select_related('author')

    def perform_create(self, serializer):
        serializer.save(announcement=self._announcement(), author=self.request.user)


class _IsAdmin(permissions.BasePermission):
    def has_permission(self, request, view):
        u = request.user
        return bool(u and u.is_authenticated and getattr(u, 'role', '') == User.Role.ADMIN)


class AnnouncementAdminListCreateView(generics.ListCreateAPIView):
    """GET /api/v1/portal/admin/announcements/ — all comunicados (incl. inactive).
    POST — compose a new audience-targeted comunicado (author = current admin)."""
    queryset = Announcement.objects.all()
    serializer_class = AnnouncementAdminSerializer
    permission_classes = [_IsAdmin]

    def perform_create(self, serializer):
        announcement = serializer.save(created_by=self.request.user)
        # Alert the audience (in-app). Fail-soft: a fan-out hiccup must never
        # turn a saved comunicado into a 500. Drafts (is_active=False) notify
        # nobody until published (see perform_update on activate).
        if not announcement.is_active:
            return
        try:
            fanout_and_stamp(announcement)
        except Exception:  # noqa: BLE001 — best-effort notification
            logging.getLogger(__name__).exception(
                'Announcement %s fan-out failed', announcement.pk)


class AnnouncementAdminDetailView(generics.RetrieveUpdateDestroyAPIView):
    """PATCH (edit / toggle active) or DELETE a comunicado (admin)."""
    queryset = Announcement.objects.all()
    serializer_class = AnnouncementAdminSerializer
    permission_classes = [_IsAdmin]
    http_method_names = ['get', 'patch', 'delete']

    def perform_update(self, serializer):
        previous = self.get_object()
        was_active = previous.is_active
        already_fanned = previous.fanout_at is not None
        announcement = serializer.save()
        # First-time publish of a draft: fan out once. Re-activate after a
        # prior fan-out must not spam the audience again.
        if announcement.is_active and not was_active and not already_fanned:
            try:
                fanout_and_stamp(announcement)
            except Exception:  # noqa: BLE001 — best-effort notification
                logging.getLogger(__name__).exception(
                    'Announcement %s activate fan-out failed', announcement.pk)


class NotificationListView(generics.ListAPIView):
    """GET /api/v1/portal/notifications/"""
    serializer_class = NotificationSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return Notification.objects.filter(user=self.request.user)


class AnnouncementMarkReadView(APIView):
    """
    POST /api/v1/portal/announcements/mark-read/  {"ids": [1, 2]}
    Idempotent read receipts; only announcements the caller can actually
    see (active + matching audience) are recorded.
    """
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        ids = request.data.get('ids')
        if (not isinstance(ids, list) or not ids
                or not all(isinstance(i, int) for i in ids)):
            return Response({'error': 'ids debe ser una lista de enteros.'}, status=400)

        visible = list(Announcement.objects.filter(
            id__in=ids[:50], is_active=True,
            audience__in=audiences_for_user(request.user),
        ).values_list('id', flat=True))
        AnnouncementRead.objects.bulk_create(
            [AnnouncementRead(announcement_id=a, user=request.user) for a in visible],
            ignore_conflicts=True,
        )
        return Response({'marked': len(visible)})


class NotificationMarkReadView(APIView):
    """POST|PATCH /api/v1/portal/notifications/<pk>/read/"""
    permission_classes = [permissions.IsAuthenticated]

    def _mark(self, request, pk):
        try:
            notif = Notification.objects.get(pk=pk, user=request.user)
            notif.is_read = True
            notif.save(update_fields=['is_read'])
            return Response({'detail': 'Marcada como leída.'})
        except Notification.DoesNotExist:
            return Response({'error': 'No encontrada.'}, status=404)

    def post(self, request, pk):
        return self._mark(request, pk)

    def patch(self, request, pk):
        return self._mark(request, pk)


class NotificationMarkAllReadView(APIView):
    """POST /api/v1/portal/notifications/mark-all-read/"""
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        updated = (Notification.objects
                   .filter(user=request.user, is_read=False)
                   .update(is_read=True))
        return Response({'marked': updated})


@method_decorator(ratelimit('emergency-broadcast', '3/m', key='user', method='POST'), name='dispatch')
class EmergencyBroadcastView(APIView):
    """POST /api/v1/portal/admin/broadcast/

    Urgent school-wide aviso: creates a Comunicado, fans out WARNING
    notifications, immediately dispatches a first email/push batch, and
    optionally WhatsApp-blasts numbers on file (capped). Remaining email/push
    is finished by the ``dispatch_notifications`` cron.
    """
    permission_classes = [_IsAdmin]

    def post(self, request):
        title = request.data.get('title')
        message = request.data.get('message') or request.data.get('body')
        audience = (request.data.get('audience') or Announcement.Audience.PARENTS).strip()
        whatsapp = str(request.data.get('whatsapp', '0')).lower() in (
            '1', 'true', 'si', 'sí', 'yes')
        try:
            result = emergency_broadcast(
                title=title,
                message=message,
                audience=audience,
                created_by=request.user,
                whatsapp=whatsapp,
            )
        except ValueError as exc:
            return Response({'error': str(exc)}, status=400)
        return Response(result, status=201)
