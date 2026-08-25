"""
Portal views: role-aware dashboard, announcements, notifications.
"""
import logging

from django.db.models import Count, Exists, OuterRef, Q, Sum
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.decorators import method_decorator
from rest_framework import generics, permissions
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import StudentProfile, User
from apps.admissions.models import PreRegistration, Registration
from apps.cafeteria.models import CafeteriaBalance
from apps.core.permissions import IsAdmin
from apps.core.ratelimit import ratelimit
from apps.payments.models import Payment

from .models import Announcement, AnnouncementComment, AnnouncementRead, Notification
from .serializers import (
    AnnouncementAdminSerializer,
    AnnouncementCommentSerializer,
    AnnouncementSerializer,
    NotificationSerializer,
)
from .services import _audience_roles, emergency_broadcast, fanout_and_stamp


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

        # Family portal: parents via guardian M2M; school-email students via M2M
        # self-guardian OR their own StudentProfile (defense when M2M is missing).
        family_students = list(
            StudentProfile.objects.filter(parents=user).select_related('user')
        )
        if user.role == User.Role.STUDENT and not family_students:
            own = (
                StudentProfile.objects.filter(user_id=user.pk)
                .select_related('user')
                .first()
            )
            if own is not None:
                family_students = [own]

        if user.role in (User.Role.PARENT, User.Role.STUDENT):
            students = family_students
            balances = (CafeteriaBalance.objects.filter(student__in=students)
                        .select_related('student__user'))
            # Same visibility as payments_visible_to, but reusing the in-hand
            # students list instead of re-joining the guardian M2M per row.
            recent_payments = (
                Payment.objects.filter(
                    Q(user=user) | Q(related_topup__student__in=students)
                ).distinct().order_by('-created_at')[:5]
                if students
                else []
            )

            data = {
                'children_count': len(students),
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
                # Stable signal for the SPA: valid login, no linked StudentProfile yet.
                'needs_family_link': not bool(students),
            }

        elif user.role == User.Role.ADMIN:
            # BACKLOG P1-H5: cafetería is the only money path, so the KPIs are
            # wallet health + the operational queues, not tuition revenue.
            from django.db.models import F
            from django.utils import timezone as tz

            from apps.accounts.models import PasswordRequest
            from apps.bookings.models import Booking
            from apps.cafeteria.models import TopUpRequest
            from apps.core.models import AuditLog, ContactMessage

            now = tz.localtime()
            month_revenue = Payment.objects.filter(
                status=Payment.Status.SUCCESS, created_at__year=now.year, created_at__month=now.month,
            ).aggregate(total=Sum('amount'))['total'] or 0
            active_balances = CafeteriaBalance.objects.filter(student__is_active=True)
            data = {
                'total_students': StudentProfile.objects.filter(is_active=True).count(),
                'total_users': User.objects.count(),
                'pending_preregistrations': PreRegistration.objects.filter(status='pending').count(),
                'pending_registrations': Registration.objects.filter(status='submitted').count(),
                'pending_payments': Payment.objects.filter(status=Payment.Status.PENDING).count(),
                'total_revenue': str(month_revenue),
                'cafeteria_total_balance': str(active_balances.aggregate(t=Sum('balance'))['t'] or 0),
                'low_balance_count': active_balances.filter(balance__lte=F('low_balance_threshold')).count(),
                'pending_topups': TopUpRequest.objects.filter(status=TopUpRequest.Status.PENDING).count(),
                'visits_today': Booking.objects.filter(slot__date=now.date()).exclude(status='cancelled').count()
                if hasattr(Booking, 'slot') else 0,
                'open_password_requests': PasswordRequest.objects.filter(status=PasswordRequest.Status.OPEN).count(),
                'unhandled_messages': ContactMessage.objects.filter(is_handled=False).count(),
                'recent_activity': [
                    {'id': a.id, 'when': a.created_at, 'actor': a.actor_label or (a.actor.email if a.actor else 'sistema'),
                     'action': a.action, 'object_type': a.object_type, 'object_id': a.object_id, 'context': a.context}
                    for a in AuditLog.objects.select_related('actor').order_by('-created_at')[:8]
                ],
            }

        # Common: announcements + unread notifications
        announcements = Announcement.objects.filter(
            is_active=True, audience__in=audiences_for_user(user)
        ).annotate(
            visible_comment_count=Count('comments', filter=Q(comments__is_hidden=False)),
            # Annotated here too, so passing the request (needed for the correct
            # 'acknowledged' value) does not cost one EXISTS per announcement.
            acknowledged_ann=Exists(AnnouncementRead.objects.filter(
                announcement=OuterRef('pk'), user=user, acknowledged_at__isnull=False)),
        )[:5]
        data['announcements'] = AnnouncementSerializer(announcements, many=True, context={'request': request}).data
        data['unread_notifications'] = Notification.objects.filter(user=user, is_read=False).count()

        return Response(data)


