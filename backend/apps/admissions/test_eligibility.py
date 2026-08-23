"""P1-G1/G2: age-on-31-Dec eligibility on the public pre-registro; wants_visit captured."""
from datetime import date

import pytest
from django.urls import reverse
from django.utils import timezone

from apps.admissions.eligibility import age_on_dec31, eligibility_error, required_age
from apps.admissions.models import PreRegistration

pytestmark = pytest.mark.django_db


def test_required_age_table():
    assert required_age('Maternal') == 2
    assert required_age('Preescolar 1°') == 3 and required_age('3° Preescolar') == 5
    assert required_age('Primaria 1°') == 6 and required_age('Primaria 6°') == 11
    assert required_age('Secundaria 3°') == 14
    assert required_age('otro') is None


def test_age_on_dec31_and_message():
    year = timezone.localdate().year
    dob = date(year - 3, 6, 1)  # turns 3 this year → 1° Preescolar ok, Primaria 1° not
    assert age_on_dec31(dob, year) == 3
    assert eligibility_error(dob, 'Preescolar 1°') is None
    msg = eligibility_error(dob, 'Primaria 1°')
    assert msg and '6 años' in msg and str(year) in msg


def _payload(**over):
    year = timezone.localdate().year
    base = {
        'child_name': 'Ana Pérez', 'child_dob': f'{year - 6}-03-15', 'grade_applying': 'Primaria 1°',
        'parent_name': 'Luis Pérez', 'email': 'luis@test.mx', 'phone': '5512345678',
    }
    base.update(over)
    return base


def test_public_form_blocks_wrong_grade_and_accepts_right_one(api_client, settings):
    settings.RATELIMIT_ENABLE = False
    bad = api_client.post(reverse('pre-register'), _payload(grade_applying='Secundaria 1°'), format='json')
    assert bad.status_code == 400 and 'grade_applying' in bad.data
    ok = api_client.post(reverse('pre-register'), _payload(wants_visit=True), format='json')
    assert ok.status_code == 201, ok.data
    assert PreRegistration.objects.get().wants_visit is True
