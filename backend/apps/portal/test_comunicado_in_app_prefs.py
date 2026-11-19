"""Comunicados honour each account's in-app setting (launch leftover D4).

The Avisos tab lets a family turn off «En la aplicación» or mute «Comunicados
y avisos del colegio». ``notify()`` respected both; the comunicado fan-out
created a bell row for everyone. Now the row of an account that muted it is
still created (it carries the email and push the account keeps on, and the
guardian rules), but it never shows in the bell, the counters or the list.
Urgent alerts (warnings: emergencies) are never muted, as the tab promises.
"""

from unittest import mock

import pytest
from django.core import mail
from django.urls import reverse

from apps.accounts.factories import AdminFactory, ParentFactory
from apps.accounts.models import NotificationPreference
from apps.core.badges import portal_badges
from apps.portal.models import Announcement, Notification, PushSubscription
from apps.portal.services import (
    dispatch_pending_notifications,
    emergency_broadcast,
    fanout_announcement,
)

pytestmark = pytest.mark.django_db


def _prefs(user, **fields):
    prefs = NotificationPreference.for_user(user)
    for k, v in fields.items():
        setattr(prefs, k, v)
    prefs.save()


def _comunicado():
    ann = Announcement.objects.create(
        title="Festival de invierno", body="Viernes 10:00.", audience="parents", is_active=True
    )
    fanout_announcement(ann)
    return ann


def _bell(api_client, user):
    api_client.force_authenticate(user)
    return [n["title"] for n in api_client.get(reverse("notifications")).data["results"]]


def test_in_app_off_keeps_the_comunicado_out_of_the_bell_but_emails_it(api_client):
    muted = ParentFactory(email="silencio@ejemplo.mx")
    _prefs(muted, in_app_enabled=False)
    other = ParentFactory(email="todo@ejemplo.mx")
    ann = _comunicado()
    row = Notification.objects.get(announcement=ann, user=muted)
    assert row.in_app is False and row.is_read is True
    assert _bell(api_client, muted) == []
    assert _bell(api_client, other) == ["Festival de invierno"]
    mail.outbox.clear()
    dispatch_pending_notifications()
    assert sorted(a for m in mail.outbox for a in m.to) == [
        "silencio@ejemplo.mx",
        "todo@ejemplo.mx",
    ]


def test_comunicados_muted_by_category_leave_the_bell_and_the_mailbox():
    muted = ParentFactory(email="silencio@ejemplo.mx")
    _prefs(muted, cat_info=False)
    ann = _comunicado()
    assert Notification.objects.get(announcement=ann, user=muted).in_app is False
    mail.outbox.clear()
    dispatch_pending_notifications()
    assert mail.outbox == []


def test_counters_detail_and_mark_read_ignore_the_hidden_row(api_client):
    muted = ParentFactory()
    _prefs(muted, in_app_enabled=False)
    ann = _comunicado()
    row = Notification.objects.get(announcement=ann, user=muted)
    api_client.force_authenticate(muted)
    assert api_client.get(reverse("dashboard")).data["unread_notifications"] == 0
    assert portal_badges(muted)["notificaciones"] == 0
    assert api_client.get(reverse("notification-detail", args=[row.pk])).status_code == 404
    assert api_client.post(reverse("notification-read", args=[row.pk])).status_code == 404
    assert api_client.get(reverse("notifications"), {"unread": "1"}).data["count"] == 0


def test_an_emergency_is_never_muted(api_client):
    muted = ParentFactory(email="silencio@ejemplo.mx")
    _prefs(muted, in_app_enabled=False, cat_info=False, email_enabled=False)
    mail.outbox.clear()
    emergency_broadcast(
        title="Suspensión de clases",
        message="Mañana no hay clases.",
        audience="parents",
        dispatch_limit=50,
    )
    row = Notification.objects.get(user=muted)
    assert row.in_app is True and row.is_read is False
    assert _bell(api_client, muted) == ["Suspensión de clases"]
    assert [m.to for m in mail.outbox] == [["silencio@ejemplo.mx"]]


def test_the_push_of_a_hidden_row_opens_the_portal_not_the_hidden_notification(settings):
    settings.VAPID_PUBLIC_KEY, settings.VAPID_PRIVATE_KEY = "pub", "priv"
    muted = ParentFactory()
    _prefs(muted, in_app_enabled=False)
    PushSubscription.objects.create(
        user=muted, endpoint="https://push.example.com/a", p256dh="k", auth="a"
    )
    _comunicado()
    with mock.patch("apps.portal.push.send_web_push", return_value=1) as push:
        dispatch_pending_notifications()
    assert push.call_args.kwargs["url"] == "/portal"


def test_the_delivery_report_counts_hidden_rows_as_recipients_not_as_read(api_client):
    muted = ParentFactory()
    _prefs(muted, in_app_enabled=False)
    ParentFactory()
    ann = _comunicado()
    api_client.force_authenticate(AdminFactory())
    data = api_client.get(reverse("admin-announcement-delivery", args=[ann.pk])).data
    assert data["recipients"] == 2 and data["read"] == 0
    resp = api_client.get(
        reverse("admin-announcement-delivery-export", args=[ann.pk]), {"fmt": "csv"}
    )
    raw = b"".join(resp.streaming_content) if resp.streaming else resp.content
    header, *rows = [line for line in raw.decode("utf-8-sig").splitlines() if line]
    assert "En el portal" in header
    portal_col = header.split(",").index("En el portal")
    read_col = header.split(",").index("Leído")
    by_email = {r.split(",")[1]: r.split(",") for r in rows}
    assert by_email[muted.email][portal_col] == "No" and by_email[muted.email][read_col] == "No"


def test_accounts_with_default_preferences_see_it_as_before(api_client):
    parent = ParentFactory()  # never saved preferences
    ann = _comunicado()
    row = Notification.objects.get(announcement=ann, user=parent)
    assert row.in_app is True and row.is_read is False
    assert _bell(api_client, parent) == ["Festival de invierno"]
