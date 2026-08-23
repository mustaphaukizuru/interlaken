from decimal import Decimal

import pytest
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.factories import StudentProfileFactory
from apps.cafeteria.models import CafeteriaBalance, CafeteriaTransaction


@pytest.mark.django_db
def test_statement_pdf_scoped_to_family(parent_user, admin_client):
    kid = StudentProfileFactory(grade='2° Primaria', group='A')
    kid.parents.add(parent_user)
    other = StudentProfileFactory()
    CafeteriaBalance.objects.get_or_create(student=kid, defaults={'balance': Decimal('100')})
    now = timezone.now()
    CafeteriaTransaction.objects.create(student=kid, transaction_type='topup', amount=Decimal('200'), date=now, balance_after=Decimal('250'), loyverse_receipt_id='s1')
    CafeteriaTransaction.objects.create(student=kid, transaction_type='purchase', amount=Decimal('35'), date=now, balance_after=Decimal('215'), description='Torta', loyverse_receipt_id='s2')
    c = APIClient()
    c.force_authenticate(parent_user)
    month = now.strftime('%Y-%m')
    r = c.get(reverse('cafeteria-statement'), {'student': kid.pk, 'month': month})
    assert r.status_code == 200 and r['Content-Type'] == 'application/pdf' and r.content.startswith(b'%PDF')
    assert f'cafeteria-{kid.student_id}-{month}.pdf' in r['Content-Disposition']
    assert c.get(reverse('cafeteria-statement'), {'student': other.pk}).status_code == 404
    assert c.get(reverse('cafeteria-statement'), {'student': kid.pk, 'month': 'nope'}).status_code == 400
    assert admin_client.get(reverse('cafeteria-statement'), {'student': other.pk}).status_code == 200


@pytest.mark.django_db
def test_bulk_topup_by_group_preview_and_apply(admin_client):
    a = StudentProfileFactory(grade='1° Primaria', group='A')
    b = StudentProfileFactory(grade='1° Primaria', group='A')
    StudentProfileFactory(grade='1° Primaria', group='B')
    for s in (a, b):
        CafeteriaBalance.objects.get_or_create(student=s, defaults={'balance': Decimal('10')})
    url = reverse('admin-bulk-topup')
    assert admin_client.post(url, {'amount': 0, 'reason': 'x', 'grade': '1° Primaria'}, format='json').status_code == 400
    assert admin_client.post(url, {'amount': 50, 'reason': '', 'grade': '1° Primaria'}, format='json').status_code == 400
    assert admin_client.post(url, {'amount': 50, 'reason': 'Beca'}, format='json').status_code == 400
    pv = admin_client.post(url, {'amount': 50, 'reason': 'Beca', 'grade': '1° Primaria', 'group': 'A', 'preview': True}, format='json')
    assert pv.status_code == 200 and pv.data['count'] == 2 and pv.data['total'] == '100'
    r = admin_client.post(url, {'amount': 50, 'reason': 'Beca', 'grade': '1° Primaria', 'group': 'A'}, format='json')
    assert r.status_code == 201 and r.data['credited'] == 2
    assert CafeteriaBalance.objects.get(student=a).balance == Decimal('60')
    assert CafeteriaTransaction.objects.filter(student=a, transaction_type='adjustment', description__contains='Recarga masiva').exists()
