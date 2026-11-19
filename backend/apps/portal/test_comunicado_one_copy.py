"""One comunicado email per address (launch leftover D3).

Siblings sign in with their own school logins and families often confirm the
same personal address (``notify_email``) on each. Every login holds its own
notification row of a comunicado, so before this each row emailed that
address: one copy per child. Now the first row that sends to an address
claims it for that comunicado (``AnnouncementDelivery``); the other rows leave
it out and keep their in-app copy.
"""

from unittest import mock

import pytest
from django.core import mail
from django.utils import timezone

from apps.accounts.factories import ParentFactory, StudentProfileFactory, StudentUserFactory
from apps.portal.models import Announcement, AnnouncementDelivery, Notification
from apps.portal.services import (
    dispatch_pending_notifications,
    emergency_broadcast,
    fanout_announcement,
)

pytestmark = pytest.mark.django_db

NOW = timezone.now()


def _kid(login, notify="mama@ejemplo.mx"):
    kid = StudentUserFactory(
        email=login, notify_email=notify, notify_email_verified_at=NOW if notify else None
    )
    StudentProfileFactory(user=kid, parents=[kid])  # the school login is its own guardian
    return kid


def _sent_to():
    return sorted(addr.lower() for m in mail.outbox for addr in m.to)


def _comunicado(title="Junta de padres"):
    ann = Announcement.objects.create(
        title=title, body="Viernes 8:00.", audience="parents", is_active=True
    )
    fanout_announcement(ann)
    return ann


def test_siblings_sharing_a_personal_address_get_one_copy_each_login_keeps_its_bell():
    kids = [
        _kid("ci0001@ejemplo-escuela.mx"),
        _kid("ci0002@ejemplo-escuela.mx"),
        _kid("ci0003@ejemplo-escuela.mx"),
    ]
    ann = _comunicado()
    mail.outbox.clear()
    dispatch_pending_notifications()
    assert _sent_to() == [
        "ci0001@ejemplo-escuela.mx",
        "ci0002@ejemplo-escuela.mx",
        "ci0003@ejemplo-escuela.mx",
        "mama@ejemplo.mx",
    ]
    # Every login still has its in-app copy.
    assert Notification.objects.filter(announcement=ann, user__in=kids).count() == 3
    claim = AnnouncementDelivery.objects.get(
        announcement=ann, channel="email", address="mama@ejemplo.mx"
    )
    assert claim.status == "sent" and claim.user_id == kids[0].pk


def test_the_comparison_ignores_case_and_spaces():
    _kid("ci0001@ejemplo-escuela.mx", notify="Mama@Ejemplo.MX")
    _kid("ci0002@ejemplo-escuela.mx", notify="mama@ejemplo.mx")
    _comunicado()
    mail.outbox.clear()
    dispatch_pending_notifications()
    assert _sent_to().count("mama@ejemplo.mx") == 1


def test_one_copy_even_when_the_rows_go_out_in_different_runs():
    """The inline first batch sends one sibling, the cron the other."""
    _kid("ci0001@ejemplo-escuela.mx")
    _kid("ci0002@ejemplo-escuela.mx")
    _comunicado()
    mail.outbox.clear()
    dispatch_pending_notifications(limit=1)
    dispatch_pending_notifications()
    assert _sent_to().count("mama@ejemplo.mx") == 1


def test_the_emergency_broadcast_too():
    _kid("ci0001@ejemplo-escuela.mx")
    _kid("ci0002@ejemplo-escuela.mx")
    mail.outbox.clear()
    emergency_broadcast(
        title="Suspensión", message="No hay clases.", audience="parents", dispatch_limit=50
    )
    assert _sent_to() == [
        "ci0001@ejemplo-escuela.mx",
        "ci0002@ejemplo-escuela.mx",
        "mama@ejemplo.mx",
    ]


def test_another_comunicado_reaches_the_address_again():
    _kid("ci0001@ejemplo-escuela.mx")
    _kid("ci0002@ejemplo-escuela.mx")
    _comunicado("Junta")
    _comunicado("Festival")
    mail.outbox.clear()
    dispatch_pending_notifications()
    assert _sent_to().count("mama@ejemplo.mx") == 2


def test_a_failed_send_is_retried_by_the_row_that_claimed_the_address():
    first = _kid("ci0001@ejemplo-escuela.mx")
    _kid("ci0002@ejemplo-escuela.mx")
    ann = _comunicado()
    mail.outbox.clear()
    with mock.patch("apps.portal.services.send_email", side_effect=[False, True]) as send:
        dispatch_pending_notifications()
    # The first row failed with mama@ in it; the sibling's row left mama@ out.
    assert [sorted(c.kwargs["recipients"]) for c in send.call_args_list] == [
        ["ci0001@ejemplo-escuela.mx", "mama@ejemplo.mx"],
        ["ci0002@ejemplo-escuela.mx"],
    ]
    row = Notification.objects.get(announcement=ann, user=first)
    assert row.delivered_at is None and row.email_status == "failed"
    # Its retry (once RETRY_AFTER allows) sends to mama@ again.
    Notification.objects.filter(pk=row.pk).update(created_at=NOW - timezone.timedelta(hours=1))
    with mock.patch("apps.portal.services.send_email", return_value=True) as send:
        dispatch_pending_notifications()
    assert sorted(send.call_args.kwargs["recipients"]) == [
        "ci0001@ejemplo-escuela.mx",
        "mama@ejemplo.mx",
    ]


def test_an_address_claimed_by_a_deleted_account_is_taken_over():
    gone = _kid("ci0001@ejemplo-escuela.mx")
    _kid("ci0002@ejemplo-escuela.mx")
    ann = _comunicado()
    AnnouncementDelivery.objects.create(
        announcement=ann,
        channel="email",
        address="mama@ejemplo.mx",
        send_to="mama@ejemplo.mx",
        user=gone,
        status="failed",
    )
    gone.delete()  # its row goes, the claim is orphaned
    mail.outbox.clear()
    dispatch_pending_notifications()
    assert _sent_to() == ["ci0002@ejemplo-escuela.mx", "mama@ejemplo.mx"]


def test_the_guardian_rule_is_unchanged():
    """A guardian with a login of their own still gets their copy through
    their own row; the children's rows leave the address out (launch fix 2)."""
    mom = ParentFactory(email="mama@ejemplo.mx")
    for login in ("ci0001@ejemplo-escuela.mx", "ci0002@ejemplo-escuela.mx"):
        kid = StudentUserFactory(
            email=login, notify_email="mama@ejemplo.mx", notify_email_verified_at=NOW
        )
        StudentProfileFactory(user=kid, parents=[kid, mom])
    _comunicado()
    mail.outbox.clear()
    dispatch_pending_notifications()
    assert _sent_to() == [
        "ci0001@ejemplo-escuela.mx",
        "ci0002@ejemplo-escuela.mx",
        "mama@ejemplo.mx",
    ]


def test_non_comunicado_notices_are_untouched():
    """Queued notices without a comunicado keep their own rules (no claims)."""
    kid = _kid("ci0001@ejemplo-escuela.mx")
    Notification.objects.create(user=kid, notif_type="cafeteria", title="Compra", message="Agua.")
    mail.outbox.clear()
    dispatch_pending_notifications()
    assert _sent_to() == ["ci0001@ejemplo-escuela.mx", "mama@ejemplo.mx"]
    assert not AnnouncementDelivery.objects.exists()
