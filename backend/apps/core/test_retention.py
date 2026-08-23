import datetime as dt

import pytest
from django.core.management import call_command
from django.utils import timezone

from apps.accounts.security import LoginEvent
from apps.admissions.models import PreRegistration
from apps.content.forms import FormDefinition, FormSubmission
from apps.core.models import AuditLog, ContactMessage
from apps.core.retention import REDACTED, run
from apps.portal.models import Notification


def _old(qs_model, **kw):
    obj = qs_model.objects.create(**kw)
    type(obj).objects.filter(pk=obj.pk).update(created_at=timezone.now() - dt.timedelta(days=400))
    return obj


@pytest.mark.django_db
def test_dry_run_counts_and_apply_purges_only_eligible(parent_user, admin_user):
    form = FormDefinition.objects.create(slug='f', title='F', fields=[{'key': 'n', 'label': 'N', 'type': 'text'}])
    old_done = _old(FormSubmission, form=form, data={'n': 'x'}, is_handled=True)
    _old(FormSubmission, form=form, data={'n': 'pending'}, is_handled=False)   # pending never purged
    FormSubmission.objects.create(form=form, data={'n': 'recent'}, is_handled=True)   # too recent
    _old(ContactMessage, name='A', email='a@x.mx', subject='s', message='m', is_handled=True)
    _old(Notification, user=parent_user, notif_type='info', title='t', message='m', is_read=True)
    _old(Notification, user=parent_user, notif_type='info', title='unread', message='m', is_read=False)
    _old(LoginEvent, user=parent_user, email=parent_user.email, method='password')
    pr = PreRegistration.objects.create(child_first_name='Luis', child_last_name='Soto', child_dob='2019-01-01', level='preescolar', grade_applying='K',
                                        parent_name='Papá', parent_email='papa@x.mx', parent_phone='55', status=PreRegistration.Status.REJECTED)
    PreRegistration.objects.filter(pk=pr.pk).update(updated_at=timezone.now() - dt.timedelta(days=400))
    keep = PreRegistration.objects.create(child_first_name='Ana', child_last_name='X', child_dob='2019-01-01', level='preescolar', grade_applying='K',
                                          parent_name='Mamá', parent_email='mama@x.mx', parent_phone='55', status=PreRegistration.Status.PENDING)

    counts = run(apply=False)
    assert counts['form_submissions'] == 1 and counts['contact_messages'] == 1 and counts['notifications'] == 1
    assert counts['login_events'] == 1 and counts['rejected_prospects'] == 1
    assert FormSubmission.objects.count() == 3  # dry run changed nothing

    call_command('purge_retention', apply=True)
    assert not FormSubmission.objects.filter(pk=old_done.pk).exists() and FormSubmission.objects.count() == 2
    assert ContactMessage.objects.count() == 0 and LoginEvent.objects.count() == 0
    assert Notification.objects.count() == 1 and Notification.objects.get().title == 'unread'
    pr.refresh_from_db()
    keep.refresh_from_db()
    assert pr.parent_email == REDACTED and pr.child_first_name == REDACTED and pr.status == 'rejected'
    assert keep.parent_email == 'mama@x.mx'
    assert AuditLog.objects.filter(context='retention.purge').exists()
    assert run(apply=False)['rejected_prospects'] == 0  # idempotent
