"""Emergency broadcast: the WhatsApp blast runs after the response (launch leftover D2).

Before: ``emergency_broadcast(whatsapp=True)`` called the Cloud API once per
number inside the request (10 s timeout each), so a large audience could hit
gunicorn's 60 s limit. Now the request records one pending row per distinct
number and returns; a thread sends them after the response and the 5-minute
``dispatch_notifications`` cron finishes whatever a killed thread left. Each
row is sent at most once, whoever sends it. In-app and email are unchanged.
"""

from datetime import timedelta
from unittest import mock

import pytest
from django.core import mail
from django.core.management import call_command
from django.urls import reverse
from django.utils import timezone

from apps.accounts.factories import AdminFactory, ParentFactory, StudentUserFactory, UserFactory
from apps.accounts.models import User
from apps.portal import services
from apps.portal.models import AnnouncementDelivery, Notification
from apps.portal.services import dispatch_pending_whatsapp, emergency_broadcast, normalize_phone

pytestmark = pytest.mark.django_db

PENDING, SENT, FAILED, SKIPPED = (
    Notification.Delivery.PENDING,
    Notification.Delivery.SENT,
    Notification.Delivery.FAILED,
    Notification.Delivery.SKIPPED,
)


@pytest.fixture
def wa_settings(settings):
    settings.WHATSAPP_TOKEN = "test-token"
    settings.WHATSAPP_PHONE_ID = "test-phone-id"
    return settings


@pytest.fixture
def no_thread(monkeypatch):
    """The after-response thread never starts: what a killed worker leaves."""
    started = []
    monkeypatch.setattr(services, "run_in_background", lambda fn, *, name: started.append(name))
    return started


@pytest.fixture
def inline_thread(monkeypatch):
    """The after-response thread runs synchronously (SQLite test DB is per connection)."""
    monkeypatch.setattr(services, "run_in_background", lambda fn, *, name: fn())


def _broadcast(**kw):
    return emergency_broadcast(
        title="Suspensión de clases",
        message="Mañana no hay clases por corte de agua.",
        audience=kw.pop("audience", "parents"),
        whatsapp=True,
        **kw,
    )


def _wa_rows(**filters):
    return AnnouncementDelivery.objects.filter(channel="whatsapp", **filters)


