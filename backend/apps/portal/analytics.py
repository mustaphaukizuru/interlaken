"""
portal/analytics.py — Aggregated staff analytics endpoint (IK-ADMIN item 6).

One GET for the /staff dashboard: staff/admin-gated, cached 60 seconds,
aggregated entirely at the DB (no per-row loops → no N+1). Every section is
empty-safe: with zero data the shapes are intact (zero-filled funnels, a full
30-day series of zeros) so the dashboard always renders meaningfully.

Read-only analytics are deliberately exempt from audit logging — the audit
trail records mutations, not reads.
"""
from datetime import timedelta
from decimal import Decimal

from django.core.cache import cache
from django.db.models import Count, F, Q, Sum
from django.db.models.functions import TruncDate
from django.utils import timezone
from rest_framework import permissions
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import User

CACHE_KEY_PREFIX = 'staff-analytics-v2'
CACHE_TTL_SECONDS = 60
# Whitelisted trend windows for ?days= (default 30).
ALLOWED_RANGE_DAYS = (7, 30, 90)


class IsStaffOrAdmin(permissions.BasePermission):
    """School personnel only: role staff/admin (Django is_staff also counts)."""

    def has_permission(self, request, view):
        user = request.user
        return bool(
            user and user.is_authenticated
            and (user.role in (User.Role.ADMIN, User.Role.STAFF) or user.is_staff)
        )


def _zero_filled(choices, counted):
    """Every status key present, missing ones at 0 (empty-safe funnels)."""
    return {value: counted.get(value, 0) for value, _label in choices}


