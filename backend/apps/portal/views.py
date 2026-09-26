"""
Portal views: role-aware dashboard, announcements, notifications.
"""
import logging

import django_filters
from django.db.models import Count, Exists, OuterRef, Q, Subquery, Sum
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.decorators import method_decorator
from rest_framework import generics, permissions
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import StudentProfile, User
from apps.admissions.models import PreRegistration, Registration
from apps.cafeteria.models import CafeteriaBalance
from apps.cafeteria.services import low_balance_queryset
from apps.content.ops import audit_value, bool_filter, delete_action, delete_keep_pk, tri_state
from apps.core.audit import record, record_export
from apps.core.bulk import AdminBulkView, BulkAction
from apps.core.exceptions import error_body
from apps.core.exporting import (
    AdminExportMixin,
    Col,
    ExportSpec,
    collect_rows,
    parse_fmt,
    render_export,
)
from apps.core.listing import AdminListMixin, apply_date_range
from apps.core.permissions import IsAdmin
from apps.core.ratelimit import ratelimit
from apps.core.throttling import SharedScopedRateThrottle
from apps.core.transitions import assert_transition
from apps.payments.models import Payment

from .models import Announcement, AnnouncementComment, AnnouncementRead, Notification
from .serializers import (
    AnnouncementAdminSerializer,
    AnnouncementCommentSerializer,
    AnnouncementSerializer,
    NotificationDetailSerializer,
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
                        .select_related('student__user', 'student__loyverse_profile'))
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
                # Wallets in use and under their threshold (not every $0 wallet
                # of a child who never buys): see cafeteria.low_balance_queryset.
                'low_balance_count': low_balance_queryset().count(),
                # Still "active" in the app but their Loyverse customer is gone:
                # leavers the office has not withdrawn yet (Vincular Loyverse).
                'stale_links': StudentProfile.objects.filter(
                    is_active=True, loyverse_missing_since__isnull=False).count(),
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
    pagination_class = None  # a thread is read whole; the SPA sends no ?page=
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


ANNOUNCEMENT_ENTITY = 'portal.announcement'
ANNOUNCEMENT_AUDIT_FIELDS = (
    'title', 'body', 'audience', 'is_active', 'push_enabled', 'show_on_site', 'site_until',
    'site_link', 'publish_at', 'requires_ack', 'attachments',
)


def announcement_state(a) -> str:
    """Lifecycle state for ``assert_transition``: never-sent inactive = draft."""
    if a.is_active:
        return 'active'
    return 'draft' if a.fanout_at is None else 'inactive'


def _maybe_fanout(announcement, *, context):
    """First publish fans out once; scheduled comunicados wait for the cron."""
    scheduled_later = bool(announcement.publish_at and announcement.publish_at > timezone.now())
    if not announcement.is_active or announcement.fanout_at is not None or scheduled_later:
        return
    try:
        fanout_and_stamp(announcement)
    except Exception:  # noqa: BLE001 — best-effort notification
        logging.getLogger(__name__).exception('Announcement %s %s fan-out failed', announcement.pk, context)


def _admin_announcements():
    return (Announcement.objects.select_related('created_by')
            .annotate(read_count_ann=Count('reads'),
                      ack_count_ann=Count('reads', filter=Q(reads__acknowledged_at__isnull=False))))


class AnnouncementFilterSet(django_filters.FilterSet):
    """``?audience=&active=&scheduled=&requires_ack=&from=&to=`` (dates on created_at)."""
    audience = django_filters.ChoiceFilter(choices=Announcement.Audience.choices)
    active = bool_filter('is_active')
    requires_ack = bool_filter('requires_ack')
    scheduled = django_filters.CharFilter(method='filter_scheduled')

    class Meta:
        model = Announcement
        fields: list[str] = []

    def filter_scheduled(self, qs, _name, value):
        flag = tri_state(value)
        if flag is None:
            return qs
        later = Q(publish_at__gt=timezone.now())
        return qs.filter(later) if flag else qs.exclude(later)

    @property
    def qs(self):
        params = self.data or {}
        return apply_date_range(super().qs, 'created_at', params.get('from'), params.get('to'))


ANNOUNCEMENT_ORDERING = {
    'created': 'created_at',
    'publish_at': 'publish_at',
    'title': 'title',
    'audience': 'audience',
    'reads': 'read_count_ann',
    'active': 'is_active',
}


