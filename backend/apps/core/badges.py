"""
core/badges.py — pending-count badges for the unfold admin sidebar.

Each callback is referenced by dotted path from UNFOLD['SIDEBAR']['navigation']
and evaluated lazily per request. They return the live queue depth for the
work-list changelists, so staff see where attention is needed before clicking.
"""


def pending_preregistrations(request):
    from apps.admissions.models import PreRegistration
    return PreRegistration.objects.filter(
        status=PreRegistration.Status.PENDING).count()


def documents_in_review(request):
    from apps.admissions.models import RegistrationDocument
    return RegistrationDocument.objects.filter(is_verified=False).count()


def open_arco_requests(request):
    from apps.legal.models import ArcoRequest
    return ArcoRequest.objects.filter(status__in=[
        ArcoRequest.Status.RECEIVED, ArcoRequest.Status.IN_REVIEW]).count()


def unhandled_contact_messages(request):
    from apps.core.models import ContactMessage
    return ContactMessage.objects.filter(is_handled=False).count()


BADGE_CACHE_KEY = 'core:badges:{pk}'
BADGE_CACHE_TTL = 30


def portal_badges(user) -> dict:
    """Live counts for the portal sidebar (BACKLOG P1-E3). Admins get work
    queues; families get their unread notifications. Cheap COUNT queries only.

    Cached 30 s per user: the SPA polls this on every navigation and the admin
    branch is a few COUNTs (audit 2026-08)."""
    from django.core.cache import cache

    key = BADGE_CACHE_KEY.format(pk=getattr(user, 'pk', 0))
    cached = cache.get(key)
    if cached is not None:
        return cached
    out = _compute_badges(user)
    cache.set(key, out, BADGE_CACHE_TTL)
    return out


