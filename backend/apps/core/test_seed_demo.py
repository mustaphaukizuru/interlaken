from io import StringIO

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError

from apps.accounts.models import StudentProfile, User
from apps.admissions.models import PreRegistration
from apps.cafeteria.models import CafeteriaTransaction
from apps.content.pages import Page


@pytest.mark.django_db
def test_seed_demo_is_idempotent_and_guarded(settings, tmp_path):
    settings.MEDIA_ROOT = str(tmp_path)
    settings.DEBUG = False
    with pytest.raises(CommandError):
        call_command('seed_demo')
    out = StringIO()
    call_command('seed_demo', force=True, stdout=out)
    n_users, n_students, n_tx = User.objects.count(), StudentProfile.objects.count(), CafeteriaTransaction.objects.count()
    assert n_students == 9 and PreRegistration.objects.count() == 8 and Page.objects.count() >= 9
    admin = User.objects.get(email='direccion@demo.interlaken.mx')
    assert admin.role == 'admin' and admin.check_password('Demo-2026!')
    call_command('seed_demo', force=True, stdout=out)
    assert (User.objects.count(), StudentProfile.objects.count(), CafeteriaTransaction.objects.count()) == (n_users, n_students, n_tx)
    call_command('seed_demo', force=True, reset=True, stdout=out)
    assert StudentProfile.objects.count() == 9
