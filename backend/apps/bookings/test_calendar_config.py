"""Google Calendar setup (owner points 2026-11-25): production held the sign-in
client's id and secret in the calendar variables, so nothing ever synced and
nothing said why. These cover the diagnostics (which variable, never its value),
the family-invite switch and ``sync_calendar --check``. Google is always mocked."""

import json
import logging
from datetime import time, timedelta
from io import StringIO
from unittest import mock

import pytest
from django.core.management import CommandError, call_command
from django.utils import timezone

from .models import AvailabilitySlot, Booking, VisitType
from .services import calendar

pytestmark = pytest.mark.django_db

# Shapes of the values production held (made up here, never the real ones).
OAUTH_CLIENT_ID = "123456789012-abcdefghijklmnopqrstuvwxyz012345.apps.googleusercontent.com"
OAUTH_SECRET = "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00"
CALENDAR_ID = "abc123visitas@group.calendar.google.com"
SA_EMAIL = "visitas-bot@interlaken-calendar.iam.gserviceaccount.com"


@pytest.fixture
def key_file(tmp_path):
    path = tmp_path / "google-calendar.json"
    path.write_text(
        json.dumps(
            {
                "type": "service_account",
                "client_email": SA_EMAIL,
                "private_key": "-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----\n",
                "project_id": "interlaken-calendar",
            }
        ),
        encoding="utf-8",
    )
    return str(path)


@pytest.fixture
def configured(settings, key_file):
    settings.GOOGLE_CALENDAR_ID = CALENDAR_ID
    settings.GOOGLE_CALENDAR_SA_KEY = key_file
    settings.GOOGLE_CALENDAR_INVITE_FAMILY = False
    return key_file


@pytest.fixture
def service():
    """A mocked Calendar API client returned by ``_get_service``."""
    svc = mock.MagicMock(name="calendar-service")
    svc.events.return_value.insert.return_value.execute.return_value = {"id": "evt-1"}
    with mock.patch.object(calendar, "_get_service", return_value=svc):
        yield svc


def _booking(days=2, status=Booking.Status.CONFIRMED, **kw):
    slot = AvailabilitySlot.objects.create(
        visit_type=kw.pop("visit_type", VisitType.INDIVIDUAL),
        title=kw.pop("title", ""),
        date=timezone.localdate() + timedelta(days=days),
        start_time=time(11),
        end_time=time(11, 45),
        capacity=5,
    )
    return Booking.objects.create(
        slot=slot,
        parent_name="Ana López",
        parent_phone="5512345678",
        parent_email="ana@test.mx",
        status=status,
        **kw,
    )


class TestDiagnose:
    def test_the_production_state_names_both_variables_and_never_their_values(self, settings):
        settings.GOOGLE_CALENDAR_ID = OAUTH_CLIENT_ID
        settings.GOOGLE_CALENDAR_SA_KEY = OAUTH_SECRET
        problems = calendar.diagnose()
        assert len(problems) == 2
        assert "GOOGLE_CALENDAR_ID" in problems[0] and "inicio de sesión" in problems[0]
        assert "GOOGLE_CALENDAR_SA_KEY" in problems[1] and "secreto" in problems[1]
        text = " ".join(problems)
        assert OAUTH_CLIENT_ID not in text and OAUTH_SECRET not in text and "GOCSPX" not in text
        assert not calendar.is_configured()

    @pytest.mark.parametrize(
        "calendar_id, key, expected",
        [
            ("", "", ["GOOGLE_CALENDAR_ID está vacío", "GOOGLE_CALENDAR_SA_KEY está vacío"]),
            (
                "visitas",
                "",
                ["no parece el id de un calendario", "GOOGLE_CALENDAR_SA_KEY está vacío"],
            ),
            (CALENDAR_ID, "google-calendar.json", ["no es la ruta de un archivo"]),
        ],
    )
    def test_each_problem_in_plain_words(self, settings, calendar_id, key, expected):
        settings.GOOGLE_CALENDAR_ID = calendar_id
        settings.GOOGLE_CALENDAR_SA_KEY = key
        problems = calendar.diagnose()
        assert len(problems) == len(expected)
        for problem, words in zip(problems, expected, strict=True):
            assert words in problem

    def test_a_missing_file_shows_its_path(self, settings, tmp_path):
        settings.GOOGLE_CALENDAR_ID = CALENDAR_ID
        missing = str(tmp_path / "secrets" / "google-calendar.json")
        settings.GOOGLE_CALENDAR_SA_KEY = missing
        [problem] = calendar.diagnose()
        assert missing in problem and "no existe" in problem

    @pytest.mark.parametrize(
        "content, words",
        [
            ("not json", "no es un archivo JSON válido"),
            (
                json.dumps({"web": {"client_id": "x", "client_secret": "y"}}),
                "no es una clave de cuenta de servicio",
            ),
        ],
    )
    def test_a_file_that_is_not_a_service_account_key(self, settings, tmp_path, content, words):
        path = tmp_path / "google-calendar.json"
        path.write_text(content, encoding="utf-8")
        settings.GOOGLE_CALENDAR_ID = CALENDAR_ID
        settings.GOOGLE_CALENDAR_SA_KEY = str(path)
        [problem] = calendar.diagnose()
        assert words in problem
        assert calendar.service_account_email() == ""

    def test_a_good_setup_has_no_problems(self, configured):
        assert calendar.diagnose() == []
        assert calendar.is_configured()
        assert calendar.service_account_email() == SA_EMAIL

    def test_an_oauth_client_id_never_counts_as_configured(self, settings, key_file):
        settings.GOOGLE_CALENDAR_ID = OAUTH_CLIENT_ID
        settings.GOOGLE_CALENDAR_SA_KEY = key_file
        assert not calendar.is_configured()