class TestTheRequest:
    def test_records_the_deliveries_and_sends_nothing_inline(
        self, wa_settings, no_thread, django_capture_on_commit_callbacks
    ):
        for i in range(3):
            ParentFactory(whatsapp=f"55 1000 000{i}")
        ParentFactory(whatsapp="")  # no number: in-app and email only
        with (
            mock.patch("apps.whatsapp.services.send_text", return_value=True) as send,
            django_capture_on_commit_callbacks(execute=True),
        ):
            result = _broadcast()
        send.assert_not_called()  # nothing inside the request
        assert result["whatsapp_queued"] == 3 and result["whatsapp_configured"] is True
        assert _wa_rows(status=PENDING).count() == 3
        assert no_thread == [f'whatsapp-broadcast-{result["announcement_id"]}']

    def test_in_app_and_email_behave_as_before(self, wa_settings, no_thread):
        ParentFactory(email="mama@ejemplo.mx", whatsapp="55 1000 0001")
        mail.outbox.clear()
        result = _broadcast(dispatch_limit=50)
        assert result["notified"] == 1 and result["dispatched"] == 1
        n = Notification.objects.get()
        assert n.notif_type == Notification.NotifType.WARNING and n.delivered_at is not None
        assert [m.to for m in mail.outbox] == [["mama@ejemplo.mx"]]

    def test_one_message_per_number_across_family_logins(self, wa_settings, no_thread):
        """Siblings' logins (and the parent's) that share a number, written
        differently, get one message; distinct numbers each get theirs."""
        ParentFactory(whatsapp="55 1234 5678")
        StudentUserFactory(whatsapp="+52 1 55 1234 5678")
        StudentUserFactory(whatsapp="5512345678")
        ParentFactory(whatsapp="55 8765 4321")
        result = _broadcast()
        assert result["whatsapp_queued"] == 2
        assert sorted(_wa_rows().values_list("address", flat=True)) == ["5512345678", "5587654321"]

    def test_the_cap_counts_distinct_numbers(self, wa_settings, no_thread):
        for i in range(5):
            ParentFactory(whatsapp=f"55 2000 000{i}")
        assert _broadcast(whatsapp_limit=3)["whatsapp_queued"] == 3

    def test_audience_rule_is_shared_with_the_fan_out(self, wa_settings, no_thread):
        """«Personal» reaches staff numbers only; family audiences never do."""
        UserFactory(role=User.Role.STAFF, whatsapp="55 3000 0001")
        ParentFactory(whatsapp="55 3000 0002")
        _broadcast(audience="staff")
        assert list(_wa_rows().values_list("address", flat=True)) == ["5530000001"]

    def test_without_cloud_api_credentials_nothing_is_recorded(self, settings, no_thread):
        settings.WHATSAPP_TOKEN = settings.WHATSAPP_PHONE_ID = ""
        ParentFactory(whatsapp="55 1000 0001")
        result = _broadcast()
        assert result["whatsapp_queued"] == 0 and result["whatsapp_configured"] is False
        assert not _wa_rows().exists() and no_thread == []

    def test_the_endpoint_answers_with_the_queue(
        self, api_client, wa_settings, no_thread, django_capture_on_commit_callbacks
    ):
        ParentFactory(whatsapp="55 1000 0001")
        api_client.force_authenticate(AdminFactory())
        with (
            mock.patch("apps.whatsapp.services.send_text") as send,
            django_capture_on_commit_callbacks(execute=True),
        ):
            resp = api_client.post(
                reverse("admin-broadcast"),
                {
                    "title": "Simulacro",
                    "message": "Evacuación a las 10:00.",
                    "audience": "parents",
                    "whatsapp": True,
                },
                format="json",
            )
        assert resp.status_code == 201
        assert resp.data["whatsapp_queued"] == 1 and resp.data["whatsapp_configured"] is True
        send.assert_not_called()


