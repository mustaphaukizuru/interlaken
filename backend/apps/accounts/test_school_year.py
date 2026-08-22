import pytest
from django.urls import reverse

from apps.accounts.factories import StudentProfileFactory
from apps.accounts.models import StudentProfile
from apps.accounts.school_year import next_grade
from apps.content.models import SiteSettings
from apps.core.models import AuditLog


def test_next_grade_sequence():
    assert next_grade('Maternal') == '1° Preescolar'
    assert next_grade('6° Primaria') == '1° Secundaria'
    assert next_grade('3° Secundaria') is None
    assert next_grade('Otro') == 'Otro'


@pytest.mark.django_db
def test_preview_and_run(admin_client, parent_user):
    from rest_framework.test import APIClient
    auth_client = APIClient()
    auth_client.force_authenticate(parent_user)
    a = StudentProfileFactory(grade='1° Primaria')
    b = StudentProfileFactory(grade='3° Secundaria')
    c = StudentProfileFactory(grade='2° Primaria')
    c.apply_status(StudentProfile.Status.ON_LEAVE)
    c.save()
    assert auth_client.get(reverse('school-year-preview')).status_code == 403
    resp = admin_client.get(reverse('school-year-preview'))
    assert resp.status_code == 200, resp.data
    pv = resp.data
    assert pv['graduates'] == 1 and pv['active_total'] == 2 and pv['skipped'] == 1
    assert {m['from']: m['to'] for m in pv['moves']} == {'1° Primaria': '2° Primaria', '3° Secundaria': 'Egresado'}
    # confirmation + cycle format guards
    assert admin_client.post(reverse('school-year-run'), {'confirm': 'no', 'new_cycle': '2027-2028'}, format='json').status_code == 400
    assert admin_client.post(reverse('school-year-run'), {'confirm': 'AVANZAR', 'new_cycle': '2027-2029'}, format='json').status_code == 400
    r = admin_client.post(reverse('school-year-run'), {'confirm': 'AVANZAR', 'new_cycle': '2027-2028', 'reset_threshold': 80}, format='json')
    assert r.status_code == 200, r.data
    assert r.data['promoted'] == 1 and r.data['graduated'] == 1
    for sp in (a, b, c):
        sp.refresh_from_db()
    assert a.grade == '2° Primaria'
    assert b.status == 'graduated' and b.is_active is False
    assert c.grade == '2° Primaria' and c.status == 'on_leave'
    assert SiteSettings.load().school_year == '2027-2028'
    assert AuditLog.objects.filter(context='school-year.rollover').exists()
    # cannot apply the same cycle twice
    assert admin_client.post(reverse('school-year-run'), {'confirm': 'AVANZAR', 'new_cycle': '2027-2028'}, format='json').status_code == 400
