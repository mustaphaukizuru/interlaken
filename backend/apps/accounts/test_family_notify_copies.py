"""A child's alerts reach the bell of every account of its family (2026-11-13).

Emails stay one per child mailbox: the family reads each child's school
mailbox, so the copies for the sibling accounts are in-app only.
"""
from decimal import Decimal

import pytest
from django.core.management import call_command
from django.utils import timezone

from apps.accounts.factories import ParentFactory, StudentProfileFactory, StudentUserFactory
from apps.accounts.families import link_students
from apps.accounts.family import family_alert_logins
from apps.accounts.models import NotificationPreference
from apps.cafeteria import services
from apps.cafeteria.models import CafeteriaBalance, CafeteriaTransaction
from apps.portal.models import Notification

pytestmark = pytest.mark.django_db


def _kid(email, first, **kw):
    login = StudentUserFactory(email=email, first_name=first, last_name='Alvarado Felix')
    profile = StudentProfileFactory(user=login, **kw)
    profile.parents.add(login)
    return profile


@pytest.fixture
def fam():
    olivia = _kid('ci10073@interlaken.com.mx', 'Olivia')
    alejandro = _kid('ci09628@interlaken.com.mx', 'Alejandro')
    link_students([olivia.pk, alejandro.pk], notify=False)
    for p in (olivia, alejandro):
        p.refresh_from_db()
    return olivia, alejandro


def _bell(user, **kw):
    return Notification.objects.filter(user=user, **kw)


class TestRecipients:
    def test_alert_logins_are_the_other_accounts_of_the_family(self, fam):
        olivia, alejandro = fam
        mom = ParentFactory(email='mama@correo.mx')
        olivia.parents.add(mom)
        assert [u.email for u in family_alert_logins(alejandro)] == ['ci10073@interlaken.com.mx', 'mama@correo.mx']
        assert [u.email for u in family_alert_logins(olivia)] == ['ci09628@interlaken.com.mx']

    def test_no_family_no_copies(self):
        assert family_alert_logins(_kid('solo@interlaken.com.mx', 'Solo')) == []


class TestLowBalanceCopy:
    def test_sibling_account_gets_a_bell_copy_and_no_email(self, fam, mailoutbox, django_capture_on_commit_callbacks):
        olivia, alejandro = fam
        cb = CafeteriaBalance.objects.create(student=alejandro, balance=Decimal('10'), low_balance_threshold=Decimal('20'))
        with django_capture_on_commit_callbacks(execute=True):
            services._maybe_low_balance_alert(cb, timezone.now())
        own = _bell(alejandro.user, title='Saldo bajo en cafetería')
        copy = _bell(olivia.user, title='Saldo bajo en cafetería')
        assert own.count() == 1 and copy.count() == 1
        row = copy.get()
        assert 'Alejandro' in row.message
        assert row.email_status == Notification.Delivery.SKIPPED and row.push_status == Notification.Delivery.SKIPPED
        recipients = {r for m in mailoutbox for r in m.to}
        assert 'ci10073@interlaken.com.mx' not in recipients  # one email, to Alejandro's mailbox

    def test_the_cron_alert_is_copied_too(self, fam):
        olivia, alejandro = fam
        CafeteriaBalance.objects.create(student=alejandro, balance=Decimal('5'), low_balance_threshold=Decimal('20'))
        CafeteriaTransaction.objects.create(student=alejandro, transaction_type=CafeteriaTransaction.TxType.PURCHASE,
                                            amount=Decimal('15'), balance_after=Decimal('5'), loyverse_receipt_id='r-x')
        call_command('low_balance_alerts')
        assert _bell(olivia.user, notif_type=Notification.NotifType.WARNING).count() == 1

    def test_a_muted_category_gets_no_copy(self, fam):
        olivia, alejandro = fam
        prefs = NotificationPreference.for_user(olivia.user)
        prefs.in_app_enabled = False
        prefs.save()
        cb = CafeteriaBalance.objects.create(student=alejandro, balance=Decimal('5'), low_balance_threshold=Decimal('20'))
        services._maybe_low_balance_alert(cb, timezone.now())
        # Urgent warnings are always delivered (Avisos tab promise); a plain category is not.
        assert _bell(olivia.user, notif_type=Notification.NotifType.WARNING).count() == 1
        from apps.portal.services import copy_to_family
        assert copy_to_family(alejandro, Notification.NotifType.CAFETERIA, 'Compra en cafetería', 'x') == 0


class TestDigest:
    def test_each_family_account_gets_one_digest_with_every_child(self, fam, mailoutbox):
        olivia, alejandro = fam
        for p, amount, rid in ((olivia, '30', 'a'), (alejandro, '45', 'b')):
            CafeteriaTransaction.objects.create(student=p, transaction_type=CafeteriaTransaction.TxType.PURCHASE,
                                                amount=Decimal(amount), balance_after=Decimal('100'),
                                                loyverse_receipt_id=f'r-{rid}')
        call_command('send_spending_digest', period='daily', force=True)
        for login in (olivia.user, alejandro.user):
            digest = _bell(login, title__startswith='Resumen de cafetería').get()
            assert 'Olivia' in digest.message and 'Alejandro' in digest.message
            assert '$75.00' in digest.message
        digests = [m for m in mailoutbox if 'Resumen de cafetería' in m.subject]
        assert len(digests) == 2  # one per child mailbox, never four

    def test_a_copy_only_account_gets_the_digest_in_the_bell(self, fam, mailoutbox):
        olivia, alejandro = fam
        mom = ParentFactory(email='mama@correo.mx')
        olivia.parents.add(mom)
        CafeteriaTransaction.objects.create(student=alejandro, transaction_type=CafeteriaTransaction.TxType.PURCHASE,
                                            amount=Decimal('20'), balance_after=Decimal('80'), loyverse_receipt_id='r-c')
        call_command('send_spending_digest', period='daily', force=True)
        row = _bell(mom, title__startswith='Resumen de cafetería').get()
        assert 'Alejandro' in row.message and row.email_status == Notification.Delivery.SKIPPED
        assert not any('mama@correo.mx' in m.to for m in mailoutbox)