class AnnouncementAdminListCreateView(AdminListMixin, generics.ListCreateAPIView):
    """GET /api/v1/portal/admin/announcements/ — all comunicados (incl. inactive),
    Data Ops list contract: ``q`` (title, body), ``audience``, ``active``,
    ``scheduled``, ``requires_ack``, ``from``/``to``; ordering keys in
    ``ANNOUNCEMENT_ORDERING``.
    POST — compose a new audience-targeted comunicado (author = current admin)."""
    serializer_class = AnnouncementAdminSerializer
    permission_classes = [IsAdmin]
    search_fields = ('title', 'body')
    ordering = ANNOUNCEMENT_ORDERING
    default_ordering = '-created_at'
    filterset_class = AnnouncementFilterSet

    def get_queryset(self):
        return _admin_announcements()

    def perform_create(self, serializer):
        announcement = serializer.save(created_by=self.request.user)
        record('create', announcement,
               {k: [None, audit_value(getattr(announcement, k))] for k in ANNOUNCEMENT_AUDIT_FIELDS},
               actor=self.request.user, context='portal.announcement')
        # Alert the audience (in-app). Fail-soft: a fan-out hiccup must never
        # turn a saved comunicado into a 500. Drafts (is_active=False) notify
        # nobody until published (see perform_update on activate).
        _maybe_fanout(announcement, context='create')


class AnnouncementAdminDetailView(generics.RetrieveUpdateDestroyAPIView):
    """PATCH (edit / toggle active) or DELETE a comunicado (admin).

    Activation goes through the ``portal.announcement`` transition table; a
    comunicado that already reached the families (``fanout_at``) cannot be
    deleted, only deactivated (its delivery history stays auditable)."""
    serializer_class = AnnouncementAdminSerializer
    permission_classes = [IsAdmin]
    http_method_names = ['get', 'patch', 'delete']

    def get_queryset(self):
        return _admin_announcements()

    def perform_update(self, serializer):
        previous = serializer.instance
        before = {k: getattr(previous, k) for k in ANNOUNCEMENT_AUDIT_FIELDS}
        state = announcement_state(previous)
        wants_active = serializer.validated_data.get('is_active', previous.is_active)
        if wants_active != previous.is_active:
            assert_transition(ANNOUNCEMENT_ENTITY, state, 'active' if wants_active else 'inactive')
        announcement = serializer.save()
        diff = {k: [audit_value(before[k]), audit_value(getattr(announcement, k))]
                for k in ANNOUNCEMENT_AUDIT_FIELDS if before[k] != getattr(announcement, k)}
        if diff:
            record('update', announcement, diff, actor=self.request.user, context='portal.announcement')
        # First-time publish of a draft: fan out once. Re-activate after a
        # prior fan-out must not spam the audience again.
        _maybe_fanout(announcement, context='activate')

    def destroy(self, request, *args, **kwargs):
        reason = _delete_guard(self.get_object())
        if reason:
            return Response(error_body(f'No se puede eliminar: {reason}.'), status=400)
        return super().destroy(request, *args, **kwargs)

    def perform_destroy(self, instance):
        delete_keep_pk(instance)
        record('delete', instance, {'title': [instance.title, None]},
               actor=self.request.user, context='portal.announcement')


def _delete_guard(a) -> str | None:
    if a.fanout_at is not None:
        return 'ya se envió a las familias; desactívelo para archivarlo'
    return None


def _activation(name, label_es, target):
    def plan(a, payload):
        assert_transition(ANNOUNCEMENT_ENTITY, announcement_state(a), target)

    def handler(a, payload, actor):
        current = announcement_state(a)
        assert_transition(ANNOUNCEMENT_ENTITY, current, target)
        a.is_active = target == 'active'
        a.save(update_fields=['is_active', 'updated_at'])
        if a.is_active:
            _maybe_fanout(a, context='bulk-activate')
        return {'state': [current, target]}

    return BulkAction(name=name, label_es=label_es, handler=handler, plan=plan, side_effects='per_row')


def _duplicate(a, payload, actor):
    copy = Announcement.objects.create(
        title=f'Copia de {a.title}'[:200], body=a.body, audience=a.audience, created_by=actor,
        is_active=False, push_enabled=a.push_enabled, show_on_site=False, site_until=None,
        site_link=a.site_link, publish_at=None, requires_ack=a.requires_ack,
        attachments=list(a.attachments or []),
    )
    record('create', copy, {'duplicated_from': a.pk}, actor=actor, context='portal.announcement')
    return {'duplicate_id': copy.pk}


class AnnouncementBulkView(AdminBulkView):
    """POST /api/v1/portal/admin/announcements/bulk/ — ``activate`` (first
    activation fans out), ``deactivate`` (archive), ``delete`` (never fanned
    out only), ``duplicate`` (inactive draft copy)."""
    entity = ANNOUNCEMENT_ENTITY
    list_view_class = AnnouncementAdminListCreateView
    actions = {
        a.name: a for a in (
            _activation('activate', 'Activar', 'active'),
            _activation('deactivate', 'Desactivar', 'inactive'),
            delete_action(guard=_delete_guard),
            BulkAction(name='duplicate', label_es='Duplicar', handler=_duplicate, side_effects='none',
                       audit_action='create'),
        )
    }