SITE_NOTICES_CACHE = 'portal:site-notices'


class SiteNoticesView(APIView):
    """GET /portal/avisos/ — public banner notices (BACKLOG P3-9): active announcements
    flagged "publicar en el sitio", not past site_until. Cached 5 min; saving an
    announcement clears the cache."""
    permission_classes = [permissions.AllowAny]

    def get(self, request):
        from django.core.cache import cache
        from django.utils import timezone

        data = cache.get(SITE_NOTICES_CACHE)
        if data is None:
            today = timezone.localdate()
            qs = (Announcement.objects.filter(is_active=True, show_on_site=True)
                  .filter(Q(site_until__isnull=True) | Q(site_until__gte=today))
                  .order_by('-created_at')[:3])
            data = [{'id': a.id, 'title': a.title, 'body': a.body[:280], 'link': a.site_link, 'until': a.site_until.isoformat() if a.site_until else None}
                    for a in qs]
            cache.set(SITE_NOTICES_CACHE, data, 300)
        resp = Response(data)
        resp['Cache-Control'] = 'public, max-age=120'
        return resp


class AnnouncementListView(generics.ListAPIView):
    """GET /api/v1/portal/announcements/"""
    serializer_class = AnnouncementSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return Announcement.objects.filter(
            is_active=True,
            audience__in=audiences_for_user(self.request.user),
        ).filter(Q(publish_at__isnull=True) | Q(publish_at__lte=timezone.now())).annotate(
            visible_comment_count=Count('comments', filter=Q(comments__is_hidden=False)),
            acknowledged_ann=Exists(AnnouncementRead.objects.filter(
                announcement=OuterRef('pk'), user=self.request.user, acknowledged_at__isnull=False)),
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


class AnnouncementAdminListCreateView(generics.ListCreateAPIView):
    """GET /api/v1/portal/admin/announcements/ — all comunicados (incl. inactive).
    POST — compose a new audience-targeted comunicado (author = current admin)."""
    queryset = (Announcement.objects.select_related('created_by')
                .annotate(read_count_ann=Count('reads'), ack_count_ann=Count('reads', filter=Q(reads__acknowledged_at__isnull=False))))
    serializer_class = AnnouncementAdminSerializer
    permission_classes = [IsAdmin]

    def perform_create(self, serializer):
        announcement = serializer.save(created_by=self.request.user)
        # Alert the audience (in-app). Fail-soft: a fan-out hiccup must never
        # turn a saved comunicado into a 500. Drafts (is_active=False) notify
        # nobody until published (see perform_update on activate).
        if not announcement.is_active or (announcement.publish_at and announcement.publish_at > timezone.now()):
            return
        try:
            fanout_and_stamp(announcement)
        except Exception:  # noqa: BLE001 — best-effort notification
            logging.getLogger(__name__).exception(
                'Announcement %s fan-out failed', announcement.pk)


class AnnouncementAdminDetailView(generics.RetrieveUpdateDestroyAPIView):
    """PATCH (edit / toggle active) or DELETE a comunicado (admin)."""
    queryset = (Announcement.objects.select_related('created_by')
                .annotate(read_count_ann=Count('reads'), ack_count_ann=Count('reads', filter=Q(reads__acknowledged_at__isnull=False))))
    serializer_class = AnnouncementAdminSerializer
    permission_classes = [IsAdmin]
    http_method_names = ['get', 'patch', 'delete']

    def perform_update(self, serializer):
        previous = self.get_object()
        was_active = previous.is_active
        already_fanned = previous.fanout_at is not None
        announcement = serializer.save()
        # First-time publish of a draft: fan out once. Re-activate after a
        # prior fan-out must not spam the audience again.
        scheduled_later = bool(announcement.publish_at and announcement.publish_at > timezone.now())
        if announcement.is_active and not was_active and not already_fanned and not scheduled_later:
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
        qs = Notification.objects.filter(user=self.request.user)
        # /portal/notificaciones filters (BACKLOG P1-B3).
        p = self.request.query_params
        if p.get('unread') in ('1', 'true'):
            qs = qs.filter(is_read=False)
        t = p.get('type')
        if t in Notification.NotifType.values:
            qs = qs.filter(notif_type=t)
        return qs.order_by('-created_at')


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


class AnnouncementAckView(APIView):
    """POST /api/v1/portal/announcements/<pk>/ack/ — 'Enterado' (P4-4). Idempotent; also marks read."""
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, pk):
        from django.utils import timezone as tz
        ann = Announcement.objects.filter(pk=pk, is_active=True, audience__in=audiences_for_user(request.user)).first()
        if ann is None:
            return Response({'detail': 'No encontrado.'}, status=404)
        read, _ = AnnouncementRead.objects.get_or_create(announcement=ann, user=request.user)
        if read.acknowledged_at is None:
            read.acknowledged_at = tz.now()
            read.save(update_fields=['acknowledged_at'])
        return Response({'acknowledged': True, 'at': read.acknowledged_at.isoformat()})


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