class TestWarning:
    def test_one_warning_per_process_when_half_configured(self, settings, caplog, monkeypatch):
        monkeypatch.setattr(calendar, "_warned_unconfigured", False)
        settings.GOOGLE_CALENDAR_ID = OAUTH_CLIENT_ID
        settings.GOOGLE_CALENDAR_SA_KEY = OAUTH_SECRET
        booking = _booking()
        with caplog.at_level(logging.WARNING, logger="apps.bookings.services.calendar"):
            assert calendar.sync_booking_created(booking) == ""
            assert calendar.sync_booking_created(booking) == ""
        warnings = [
            r for r in caplog.records if "Google Calendar no está configurado" in r.getMessage()
        ]
        assert len(warnings) == 1
        assert OAUTH_SECRET not in warnings[0].getMessage()

    def test_silent_when_the_calendar_is_simply_off(self, settings, caplog, monkeypatch):
        monkeypatch.setattr(calendar, "_warned_unconfigured", False)
        settings.GOOGLE_CALENDAR_ID = ""
        settings.GOOGLE_CALENDAR_SA_KEY = ""
        with caplog.at_level(logging.WARNING, logger="apps.bookings.services.calendar"):
            calendar.sync_booking_created(_booking())
        assert not caplog.records


class TestEvents:
    def test_no_family_invite_by_default(self, configured, service):
        booking = _booking()
        assert calendar.sync_booking_created(booking) == "evt-1"
        booking.refresh_from_db()
        assert booking.google_event_id == "evt-1"
        insert = service.events.return_value.insert
        insert.assert_called_once()
        kwargs = insert.call_args.kwargs
        assert kwargs["calendarId"] == CALENDAR_ID and kwargs["sendUpdates"] == "none"
        body = kwargs["body"]
        assert "attendees" not in body
        assert body["summary"] == "Visita individual: Ana López"
        assert (
            "Familia: Ana López" in body["description"]
            and "Teléfono: 5512345678" in body["description"]
        )
        assert "/admin/visitas?desde=" in body["description"]
        assert "—" not in body["summary"] + body["description"]

    def test_open_class_summary_names_the_event_and_the_people(self, configured, service):
        booking = _booking(
            visit_type=VisitType.OPEN_CLASS, title="Puertas Abiertas", num_attendees=3
        )
        calendar.create_event(booking)
        body = service.events.return_value.insert.call_args.kwargs["body"]
        assert body["summary"] == "Puertas Abiertas: Ana López (3 asistentes)"

    def test_with_the_switch_on_the_family_is_invited_and_a_refusal_retries_without(
        self, settings, configured, service
    ):
        settings.GOOGLE_CALENDAR_INVITE_FAMILY = True
        insert = service.events.return_value.insert
        insert.return_value.execute.side_effect = [
            Exception("Service accounts cannot invite attendees without Domain-Wide Delegation"),
            {"id": "evt-2"},
        ]
        assert calendar.create_event(_booking()) == "evt-2"
        first, second = insert.call_args_list
        assert first.kwargs["sendUpdates"] == "all" and first.kwargs["body"]["attendees"] == [
            {"email": "ana@test.mx"}
        ]
        assert second.kwargs["sendUpdates"] == "none" and "attendees" not in second.kwargs["body"]

    def test_cancelling_tells_nobody_unless_inviting(self, settings, configured, service):
        assert calendar.cancel_event("evt-1")
        assert service.events.return_value.delete.call_args.kwargs["sendUpdates"] == "none"
        settings.GOOGLE_CALENDAR_INVITE_FAMILY = True
        calendar.cancel_event("evt-1")
        assert service.events.return_value.delete.call_args.kwargs["sendUpdates"] == "all"


