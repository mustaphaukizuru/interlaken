import datetime as dt
from decimal import Decimal

import pytest
from django.urls import reverse
from django.utils import timezone

from apps.accounts.factories import StudentProfileFactory
from apps.cafeteria.models import CafeteriaTransaction
from apps.content.models import SchoolEvent
from apps.portal.models import Announcement, AnnouncementRead


@pytest.mark.django_db
def test_feed_merges_sources_and_respects_since(auth_client, parent_user, admin_user):
    child = StudentProfileFactory()
    child.parents.add(parent_user)
    old = Announcement.objects.create(title='Viejo', body='x', created_by=admin_user)
    Announcement.objects.filter(pk=old.pk).update(created_at=timezone.now() - dt.timedelta(days=20))
    new = Announcement.objects.create(title='Junta de padres', body='Viernes 9:00', created_by=admin_user)
    AnnouncementRead.objects.create(announcement=new, user=parent_user)
    Announcement.objects.create(title='Solo personal', body='x', created_by=admin_user, audience=Announcement.Audience.STAFF)
    SchoolEvent.objects.create(title='Festival', start_date=timezone.localdate() + dt.timedelta(days=3))
    SchoolEvent.objects.create(title='Lejano', start_date=timezone.localdate() + dt.timedelta(days=40))
    CafeteriaTransaction.objects.create(student=child, transaction_type=CafeteriaTransaction.TxType.PURCHASE, amount=Decimal('35'), loyverse_receipt_id='n1')

    r = auth_client.get(reverse('novedades'))
    assert r.status_code == 200
    titles = [i['title'] for i in r.data['items']]
    assert 'Junta de padres' in titles and 'Viejo' not in titles and 'Solo personal' not in titles
    assert any(t.endswith('· Festival') for t in titles) and not any('Lejano' in t for t in titles)
    assert any(t.startswith('Consumo de') and '$35' in t for t in titles)
    junta = next(i for i in r.data['items'] if i['title'] == 'Junta de padres')
    assert junta['unread'] is False and junta['link'].startswith('/portal/comunicados/')

    since = (timezone.now() + dt.timedelta(minutes=1)).isoformat()
    r2 = auth_client.get(reverse('novedades'), {'since': since})
    assert all(i['type'] == 'evento' for i in r2.data['items'])


@pytest.mark.django_db
def test_requires_auth(client):
    assert client.get(reverse('novedades')).status_code == 401
