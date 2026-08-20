"""Guards for the STORAGES configuration.

Django 5.1 REMOVED ``DEFAULT_FILE_STORAGE`` and ``STATICFILES_STORAGE``. On
Django 6.1 assigning them is silently inert (Django ignores unknown settings),
so the S3 media backend configured that way never took effect and admissions
documents -- birth certificates, CURP, proof of address, legally retained --
were written to the container's EPHEMERAL disk and destroyed on every deploy.
Nothing failed loudly; the settings simply did nothing.

These tests pin the working configuration so the regression cannot recur.
"""
import importlib
import re
from pathlib import Path

from django.conf import settings

REMOVED_SETTINGS = ('DEFAULT_FILE_STORAGE', 'STATICFILES_STORAGE')


def _reload_base(monkeypatch, bucket):
    """Re-evaluate settings/base.py with AWS_STORAGE_BUCKET_NAME set or cleared.

    ``read_env`` does not overwrite variables already in os.environ, so the
    monkeypatched value wins over the developer's local .env.
    """
    if bucket is None:
        monkeypatch.delenv('AWS_STORAGE_BUCKET_NAME', raising=False)
    else:
        monkeypatch.setenv('AWS_STORAGE_BUCKET_NAME', bucket)
    from config.settings import base
    return importlib.reload(base)


def test_bucket_configured_selects_the_s3_backend(monkeypatch):
    """The bug: this asserted nothing before, because the old setting name was
    inert and default_storage stayed on the local filesystem."""
    base = _reload_base(monkeypatch, 'interlaken-docs')
    assert base.STORAGES['default']['BACKEND'] == 'storages.backends.s3boto3.S3Boto3Storage'


def test_no_bucket_falls_back_to_local_disk(monkeypatch):
    """Dev, CI and tests have no bucket and must keep using the filesystem."""
    base = _reload_base(monkeypatch, None)
    assert base.STORAGES['default']['BACKEND'] == 'django.core.files.storage.FileSystemStorage'


def test_static_files_use_whitenoise_manifest_storage(monkeypatch):
    """Hashed + precompressed static; inert before the STORAGES migration."""
    base = _reload_base(monkeypatch, None)
    assert base.STORAGES['staticfiles']['BACKEND'] == (
        'whitenoise.storage.CompressedManifestStaticFilesStorage')


def test_settings_never_assign_the_removed_storage_settings():
    """Assigning the Django<5.1 names is a silent no-op, so ban the assignment.

    Matches assignment only, so the explanatory comments above may name them.
    """
    from config.settings import base
    source = Path(base.__file__).read_text(encoding='utf-8')
    for name in REMOVED_SETTINGS:
        offenders = re.findall(rf'^\s*{name}\s*=', source, flags=re.MULTILINE)
        assert not offenders, (
            f'{name} is assigned in settings/base.py but Django 5.1 removed it; '
            f'the assignment does nothing. Configure STORAGES instead.'
        )


def test_live_settings_expose_a_usable_storages_dict():
    """Whatever the environment, both storage aliases must be resolvable."""
    assert set(settings.STORAGES) >= {'default', 'staticfiles'}
    for alias in ('default', 'staticfiles'):
        assert settings.STORAGES[alias]['BACKEND']