ANNOUNCEMENT_EXPORT = ExportSpec(
    filename_prefix='comunicados',
    title='Comunicados',
    audit_entity=ANNOUNCEMENT_ENTITY,
    columns=[
        Col('created_at', 'Creado', fmt='datetime', width=18),
        Col('title', 'Título', width=36),
        Col('audience', 'Dirigido a', getter=lambda a: a.get_audience_display(), width=12),
        Col('state', 'Estado', getter=lambda a: {'active': 'Activo', 'inactive': 'Inactivo', 'draft': 'Borrador'}[announcement_state(a)], width=10),
        Col('publish_at', 'Programado', fmt='datetime', width=18),
        Col('requires_ack', 'Pide enterado', fmt='bool', width=10),
        Col('read_count_ann', 'Leídos', fmt='int', width=8),
        Col('ack_count_ann', 'Enterados', fmt='int', width=10),
        Col('fanout_at', 'Enviado', fmt='datetime', width=18),
        Col('created_by', 'Autor', getter=lambda a: a.created_by.full_name if a.created_by else '', width=22),
        Col('body', 'Mensaje', width=60),
    ],
)


class AnnouncementAdminExportView(AdminExportMixin, AnnouncementAdminListCreateView):
    """GET /api/v1/portal/admin/announcements/export/?fmt=csv|xlsx&…list filters…"""
    http_method_names = ['get', 'head', 'options']
    export_formats = ('csv', 'xlsx')
    export_spec = ANNOUNCEMENT_EXPORT


DELIVERY_EXPORT_COLUMNS = [
    Col('user_name', 'Destinatario', getter=lambda n: n.user.full_name, width=28),
    Col('user_email', 'Correo', getter=lambda n: n.user.email, width=30),
    Col('user_role', 'Rol', getter=lambda n: n.user.get_role_display(), width=12),
    Col('created_at', 'Notificado', fmt='datetime', width=18),
    Col('is_read', 'Leído', fmt='bool', width=8),
    Col('acknowledged', 'Enterado', getter=lambda n: getattr(n, 'ack_at', None), fmt='datetime', width=18),
    Col('email_status', 'Correo (estado)', getter=lambda n: n.get_email_status_display(), width=14),
    Col('push_status', 'Push (estado)', getter=lambda n: n.get_push_status_display(), width=14),
    Col('attempts', 'Intentos', fmt='int', width=8),
    Col('last_error', 'Último error', width=36),
]


class AnnouncementDeliveryExportView(APIView):
    """GET /api/v1/portal/admin/announcements/<pk>/delivery/export/?fmt=csv|xlsx —
    one row per recipient: read, acknowledged and per-channel status (audited)."""
    permission_classes = [IsAdmin]
    throttle_classes = [SharedScopedRateThrottle]
    throttle_scope = 'admin-export'

    def get(self, request, pk):
        announcement = get_object_or_404(Announcement, pk=pk)
        fmt = parse_fmt(request, ('csv', 'xlsx'))
        ack = AnnouncementRead.objects.filter(announcement=announcement, user=OuterRef('user_id'))
        qs = (Notification.objects.filter(announcement=announcement)
              .select_related('user')
              .annotate(ack_at=Subquery(ack.values('acknowledged_at')[:1]))
              .order_by('user__last_name', 'user__first_name', 'pk'))
        spec = ExportSpec(filename_prefix=f'entrega-comunicado-{announcement.pk}',
                          title=f'Entrega: {announcement.title}', audit_entity='portal.announcement.delivery',
                          columns=DELIVERY_EXPORT_COLUMNS)
        count, rows = collect_rows(qs, spec.cap_for(fmt))
        response = render_export(rows, spec, fmt)
        record_export(spec.audit_entity, fmt, {'announcement': announcement.pk}, count, request.user)
        return response


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
            return Response(error_body('ids debe ser una lista de enteros.'), status=400)

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


class NotificationDetailView(generics.RetrieveAPIView):
    """GET /api/v1/portal/notifications/<pk>/ — one notification, in full.

    Scoped to the caller's own rows: a wrong pk is a 404, never someone else's
    notification.
    """
    serializer_class = NotificationDetailSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return Notification.objects.filter(user=self.request.user).select_related('announcement')


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
            return Response(error_body('No encontrada.'), status=404)

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
            return Response(error_body('Audiencia no válida.'), status=400)
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
            return Response(error_body(str(exc)), status=400)
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
