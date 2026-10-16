"""core.W001: SMTP backend with no SMTP host is a deploy warning."""
from django.core.checks import run_checks

SMTP = 'django.core.mail.backends.smtp.EmailBackend'


def _ids():
    return [m.id for m in run_checks(include_deployment_checks=True, tags=['email'])]


def test_warns_when_smtp_has_no_host(settings):
    settings.EMAIL_BACKEND = SMTP
    for host in ('', 'localhost'):
        settings.EMAIL_HOST = host
        assert 'core.W001' in _ids()


def test_silent_with_a_real_host_or_another_backend(settings):
    settings.EMAIL_BACKEND = SMTP
    settings.EMAIL_HOST = 'smtp.gmail.com'
    assert 'core.W001' not in _ids()
    settings.EMAIL_BACKEND = 'django.core.mail.backends.console.EmailBackend'
    settings.EMAIL_HOST = ''
    assert 'core.W001' not in _ids()


def test_not_part_of_the_plain_check():
    assert 'core.W001' not in [m.id for m in run_checks(tags=['email'])]
