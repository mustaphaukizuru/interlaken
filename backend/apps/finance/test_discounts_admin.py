"""Admin CRUD for per-student becas / descuentos, from the student detail page.
Invoice generation already applies active discounts; this exposes managing them."""
import pytest
from django.urls import reverse

from apps.accounts.factories import AdminFactory, ParentFactory, StudentProfileFactory
from apps.finance.models import Discount

pytestmark = pytest.mark.django_db
URL = reverse('finance-admin-discounts')


class TestDiscountAdmin:
    def test_admin_creates_for_student(self, api_client):
        student = StudentProfileFactory()
        api_client.force_authenticate(AdminFactory())
        resp = api_client.post(URL, {
            'student': student.id, 'name': 'Beca de excelencia',
            'kind': 'scholarship', 'method': 'percent', 'value': '20',
        }, format='json')
        assert resp.status_code == 201, resp.content
        d = Discount.objects.get()
        assert d.student_id == student.id and d.name == 'Beca de excelencia'

    def test_list_filters_by_student(self, api_client):
        s1, s2 = StudentProfileFactory(), StudentProfileFactory()
        Discount.objects.create(student=s1, name='A', value='10')
        Discount.objects.create(student=s2, name='B', value='10')
        api_client.force_authenticate(AdminFactory())
        rows = api_client.get(URL, {'student': s1.id}).json()['results']
        assert [r['name'] for r in rows] == ['A']

    def test_update_and_delete(self, api_client):
        s = StudentProfileFactory()
        d = Discount.objects.create(student=s, name='A', value='10')
        api_client.force_authenticate(AdminFactory())
        url = reverse('finance-admin-discount-detail', args=[d.id])
        assert api_client.patch(url, {'value': '15'}, format='json').status_code == 200
        d.refresh_from_db()
        assert str(d.value) == '15.00'
        assert api_client.delete(url).status_code == 204
        assert not Discount.objects.filter(id=d.id).exists()

    def test_parent_forbidden(self, api_client):
        api_client.force_authenticate(ParentFactory())
        assert api_client.get(URL).status_code == 403
