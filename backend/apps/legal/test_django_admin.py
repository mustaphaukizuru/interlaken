"""Django admin must not bypass the portal workflows (transitions, emails, audit)
and must keep a published privacy notice immutable."""
import datetime as dt

import pytest
from django.contrib import admin
from django.test import RequestFactory

from apps.accounts.models import User
from apps.admissions.models import PreRegistration, Registration
from apps.bookings.models import Booking
from apps.legal.models import ArcoRequest, PrivacyNoticeVersion

pytestmark = pytest.mark.django_db


@pytest.fixture
def request_(db):
    req = RequestFactory().get('/django-admin/')
    req.user = User.objects.create_superuser(email='root@test.mx', password='root-pass-1234')
    return req


@pytest.mark.parametrize('model', [Booking, PreRegistration, Registration, ArcoRequest])
def test_status_is_read_only_and_not_list_editable(model, request_):
    model_admin = admin.site._registry[model]
    assert 'status' in model_admin.get_readonly_fields(request_)
    assert 'status' not in (model_admin.list_editable or ())


def _notice(**kw):
    data = dict(version='2026.9', body='Texto', effective_date=dt.date(2026, 1, 1))
    data.update(kw)
    return PrivacyNoticeVersion.objects.create(**data)


def test_published_privacy_notice_is_frozen_and_undeletable(request_):
    model_admin = admin.site._registry[PrivacyNoticeVersion]
    live = _notice(is_active=True)
    assert {'body', 'version', 'effective_date'} <= set(model_admin.get_readonly_fields(request_, live))
    assert 'is_active' not in model_admin.get_readonly_fields(request_, live)  # can still be retired
    assert model_admin.has_delete_permission(request_, live) is False


def test_notice_accepted_by_an_applicant_stays_frozen_after_retirement(request_):
    model_admin = admin.site._registry[PrivacyNoticeVersion]
    old = _notice(version='2025.1', is_active=False)
    Registration.objects.create(child_first_name='Ana', child_last_name='L', child_dob='2018-01-01',
                                level='primaria', grade_applying='1', parent1_name='M', parent1_email='m@test.mx',
                                parent1_phone='55', privacy_notice_version=old)
    assert 'body' in model_admin.get_readonly_fields(request_, old)
    assert model_admin.has_delete_permission(request_, old) is False


def test_draft_notice_is_still_editable(request_):
    model_admin = admin.site._registry[PrivacyNoticeVersion]
    draft = _notice(version='2027.1', is_active=False)
    assert 'body' not in model_admin.get_readonly_fields(request_, draft)
    assert model_admin.has_delete_permission(request_, draft) is True