def _minutes_since(when, now) -> int | None:
    """Whole minutes since ``when`` (None when unknown)."""
    if not when:
        return None
    return max(0, int((now - when).total_seconds() // 60))


def _queue(qs, field: str, now) -> tuple[int, int | None]:
    """One aggregate per queue: how many, and how long the oldest has waited.

    ``qs`` may be a ``distinct()`` queryset (the MultiCobros helpers join
    payments), so the aggregate runs over its primary keys."""
    from django.db.models import Count, Min

    agg = qs.model.objects.filter(pk__in=qs.values('pk')).aggregate(n=Count('pk'), oldest=Min(field))
    n = agg['n'] or 0
    return n, (_minutes_since(agg['oldest'], now) if n else None)


# Failed card payments that need a person. A family that cancelled, let the
# Banorte window expire or retried is not one (payments.models._STAGE_REASONS).
FAILED_PAYMENT_DAYS = 7
_NOT_A_PROBLEM_STAGES = ('cancel', 'expire', 'supersede')


def failed_payments_count(now=None) -> int:
    """Card payments that FAILED in the last ``FAILED_PAYMENT_DAYS`` days for a
    reason a person may have to look at (declined, bank timeout, not found in
    MultiCobros, configuration), plus attempts of that window stuck pending
    for more than 24 h (the summary's ``stuck_pending`` rule)."""
    from datetime import timedelta

    from django.db.models import Q
    from django.utils import timezone

    from apps.payments.models import Payment

    now = now or timezone.now()
    since = now - timedelta(days=FAILED_PAYMENT_DAYS)
    # has_key first: a row without a stage (a bank decline) must not vanish
    # into the SQL NULL of the key lookup.
    failed = (Payment.objects.filter(status=Payment.Status.FAILED, created_at__gte=since)
              .exclude(Q(gateway_raw__has_key='stage') & Q(gateway_raw__stage__in=_NOT_A_PROBLEM_STAGES))
              .count())
    stuck = Payment.objects.filter(
        status__in=[Payment.Status.PENDING, Payment.Status.PROCESSING],
        created_at__gte=since, created_at__lt=now - timedelta(hours=24)).count()
    return failed + stuck


def loyverse_sync_alerts(now=None) -> int:
    """How many of the two cron checks of ``check_sync_fresh`` fail right now:
    the 5-minute purchase poll (no run for more than 30 min) and the daily
    roster sync (none for more than 30 h). Database only: it never probes
    Loyverse. Zero where no Loyverse token is configured (local, demo)."""
    from django.conf import settings
    from django.utils import timezone

    if not getattr(settings, 'LOYVERSE_API_TOKEN', ''):
        return 0
    from apps.cafeteria.management.commands.check_sync_fresh import (
        MAX_AGE_MINUTES,
        MAX_ROSTER_AGE_HOURS,
    )
    from apps.cafeteria.models import LoyverseSyncState

    now = now or timezone.now()
    state = LoyverseSyncState.objects.filter(pk=1).first()
    poll = _minutes_since(state.last_poll_at if state else None, now)
    roster = _minutes_since(state.last_roster_sync_at if state else None, now)
    return (int(poll is None or poll > MAX_AGE_MINUTES)
            + int(roster is None or roster > MAX_ROSTER_AGE_HOURS * 60))


def _compute_badges(user) -> dict:
    from django.utils import timezone

    from apps.accounts.models import PasswordRequest, StudentProfile, User
    from apps.core.areas import user_areas
    from apps.portal.models import Notification

    out = {'notificaciones': Notification.objects.filter(user=user, is_read=False).count()}
    # Admins get every work queue; a staff account only those of its console
    # areas (apps/core/areas.py), so nobody is shown a count they cannot open.
    areas = user_areas(user)
    if not areas:
        return out
    from apps.admissions.models import PreRegistration, Registration, RegistrationDocument
    from apps.bookings.models import Booking
    from apps.cafeteria.models import TopUpRequest
    from apps.cafeteria.services import low_balance_queryset
    from apps.content.forms import FormSubmission
    from apps.core.models import ContactMessage
    from apps.legal.filters import OPEN_STATUSES, overdue_q
    from apps.legal.models import ArcoRequest
    from apps.payments.multicobros import (
        online_topups_awaiting_staff,
        paid_topups_awaiting_verification,
    )

    now = timezone.now()
    office_cash = TopUpRequest.objects.filter(status=TopUpRequest.Status.PENDING,
                                              method=TopUpRequest.Method.OFFICE)
    # The sidebar counters (keys and meaning unchanged since P1-E3).
    counters = {
        'admisiones': ('admisiones', lambda: (
            PreRegistration.objects.filter(status=PreRegistration.Status.PENDING).count()
            + Registration.objects.filter(status=Registration.Status.SUBMITTED).count())),
        'visitas': ('visitas', lambda: Booking.objects.filter(status=Booking.Status.PENDING).count()),
        # Cash requests to apply, plus real card top-ups still to load into
        # the POS and apply, or to verify in MultiCobros.
        'cafeteria': ('cafeteria', lambda: office_cash.count() + online_topups_awaiting_staff().count()),
        'contrasenas': ('accesos', lambda: PasswordRequest.objects.filter(
            status=PasswordRequest.Status.OPEN).count()),
        'mensajes': ('mensajes', lambda: unhandled_contact_messages(None)),
        'formularios': ('mensajes', lambda: FormSubmission.objects.filter(is_handled=False).count()),
    }
    for badge, (area, count) in counters.items():
        if area in areas:
            out[badge] = count()

    # The dashboard's «Pendientes» list (UX Phase 7): one count per queue and,
    # where the queue has a meaningful start, how long its oldest item has
    # waited (``<key>_edad``, minutes; only while the queue is not empty).
    # Same area rule as above; read-only COUNT/MIN queries.
    def queue(key, qs, field):
        n, age = _queue(qs, field, now)
        out[key] = n
        if age is not None:
            out[f'{key}_edad'] = age

    if 'admisiones' in areas:
        queue('preregistros', PreRegistration.objects.filter(status=PreRegistration.Status.PENDING), 'created_at')
        queue('inscripciones', Registration.objects.filter(status=Registration.Status.SUBMITTED), 'created_at')
        # Uploaded and not reviewed yet (pending only: a rejected one waits for
        # the family), on registrations the office is working on.
        queue('documentos', RegistrationDocument.objects.filter(
            status=RegistrationDocument.Review.PENDING,
            registration__status__in=(Registration.Status.SUBMITTED, Registration.Status.REVIEWING)),
            'uploaded_at')
    if 'visitas' in areas:
        out['visitas_hoy'] = (Booking.objects.filter(slot__date=timezone.localdate())
                              .exclude(status=Booking.Status.CANCELLED).count())
    if 'cafeteria' in areas:
        # «Por verificar»: the part of «cafeteria» only a MultiCobros check can
        # move (paid by card, approval not verified), shown apart next to Cafetería.
        queue('cafeteria_verificar', paid_topups_awaiting_verification(), 'processed_at')
        queue('cafeteria_caja', office_cash, 'created_at')
        # Paid card top-ups to load into the POS at 07:30 (the «Por aplicar» list).
        queue('cafeteria_aplicar', online_topups_awaiting_staff().filter(
            status=TopUpRequest.Status.PAID), 'processed_at')
        out['pagos_fallidos'] = failed_payments_count(now)
        out['saldo_bajo'] = low_balance_queryset().filter(student__tipo=StudentProfile.Tipo.ALUMNO).count()
        out['loyverse_alertas'] = loyverse_sync_alerts(now)
    if 'alumnos' in areas:
        # Still active here, but their Loyverse customer is gone (leavers).
        out['sin_loyverse'] = StudentProfile.objects.filter(
            is_active=True, tipo=StudentProfile.Tipo.ALUMNO, loyverse_missing_since__isnull=False).count()
    if 'accesos' in areas:
        queue('contrasenas', PasswordRequest.objects.filter(status=PasswordRequest.Status.OPEN), 'created_at')
    if 'mensajes' in areas:
        queue('mensajes', ContactMessage.objects.filter(is_handled=False), 'created_at')
    if getattr(user, 'role', None) == User.Role.ADMIN:
        queue('arco', ArcoRequest.objects.filter(status__in=OPEN_STATUSES), 'created_at')
        out['arco_vencidas'] = ArcoRequest.objects.filter(overdue_q()).count()
    return out
