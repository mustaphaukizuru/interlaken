"""
Public pre-registration: the browser form payload (single child_name, email/
phone, grade string, no explicit level) must map cleanly to the model. Guards
the public contract that broke in production (frontend/serializer mismatch).
"""
import pytest
from django.urls import reverse

from apps.accounts.factories import AdminFactory
from apps.admissions.models import PreRegistration


def _payload(**over):
    data = {
        'child_name': 'Ana María Pérez',
        'child_dob': '2010-05-01',
        'grade_applying': 'Secundaria 2°',
        'parent_name': 'Roberto Pérez',
        'email': 'roberto@test.mx',
        'phone': '+525540562833',
        'how_did_you_hear': 'redes',
        'message': 'Consulta de prueba',
    }
    data.update(over)
    return data


@pytest.mark.django_db
class TestPublicPreRegistration:
    url = reverse('pre-register')

    def test_public_payload_creates_pre_registration(self, api_client):
        resp = api_client.post(self.url, _payload(), format='json')
        assert resp.status_code == 201, resp.content

        p = PreRegistration.objects.get()
        # Name split, level derived from the grade, contact + referral mapped.
        assert p.child_first_name == 'Ana'
        assert p.child_last_name == 'María Pérez'
        assert p.level == PreRegistration.Level.SECONDARY
        assert p.grade_applying == 'Secundaria 2°'
        assert p.parent_email == 'roberto@test.mx'
        assert p.parent_phone == '+525540562833'
        assert p.referral_source == 'redes'
        assert p.status == PreRegistration.Status.PENDING
        # Cycle is stamped as "YYYY-YYYY+1" (matches the advertised form cycle).
        assert p.cycle.count('-') == 1 and len(p.cycle) == 9

    def test_public_pre_register_is_rate_limited(self, api_client, settings):
        # The public form must not accept unbounded anonymous POSTs — each one
        # creates a row and emails the caller-supplied address + the admin.
        settings.RATELIMIT_ENABLE = True
        from django.core.cache import cache
        cache.clear()
        codes = [
            api_client.post(self.url, _payload(email=f'r{i}@test.mx'), format='json').status_code
            for i in range(7)
        ]
        assert codes[:5] == [201] * 5      # 5/m allowed
        assert 429 in codes[5:]            # then throttled

    @pytest.mark.parametrize('grade,expected', [
        ('Preescolar 1°', PreRegistration.Level.PRESCHOOL),
        ('Primaria 4°', PreRegistration.Level.PRIMARY),
        ('Secundaria 3°', PreRegistration.Level.SECONDARY),
    ])
    def test_level_derived_from_grade(self, api_client, grade, expected):
        resp = api_client.post(self.url, _payload(grade_applying=grade), format='json')
        assert resp.status_code == 201
        assert PreRegistration.objects.get().level == expected

    def test_single_word_name_does_not_crash(self, api_client):
        resp = api_client.post(self.url, _payload(child_name='Ana'), format='json')
        assert resp.status_code == 201
        p = PreRegistration.objects.get()
        assert p.child_first_name == 'Ana'
        assert p.child_last_name == ''

    def test_missing_required_field_is_400(self, api_client):
        payload = _payload()
        del payload['email']
        resp = api_client.post(self.url, payload, format='json')
        assert resp.status_code == 400
        assert 'email' in resp.json()


@pytest.mark.django_db
class TestPreRegistrationStatusUpdate:
    """Admin moves a pre-registration through the pipeline from the console."""

    def _pre(self):
        return PreRegistration.objects.create(
            child_first_name='A', child_last_name='B', child_dob='2011-01-01',
            level=PreRegistration.Level.PRIMARY, grade_applying='Primaria 1°',
            parent_name='P', parent_email='p@t.mx', parent_phone='5551234567')

    def test_admin_can_update_status(self, api_client):
        pre = self._pre()
        api_client.force_authenticate(AdminFactory())
        resp = api_client.patch(reverse('pre-register-detail', args=[pre.id]),
                                {'status': 'enrolled'}, format='json')
        assert resp.status_code == 200, resp.content
        pre.refresh_from_db()
        assert pre.status == PreRegistration.Status.ENROLLED

    def test_anonymous_cannot_update_status(self, api_client):
        pre = self._pre()
        resp = api_client.patch(reverse('pre-register-detail', args=[pre.id]),
                                {'status': 'enrolled'}, format='json')
        assert resp.status_code in (401, 403)
        pre.refresh_from_db()
        assert pre.status == PreRegistration.Status.PENDING
