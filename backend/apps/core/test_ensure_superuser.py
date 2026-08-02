"""
ensure_superuser (env-driven admin bootstrap): creates the configured admin,
promotes an existing account to admin without touching its password, and is a
no-op when unconfigured.
"""
import pytest
from django.contrib.auth import get_user_model
from django.core.management import call_command

pytestmark = pytest.mark.django_db


def test_creates_admin_with_password(monkeypatch):
    monkeypatch.setenv('DJANGO_SUPERUSER_EMAIL', 'admin@interlaken.com.mx')
    monkeypatch.setenv('DJANGO_SUPERUSER_PASSWORD', 's3cret-pass')
    monkeypatch.setenv('DJANGO_SUPERUSER_FIRST_NAME', 'Mustapha')
    monkeypatch.setenv('DJANGO_SUPERUSER_LAST_NAME', 'Ukizuru')

    call_command('ensure_superuser')

    U = get_user_model()
    u = U.objects.get(email='admin@interlaken.com.mx')
    assert u.is_superuser and u.is_staff and u.role == U.Role.ADMIN
    assert u.check_password('s3cret-pass')


def test_promotes_existing_without_resetting_password(monkeypatch):
    U = get_user_model()
    U.objects.create_user(email='p@interlaken.com.mx', password='orig-pw',
                          first_name='P', last_name='Q', role=U.Role.PARENT)

    monkeypatch.setenv('DJANGO_SUPERUSER_EMAIL', 'p@interlaken.com.mx')
    monkeypatch.delenv('DJANGO_SUPERUSER_PASSWORD', raising=False)
    call_command('ensure_superuser')

    u = U.objects.get(email='p@interlaken.com.mx')
    assert u.is_superuser and u.role == U.Role.ADMIN     # promoted
    assert u.check_password('orig-pw')                    # password untouched


def test_no_email_is_a_noop(monkeypatch):
    monkeypatch.delenv('DJANGO_SUPERUSER_EMAIL', raising=False)
    call_command('ensure_superuser')
    assert get_user_model().objects.count() == 0
