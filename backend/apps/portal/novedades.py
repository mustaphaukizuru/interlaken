"""
Portal "Novedades" feed (BACKLOG P4-11).

GET /portal/novedades/?since=<iso>   what changed for this family since `since`
(default: 7 days). One flat list, newest first, each item {type, title, text,
link, at, unread}. Sources: comunicados for the user's audience, upcoming
calendar events (next 14 days), cafetería movements of the family's students,
payments, CMS pages published on the site. The SPA remembers the last time the
panel was opened in localStorage and passes it as `since`.
"""
from __future__ import annotations

from datetime import timedelta

from django.db.models import Q
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from rest_framework import permissions
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import StudentProfile, User

MAX_ITEMS = 30


def family_students(user):
    students = list(StudentProfile.objects.filter(parents=user).select_related('user'))
    if user.role == User.Role.STUDENT and not students:
        own = StudentProfile.objects.filter(user_id=user.pk).select_related('user').first()
        if own is not None:
            students = [own]
    return students


def build_feed(user, since) -> list[dict]:
    from apps.cafeteria.models import CafeteriaTransaction
    from apps.content.models import SchoolEvent
    from apps.content.pages import Page
    from apps.payments.models import Payment

    items: list[dict] = []
    # Bitácora 10 (14/10/2026): the family portal no longer shows comunicados, so the
    # feed does not list them either (families still get them by email/notification).

    today = timezone.localdate()
    for e in SchoolEvent.objects.filter(is_published=True, start_date__gte=today, start_date__lte=today + timedelta(days=14)).order_by('start_date')[:8]:
        when = e.start_date.strftime('%d/%m')
        items.append({'type': 'evento', 'title': f'{when} · {e.title}', 'text': e.description, 'link': '/calendario',
                      'at': timezone.make_aware(timezone.datetime.combine(e.start_date, timezone.datetime.min.time())).isoformat(), 'unread': e.created_at >= since})

    students = family_students(user)
    if students:
        for t in (CafeteriaTransaction.objects.filter(student__in=students, date__gte=since)
                  .select_related('student__user').order_by('-date')[:10]):
            label = {'purchase': 'Consumo', 'topup': 'Recarga', 'refund': 'Devolución', 'adjustment': 'Ajuste'}.get(t.transaction_type, t.transaction_type)
            items.append({'type': 'cafeteria', 'title': f'{label} de {t.student.user.first_name}: ${t.amount}', 'text': t.description or '',
                          'link': '/portal/cafeteria', 'at': t.date.isoformat(), 'unread': True})
        for p in (Payment.objects.filter(Q(user=user) | Q(related_topup__student__in=students), updated_at__gte=since)
                  .distinct().order_by('-updated_at')[:5]):
            items.append({'type': 'pago', 'title': f'Pago {p.get_status_display().lower()}: ${p.amount}', 'text': p.get_payment_type_display(),
                          'link': '/portal/cafeteria', 'at': p.updated_at.isoformat(), 'unread': True})

    for pg in Page.objects.filter(status=Page.Status.PUBLISHED, published_at__gte=since).order_by('-published_at')[:5]:
        items.append({'type': 'sitio', 'title': f'Nueva página: {pg.title}', 'text': (pg.seo or {}).get('description', ''),
                      'link': f'/{pg.slug}', 'at': pg.published_at.isoformat(), 'unread': True})

    items.sort(key=lambda i: i['at'], reverse=True)
    return items[:MAX_ITEMS]


class NovedadesView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        since = parse_datetime(request.query_params.get('since') or '') if request.query_params.get('since') else None
        if since is None:
            since = timezone.now() - timedelta(days=7)
        elif timezone.is_naive(since):
            since = timezone.make_aware(since)
        since = max(since, timezone.now() - timedelta(days=60))
        items = build_feed(request.user, since)
        return Response({'since': since.isoformat(), 'items': items, 'unread': sum(1 for i in items if i['unread'])})