class _HttpError(Exception):
    def __init__(self, status):
        super().__init__(f"HTTP {status}")
        self.resp = mock.Mock(status=status)


class TestCheckAccess:
    def test_writer_access_is_ok(self, configured, service):
        service.calendarList.return_value.get.return_value.execute.return_value = {
            "summary": "Visitas Interlaken",
            "accessRole": "writer",
        }
        ok, message = calendar.check_access()
        assert ok and "«Visitas Interlaken»" in message
        service.events.assert_not_called()  # the check never writes an event

    def test_read_only_access_says_how_to_share(self, configured, service):
        service.calendarList.return_value.get.return_value.execute.return_value = {
            "summary": "Visitas Interlaken",
            "accessRole": "reader",
        }
        ok, message = calendar.check_access()
        assert not ok and SA_EMAIL in message and "Hacer cambios en los eventos" in message

    def test_a_calendar_not_yet_in_the_list_is_added_then_read(self, configured, service):
        cal_list = service.calendarList.return_value
        cal_list.get.return_value.execute.side_effect = _HttpError(404)
        cal_list.insert.return_value.execute.return_value = {
            "summary": "Visitas",
            "accessRole": "owner",
        }
        ok, _message = calendar.check_access()
        assert ok
        cal_list.insert.assert_called_once_with(body={"id": CALENDAR_ID})

    def test_no_access_at_all(self, configured, service):
        cal_list = service.calendarList.return_value
        cal_list.get.return_value.execute.side_effect = _HttpError(404)
        cal_list.insert.return_value.execute.side_effect = _HttpError(404)
        ok, message = calendar.check_access()
        assert not ok and "no tiene acceso" in message and SA_EMAIL in message


class TestSyncCalendarCommand:
    def _run(self, *args):
        out = StringIO()
        call_command("sync_calendar", *args, stdout=out)
        return out.getvalue()

    def test_production_state_is_explained_every_morning(self, settings):
        settings.GOOGLE_CALENDAR_ID = OAUTH_CLIENT_ID
        settings.GOOGLE_CALENDAR_SA_KEY = OAUTH_SECRET
        out = self._run()
        assert (
            "no está configurado" in out
            and "GOOGLE_CALENDAR_ID" in out
            and "GOOGLE_CALENDAR_SA_KEY" in out
        )
        assert "docs/GOOGLE_CALENDAR.md" in out
        assert OAUTH_CLIENT_ID not in out and OAUTH_SECRET not in out
        with pytest.raises(CommandError):
            self._run("--check")

    def test_check_reports_the_service_account_and_the_calendar(self, configured, service):
        service.calendarList.return_value.get.return_value.execute.return_value = {
            "summary": "Visitas Interlaken",
            "accessRole": "writer",
        }
        out = self._run("--check")
        assert SA_EMAIL in out and "Conexión correcta" in out
        service.events.assert_not_called()

    def test_first_sync_creates_events_from_today_on_only(self, configured, service):
        upcoming = _booking(days=1)
        today = _booking(days=0)
        past = _booking(days=-3)
        cancelled_future = _booking(days=4, status=Booking.Status.CANCELLED)
        out = self._run()
        assert "2 eventos creados" in out
        for booking, expected in (
            (upcoming, "evt-1"),
            (today, "evt-1"),
            (past, ""),
            (cancelled_future, ""),
        ):
            booking.refresh_from_db()
            assert booking.google_event_id == expected
        self._run("--include-past")
        past.refresh_from_db()
        assert past.google_event_id == "evt-1"