def build_payload(days=30):
    from apps.admissions.models import (PreRegistration, Registration,
                                        RegistrationDocument)
    from apps.cafeteria.models import CafeteriaTransaction
    from apps.finance.models import Invoice
    from apps.legal.models import ArcoRequest
    from apps.payments.models import Payment
    from apps.portal.models import Announcement

    now = timezone.now()
    today = timezone.localdate()
    month_start = today.replace(day=1)
    prev_month_start = (month_start - timedelta(days=1)).replace(day=1)
    since = now - timedelta(days=days)

    # ── Admissions funnel + referral breakdown (3 queries) ──
    pre_counts = dict(
        PreRegistration.objects.values_list('status').annotate(n=Count('id')))
    reg_counts = dict(
        Registration.objects.values_list('status').annotate(n=Count('id')))
    referrals = [
        {'source': row['referral_source'], 'count': row['n']}
        for row in PreRegistration.objects.exclude(referral_source='')
        .values('referral_source').annotate(n=Count('id')).order_by('-n')[:8]
    ]
    prereg_by_day = dict(
        PreRegistration.objects.filter(created_at__gte=since)
        .annotate(day=TruncDate('created_at')).values_list('day')
        .annotate(n=Count('id')))
    admissions_series = [
        {'date': (today - timedelta(days=offset)).isoformat(),
         'count': prereg_by_day.get(today - timedelta(days=offset), 0)}
        for offset in range(days - 1, -1, -1)
    ]

    # ── Payments: this month vs last (full + to-date) + overdue (4 queries) ──
    def month_window(start, end):
        row = Payment.objects.filter(
            status=Payment.Status.SUCCESS,
            completed_at__date__gte=start,
            completed_at__date__lt=end,
        ).aggregate(total=Sum('amount'), n=Count('id'))
        return {'total': float(row['total'] or 0), 'count': row['n'] or 0}

    payments_this = month_window(month_start, today + timedelta(days=1))
    payments_prev = month_window(prev_month_start, month_start)
    # Prev-month-to-date: the same number of days into last month as we are into
    # this one, so the month-over-month delta compares like for like. Without
    # it, MTD-vs-full-prior-month shows a false ~90% "decline" on the 3rd, etc.
    # Clamp the end at this month's start so a long month (day 31) never spills
    # a shorter prior month (Feb) into the current one.
    days_into_month = (today - month_start).days + 1
    prev_to_date_end = min(prev_month_start + timedelta(days=days_into_month),
                           month_start)
    payments_prev_to_date = month_window(prev_month_start, prev_to_date_end)
    overdue_row = Invoice.objects.filter(status=Invoice.Status.OVERDUE).aggregate(
        n=Count('id'), amount=Sum(F('amount') - F('amount_paid')))
    pay_by_day = dict(
        Payment.objects.filter(status=Payment.Status.SUCCESS,
                               completed_at__gte=since)
        .annotate(day=TruncDate('completed_at')).values_list('day')
        .annotate(total=Sum('amount')))
    payments_series = [
        {'date': (today - timedelta(days=offset)).isoformat(),
         'total': float(pay_by_day.get(today - timedelta(days=offset), 0))}
        for offset in range(days - 1, -1, -1)
    ]

    # ── Cafeteria: top-ups vs consumption, 30-day daily series (1 query) ──
    tx_rows = (
        CafeteriaTransaction.objects
        .filter(date__gte=since, transaction_type__in=[
            CafeteriaTransaction.TxType.TOPUP,
            CafeteriaTransaction.TxType.PURCHASE,
        ])
        .annotate(day=TruncDate('date'))
        .values('day', 'transaction_type')
        .annotate(total=Sum('amount'))
    )
    by_day = {}
    for row in tx_rows:
        bucket = by_day.setdefault(row['day'], {'topups': Decimal('0'),
                                                'purchases': Decimal('0')})
        key = ('topups' if row['transaction_type']
               == CafeteriaTransaction.TxType.TOPUP else 'purchases')
        bucket[key] += row['total'] or 0
    series = []
    for offset in range(days - 1, -1, -1):
        day = today - timedelta(days=offset)
        bucket = by_day.get(day, {})
        series.append({
            'date': day.isoformat(),
            'topups': float(bucket.get('topups', 0)),
            'purchases': float(bucket.get('purchases', 0)),
        })

    # ── Document review queue (1 query) ──
    docs_in_review = RegistrationDocument.objects.filter(is_verified=False).count()

    # ── Circulars: distinct eligible readers / eligible audience (2 queries) ──
    audience_roles = {
        Announcement.Audience.ALL:      [User.Role.PARENT, User.Role.STUDENT, User.Role.STAFF],
        Announcement.Audience.PARENTS:  [User.Role.PARENT],
        Announcement.Audience.STUDENTS: [User.Role.STUDENT],
        Announcement.Audience.STAFF:    [User.Role.STAFF],
    }
    role_counts = dict(User.objects.filter(is_active=True)
                       .values_list('role').annotate(n=Count('id')))
    active_anns = list(Announcement.objects.filter(is_active=True)
                       .annotate(readers=Count('reads__user', distinct=True)))
    rates = []
    for ann in active_anns:
        eligible = sum(role_counts.get(r, 0) for r in audience_roles.get(ann.audience, []))
        if eligible:
            rates.append(min(ann.readers / eligible, 1.0))
    read_rate = round(sum(rates) / len(rates), 3) if rates else None
    active_circulars = len(active_anns)

    # ── ARCO (1 query) ──
    arco_row = ArcoRequest.objects.filter(status__in=[
        ArcoRequest.Status.RECEIVED, ArcoRequest.Status.IN_REVIEW,
    ]).aggregate(n=Count('id'),
                 overdue=Count('id', filter=Q(statutory_deadline__lt=today)))

    return {
        'admissions': {
            'pre_funnel': _zero_filled(PreRegistration.Status.choices, pre_counts),
            'reg_funnel': _zero_filled(Registration.Status.choices, reg_counts),
            'referrals': referrals,
            'series': admissions_series,
        },
        'payments': {
            'this_month': payments_this,
            'last_month': payments_prev,
            'last_month_to_date': payments_prev_to_date,
            'overdue': {
                'count': overdue_row['n'] or 0,
                'amount': float(overdue_row['amount'] or 0),
            },
            'series': payments_series,
        },
        'cafeteria': {'series': series},
        'documents': {'in_review': docs_in_review},
        'circulars': {'active': active_circulars, 'read_rate': read_rate},
        'arco': {'open': arco_row['n'] or 0, 'overdue': arco_row['overdue'] or 0},
        'range_days': days,
        'generated_at': now.isoformat(),
    }


class StaffAnalyticsView(APIView):
    """GET /api/v1/portal/analytics/?days=7|30|90 — aggregated dashboard payload."""
    permission_classes = [IsStaffOrAdmin]

    def get(self, request):
        try:
            days = int(request.query_params.get('days', 30))
        except (TypeError, ValueError):
            days = 30
        if days not in ALLOWED_RANGE_DAYS:
            days = 30

        cache_key = f'{CACHE_KEY_PREFIX}:{days}'
        payload = cache.get(cache_key)
        if payload is None:
            payload = build_payload(days)
            cache.set(cache_key, payload, CACHE_TTL_SECONDS)
        return Response(payload)