class TestTheSender:
    def test_the_thread_sends_each_number_once(
        self, wa_settings, inline_thread, django_capture_on_commit_callbacks
    ):
        ParentFactory(whatsapp="55 1000 0001")
        ParentFactory(whatsapp="55 1000 0002")
        with (
            mock.patch("apps.whatsapp.services.send_text", return_value=True) as send,
            django_capture_on_commit_callbacks(execute=True),
        ):
            _broadcast()
        assert sorted(c.args[0] for c in send.call_args_list) == ["55 1000 0001", "55 1000 0002"]
        assert send.call_args.args[1].startswith("Suspensión de clases\n\nMañana no hay clases")
        assert _wa_rows(status=SENT).count() == 2
        assert all(r.sent_at and r.attempts == 1 for r in _wa_rows())

    def test_the_cron_finishes_what_a_killed_thread_left_and_never_resends(
        self, wa_settings, no_thread
    ):
        ParentFactory(whatsapp="55 1000 0001")
        ParentFactory(whatsapp="55 1000 0002")
        _broadcast()
        with mock.patch("apps.whatsapp.services.send_text", return_value=True) as send:
            call_command("dispatch_notifications")
            call_command("dispatch_notifications")  # the next run: nothing left
        assert send.call_count == 2
        assert _wa_rows(status=SENT).count() == 2

    def test_a_row_another_sender_holds_is_skipped(self, wa_settings, no_thread):
        """The claim: a row that is no longer pending when its turn comes
        (another sender took it) is never sent again."""
        ParentFactory(whatsapp="55 1000 0001")
        _broadcast()
        row = _wa_rows().get()
        original_first = AnnouncementDelivery.objects.select_for_update

        def taken_meanwhile(*args, **kwargs):
            AnnouncementDelivery.objects.filter(pk=row.pk).update(status=SENT)
            return original_first(*args, **kwargs)

        with (
            mock.patch("apps.whatsapp.services.send_text", return_value=True) as send,
            mock.patch.object(
                AnnouncementDelivery.objects, "select_for_update", side_effect=taken_meanwhile
            ),
        ):
            assert dispatch_pending_whatsapp() == 0
        send.assert_not_called()

    def test_a_failed_send_is_retried_then_closed(self, wa_settings, no_thread):
        ParentFactory(whatsapp="55 1000 0001")
        _broadcast()
        with mock.patch("apps.whatsapp.services.send_text", return_value=False) as send:
            for _ in range(services.WHATSAPP_MAX_ATTEMPTS + 1):
                dispatch_pending_whatsapp()
        assert send.call_count == services.WHATSAPP_MAX_ATTEMPTS
        row = _wa_rows().get()
        assert row.status == FAILED and row.attempts == services.WHATSAPP_MAX_ATTEMPTS
        assert row.last_error

    def test_a_send_that_raises_counts_as_a_failed_attempt(self, wa_settings, no_thread):
        ParentFactory(whatsapp="55 1000 0001")
        ParentFactory(whatsapp="55 1000 0002")
        _broadcast()
        with mock.patch(
            "apps.whatsapp.services.send_text", side_effect=[RuntimeError("boom"), True]
        ):
            assert dispatch_pending_whatsapp() == 1
        assert sorted(_wa_rows().values_list("status", "attempts")) == [(PENDING, 1), (SENT, 1)]

    def test_a_day_old_emergency_is_not_sent_late(self, wa_settings, no_thread):
        ParentFactory(whatsapp="55 1000 0001")
        _broadcast()
        _wa_rows().update(created_at=timezone.now() - timedelta(hours=25))
        with mock.patch("apps.whatsapp.services.send_text") as send:
            assert dispatch_pending_whatsapp() == 0
        send.assert_not_called()
        assert _wa_rows().get().status == SKIPPED

    def test_the_thread_stops_at_its_budget_and_the_cron_continues(self, wa_settings, no_thread):
        for i in range(3):
            ParentFactory(whatsapp=f"55 1000 000{i}")
        _broadcast()
        with mock.patch("apps.whatsapp.services.send_text", return_value=True) as send:
            assert dispatch_pending_whatsapp(time_budget=0) == 0  # spent: takes no new row
            assert _wa_rows(status=PENDING).count() == 3
            assert dispatch_pending_whatsapp() == 3  # the next run sends them
        assert send.call_count == 3


class TestTheConsole:
    def test_the_delivery_report_counts_the_blast(self, api_client, wa_settings, no_thread):
        ParentFactory(whatsapp="55 1000 0001")
        ParentFactory(whatsapp="55 1000 0002")
        result = _broadcast()
        _wa_rows().filter(address="5510000001").update(status=SENT)
        api_client.force_authenticate(AdminFactory())
        resp = api_client.get(
            reverse("admin-announcement-delivery", args=[result["announcement_id"]])
        )
        assert resp.data["whatsapp"] == {"pending": 1, "sent": 1, "skipped": 0, "failed": 0}

    def test_a_comunicado_without_whatsapp_reports_none(self, api_client, no_thread):
        ParentFactory()
        result = emergency_broadcast(title="Aviso", message="Texto", audience="parents")
        api_client.force_authenticate(AdminFactory())
        resp = api_client.get(
            reverse("admin-announcement-delivery", args=[result["announcement_id"]])
        )
        assert resp.data["whatsapp"] is None


@pytest.mark.parametrize(
    "raw, key",
    [
        ("55 1234 5678", "5512345678"),
        ("+52 1 55 1234 5678", "5512345678"),
        ("(55) 1234-5678", "5512345678"),
        ("1234567", ""),
        ("", ""),
    ],
)
def test_normalize_phone(raw, key):
    assert normalize_phone(raw) == key
