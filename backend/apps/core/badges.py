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
    branch is eight COUNTs (audit 2026-08)."""
    from django.core.cache import cache

    key = BADGE_CACHE_KEY.format(pk=getattr(user, 'pk', 0))
    cached = cache.get(key)
    if cached is not None:
        return cached
    out = _compute_badges(user)
    cache.set(key, out, BADGE_CACHE_TTL)
    return out


def _compute_badges(user) -> dict:
    from apps.accounts.models import PasswordRequest, User
    from apps.core.areas import user_areas
    from apps.portal.models import Notification

    out = {'notificaciones': Notification.objects.filter(user=user, is_read=False).count()}
    # Admins get every work queue; a staff account only those of its console
    # areas (apps/core/areas.py), so nobody is shown a count they cannot open.
    areas = user_areas(user)
    if not areas:
        return out
    from apps.admissions.models import PreRegistration, Registration
    from apps.bookings.models import Booking
    from apps.cafeteria.models import TopUpRequest
    from apps.content.forms import FormSubmission
    from apps.legal.models import ArcoRequest
    from apps.payments.multicobros import online_topups_awaiting_staff

    counters = {
        'admisiones': ('admisiones', lambda: (
            PreRegistration.objects.filter(status=PreRegistration.Status.PENDING).count()
            + Registration.objects.filter(status=Registration.Status.SUBMITTED).count())),
        'visitas': ('visitas', lambda: Booking.objects.filter(status=Booking.Status.PENDING).count()),
        # Cash requests to apply, plus real card top-ups still to load into
        # the POS and apply, or to verify in MultiCobros.
        'cafeteria': ('cafeteria', lambda: (
            TopUpRequest.objects.filter(status=TopUpRequest.Status.PENDING,
                                        method=TopUpRequest.Method.OFFICE).count()
            + online_topups_awaiting_staff().count())),
        'contrasenas': ('accesos', lambda: PasswordRequest.objects.filter(
            status=PasswordRequest.Status.OPEN).count()),
        'mensajes': ('mensajes', lambda: unhandled_contact_messages(None)),
        'formularios': ('mensajes', lambda: FormSubmission.objects.filter(is_handled=False).count()),
    }
    for badge, (area, count) in counters.items():
        if area in areas:
            out[badge] = count()
    if getattr(user, 'role', None) == User.Role.ADMIN:
        out['arco'] = ArcoRequest.objects.filter(status__in=('received', 'in_review')).count()
    return out