class AnnouncementRecipientCountView(APIView):
    """GET /api/v1/portal/admin/announcements/recipient-count/?audience=

    Composer preview: how many active accounts a comunicado with this audience
    would notify. Reuses the exact role mapping the fan-out uses
    (``_audience_roles``) so the number matches what publish will do.
    """
    permission_classes = [IsAdmin]

    def get(self, request):
        audience = (request.query_params.get('audience')
                    or Announcement.Audience.ALL).strip()
        if audience not in Announcement.Audience.values:
            return Response({'error': 'Audiencia no válida.'}, status=400)
        roles = _audience_roles().get(audience, [])
        count = User.objects.filter(is_active=True, role__in=roles).count()
        return Response({'audience': audience, 'count': count})


@method_decorator(ratelimit('emergency-broadcast', '3/m', key='user', method='POST'), name='dispatch')
class EmergencyBroadcastView(APIView):
    """POST /api/v1/portal/admin/broadcast/

    Urgent school-wide aviso: creates a Comunicado, fans out WARNING
    notifications, immediately dispatches a first email/push batch, and
    optionally WhatsApp-blasts numbers on file (capped). Remaining email/push
    is finished by the ``dispatch_notifications`` cron.
    """
    permission_classes = [IsAdmin]

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


class AnnouncementDeliveryView(APIView):
    """GET  /api/v1/portal/admin/announcements/<pk>/delivery/ — per-channel delivery report.
    POST ... /delivery/ {"action": "resend_failed"} — requeue exhausted email failures.

    BACKLOG P1-C6: shows admins how many recipients got the comunicado by
    in-app/email/push, who failed, and lets them retry after fixing SMTP.
    """
    permission_classes = [IsAdmin]

    def _qs(self, pk):
        announcement = get_object_or_404(Announcement, pk=pk)
        return announcement, Notification.objects.filter(announcement=announcement).select_related('user')

    def get(self, request, pk):
        announcement, qs = self._qs(pk)
        by = {}
        for field in ('email_status', 'push_status'):
            counts = dict(qs.values_list(field).annotate(c=Count('id')).values_list(field, 'c'))
            by[field.replace('_status', '')] = {k: counts.get(k, 0) for k in Notification.Delivery.values}
        failed = [
            {'id': n.id, 'user': n.user.full_name, 'email': n.user.email,
             'attempts': n.attempts, 'error': n.last_error}
            for n in qs.filter(email_status=Notification.Delivery.FAILED).order_by('id')[:200]
        ]
        return Response({
            'announcement': announcement.id,
            'recipients': qs.count(),
            'pending_dispatch': qs.filter(delivered_at__isnull=True).count(),
            'read': qs.filter(is_read=True).count(),
            'acknowledged': announcement.reads.filter(acknowledged_at__isnull=False).count(),
            'requires_ack': announcement.requires_ack,
            'email': by['email'],
            'push': by['push'],
            'failed': failed,
        })

    def post(self, request, pk):
        _, qs = self._qs(pk)
        if request.data.get('action') != 'resend_failed':
            return Response({'action': ['Use "resend_failed".']}, status=400)
        n = qs.filter(email_status=Notification.Delivery.FAILED).update(
            delivered_at=None, attempts=0, email_status=Notification.Delivery.PENDING, last_error='')
        return Response({'requeued': n})
