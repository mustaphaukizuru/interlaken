"""Scope proof (UX audit Appendix E): a family never reaches another family's data.

The code of these endpoints scopes correctly by inspection; these outsider
tests make it a contract. Two families, each with one child; family B's
parent asks for family A's things by id and gets nothing.
"""
from decimal import Decimal
from unittest.mock import patch

import pytest
from django.urls import reverse

from apps.accounts.factories import ParentFactory, StudentProfileFactory, StudentUserFactory
from apps.cafeteria.models import CafeteriaTransaction
from apps.payments.factories import PaymentFactory
from apps.portal.models import Announcement, AnnouncementRead, Notification

pytestmark = pytest.mark.django_db


@pytest.fixture
def two_families(db):
    parent_a = ParentFactory(email='mama.a@test.mx')
    parent_b = ParentFactory(email='papa.b@test.mx')
    child_a = StudentProfileFactory(user=StudentUserFactory(first_name='Ana', last_name='Uno'),
                                    loyverse_id='loy-a', parents=[parent_a])
    child_b = StudentProfileFactory(user=StudentUserFactory(first_name='Beto', last_name='Dos'),
                                    loyverse_id='loy-b', parents=[parent_b])
    CafeteriaTransaction.objects.create(
        student=child_a, transaction_type=CafeteriaTransaction.TxType.PURCHASE, amount=Decimal('77.00'),
        description='Torta secreta', items=[{'name': 'Torta', 'category': 'Comida', 'total': 77}],
        loyverse_receipt_id='scope-a-1')
    return {'pa': parent_a, 'pb': parent_b, 'ca': child_a, 'cb': child_b}


def _as(api_client, user):
    api_client.force_authenticate(user=user)
    return api_client


class TestCafeteria:
    @patch('apps.cafeteria.services.get_recent_transactions')
    def test_loyverse_history_of_another_familys_child_is_not_linked(self, mock_get, api_client, two_families):
        mock_get.return_value = [{'receipt_number': 'A-1', 'customer_id': 'loy-a', 'total_money': 77,
                                  'receipt_date': '2026-11-20T12:00:00.000Z', 'line_items': []}]
        client = _as(api_client, two_families['pb'])
        resp = client.get(reverse('cafeteria-loyverse-history'), {'student': two_families['ca'].pk})
        assert resp.status_code == 200
        assert resp.data == {'linked': False, 'receipts': []}
        # Loyverse was never asked for family A's receipts.
        assert all(call.args[0] != 'loy-a' for call in mock_get.call_args_list)

    def test_spending_categories_of_another_familys_child_are_empty(self, api_client, two_families):
        client = _as(api_client, two_families['pb'])
        resp = client.get(reverse('cafeteria-spending-categories'), {'student': two_families['ca'].pk})
        assert resp.status_code == 200
        assert resp.data['total'] == 0 and resp.data['categories'] == []
        # Without a student filter the outsider sees only their own (empty) spend.
        assert client.get(reverse('cafeteria-spending-categories')).data['total'] == 0
        # The owner does see it (the data exists).
        owner = _as(api_client, two_families['pa'])
        assert owner.get(reverse('cafeteria-spending-categories')).data['total'] == 77.0


class TestNovedades:
    def test_another_familys_purchases_and_payments_never_appear(self, api_client, two_families):
        PaymentFactory(user=two_families['pa'], amount=Decimal('500.00'))
        client = _as(api_client, two_families['pb'])
        resp = client.get(reverse('novedades'))
        assert resp.status_code == 200
        text = repr(resp.data['items'])  # not «since»: a timestamp may contain any digits
        assert 'Ana' not in text and '77' not in text and 'Torta secreta' not in text and '500' not in text
        assert not [i for i in resp.data['items'] if i['type'] in ('cafeteria', 'pago')]
        # The owner sees both (so the outsider's empty feed is scoping, not missing data).
        owner = _as(api_client, two_families['pa'])
        types = {i['type'] for i in owner.get(reverse('novedades')).data['items']}
        assert {'cafeteria', 'pago'} <= types


class TestNotifications:
    def test_marking_someone_elses_notification_read_is_a_404(self, api_client, two_families):
        theirs = Notification.objects.create(user=two_families['pa'], notif_type='info', title='Privado',
                                             message='Solo para la familia A')
        client = _as(api_client, two_families['pb'])
        for method in (client.post, client.patch):
            resp = method(reverse('notification-read', args=[theirs.pk]))
            assert resp.status_code == 404
        theirs.refresh_from_db()
        assert theirs.is_read is False

    def test_acknowledging_an_out_of_audience_comunicado_is_a_404(self, api_client, two_families):
        staff_only = Announcement.objects.create(title='Solo personal', body='x', is_active=True,
                                                 audience=Announcement.Audience.STAFF)
        inactive = Announcement.objects.create(title='Retirado', body='x', is_active=False,
                                               audience=Announcement.Audience.ALL)
        client = _as(api_client, two_families['pb'])
        for ann in (staff_only, inactive):
            assert client.post(reverse('announcement-ack', args=[ann.pk])).status_code == 404
        assert not AnnouncementRead.objects.filter(user=two_families['pb']).exists()
        # In the family's audience it works (the 404 is scope, not a broken route).
        mine = Announcement.objects.create(title='Para familias', body='x', is_active=True,
                                           audience=Announcement.Audience.PARENTS)
        assert client.post(reverse('announcement-ack', args=[mine.pk])).status_code == 200
