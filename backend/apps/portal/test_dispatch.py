"""
Out-of-band notification delivery (#18): bulk announcement fan-out creates
in-app rows only; the dispatch_notifications cron delivers email + push for
undelivered rows, while per-user notify() is stamped delivered inline.
"""
import pytest

from apps.accounts.factories import ParentFactory
from apps.portal.models import Announcement, Notification
from apps.portal.services import (dispatch_pending_notifications,
                                  fanout_announcement, notify)

pytestmark = pytest.mark.django_db


def test_fanout_is_pending_then_dispatch_delivers():
    p = ParentFactory()
    ann = Announcement.objects.create(
        title='Aviso', body='cuerpo', audience=Announcement.Audience.PARENTS, is_active=True)
    fanout_announcement(ann)

    n = Notification.objects.get(user=p)
    assert n.delivered_at is None                     # bulk fan-out: not yet sent

    assert dispatch_pending_notifications() == 1
    n.refresh_from_db()
    assert n.delivered_at is not None                 # delivered by the cron
    assert dispatch_pending_notifications() == 0      # idempotent: nothing left


def test_notify_is_delivered_inline():
    p = ParentFactory()
    notify(p, Notification.NotifType.INFO, 'Hola', 'mensaje')
    n = Notification.objects.get(user=p)
    assert n.delivered_at is not None                 # inline send stamps it
    assert dispatch_pending_notifications() == 0      # cron skips it
