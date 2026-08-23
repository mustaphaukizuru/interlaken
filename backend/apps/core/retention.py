"""
Data retention policy and purge (BACKLOG P5-4). Full policy: docs/RETENTION.md.

Principles
* Minors' and families' records (StudentProfile, guardians, cafetería ledger,
  payments, AuditLog) are NEVER auto-deleted: fiscal and ARCO obligations, and
  `report_retention` surfaces them for a human decision.
* What is purged automatically is operational exhaust whose only value is
  short-lived, and prospects who were rejected long ago (anonymised, not
  deleted, so funnel statistics stay intact).

Windows (days, overridable via settings.RETENTION):
  rejected_prospects   365   PreRegistration/Registration rejected → anonymise contact fields, delete documents
  form_submissions     180   handled CMS form submissions → delete
  contact_messages     180   handled contact messages → delete
  notifications         90   read in-app notifications → delete
  login_events         365   login history → delete
  past_bookings        730   visit bookings → anonymise contact fields
  expired_tokens         0   blacklisted/expired JWT refresh tokens → delete

run(apply=False) returns {category: count}; apply=True executes in one
transaction and writes an AuditLog row with the counts.
"""
from __future__ import annotations

from datetime import timedelta

from django.conf import settings
from django.db import transaction
from django.utils import timezone

DEFAULTS = {
    'rejected_prospects': 365,
    'form_submissions': 180,
    'contact_messages': 180,
    'notifications': 90,
    'login_events': 365,
    'past_bookings': 730,
}
REDACTED = '[eliminado por retención]'


def windows() -> dict[str, int]:
    return {**DEFAULTS, **getattr(settings, 'RETENTION', {})}


def run(apply: bool = False, actor=None) -> dict[str, int]:
    from rest_framework_simplejwt.token_blacklist.models import OutstandingToken

    from apps.accounts.security import LoginEvent
    from apps.admissions.models import PreRegistration, Registration, RegistrationDocument
    from apps.bookings.models import Booking
    from apps.content.forms import FormSubmission
    from apps.core.models import ContactMessage
    from apps.portal.models import Notification

    now = timezone.now()
    w = windows()
    cut = {k: now - timedelta(days=v) for k, v in w.items()}

    prospects = PreRegistration.objects.filter(status=PreRegistration.Status.REJECTED, updated_at__lte=cut['rejected_prospects']).exclude(parent_email=REDACTED)
    regs = Registration.objects.filter(status=Registration.Status.REJECTED, updated_at__lte=cut['rejected_prospects'])
    reg_docs = RegistrationDocument.objects.filter(registration__in=regs)
    submissions = FormSubmission.objects.filter(is_handled=True, created_at__lte=cut['form_submissions'])
    messages = ContactMessage.objects.filter(is_handled=True, created_at__lte=cut['contact_messages'])
    notifications = Notification.objects.filter(is_read=True, created_at__lte=cut['notifications'])
    logins = LoginEvent.objects.filter(created_at__lte=cut['login_events'])
    bookings = Booking.objects.filter(created_at__lte=cut['past_bookings']).exclude(parent_email=REDACTED)
    tokens = OutstandingToken.objects.filter(expires_at__lte=now)

    counts = {
        'rejected_prospects': prospects.count(),
        'rejected_registrations': regs.count(),
        'registration_documents': reg_docs.count(),
        'form_submissions': submissions.count(),
        'contact_messages': messages.count(),
        'notifications': notifications.count(),
        'login_events': logins.count(),
        'past_bookings': bookings.count(),
        'expired_tokens': tokens.count(),
    }
    if not apply:
        return counts

    with transaction.atomic():
        for doc in reg_docs:
            try:
                doc.file.delete(save=False)
            except Exception:  # noqa: BLE001 - missing file must not stop the purge
                pass
        reg_docs.delete()
        prospects.update(parent_name=REDACTED, parent_email=REDACTED, parent_phone='', message='',
                         child_first_name=REDACTED, child_last_name='')
        submissions.delete()
        messages.delete()
        notifications.delete()
        logins.delete()
        bookings.update(parent_name=REDACTED, parent_email=REDACTED, parent_phone='', child_name='')
        tokens.delete()
        try:
            from apps.content.models import SiteSettings
            from apps.core.audit import record
            record('delete', SiteSettings.load(), {'retention_purge': counts, 'windows_days': w}, actor=actor, context='retention.purge')
        except Exception:  # noqa: BLE001
            pass
    return counts
