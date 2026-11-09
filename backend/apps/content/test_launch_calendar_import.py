"""Pre-launch admin review (2026-11-09): calendar import updates.

A file with only «titulo,inicio» matching an event reset its type and level,
cleared its description and published it, while the dry run just said
«actualizar». An update now writes the cells the file fills; the preview
names what changes, and a row that changes nothing is «omitir».
"""

import io
from datetime import date

import pytest
from django.urls import reverse

from apps.content.models import SchoolEvent

pytestmark = pytest.mark.django_db
URL = "admin-calendar-import"


def _csv(text: str):
    upload = io.BytesIO(text.encode("utf-8"))
    upload.name = "calendario.csv"
    return upload


def _event(**o):
    base = dict(
        title="Junta",
        kind="meeting",
        start_date=date(2026, 9, 1),
        level="primaria",
        description="Salón 3",
        is_published=False,
    )
    base.update(o)
    return SchoolEvent.objects.create(**base)


def _post(client, text, dry_run):
    return client.post(
        reverse(URL), {"file": _csv(text), "dry_run": "1" if dry_run else "0"}, format="multipart"
    )


def test_a_row_that_changes_nothing_is_skipped(admin_client):
    event = _event()
    dry = _post(admin_client, "titulo,inicio\r\nJunta,01/09/2026\r\n", True)
    row = dry.data["rows"][0]
    assert row["action"] == "omitir" and row["warnings"] == ["sin cambios"]

    assert _post(admin_client, "titulo,inicio\r\nJunta,01/09/2026\r\n", False).status_code == 200
    event.refresh_from_db()
    assert (event.kind, event.level, event.description, event.is_published) == (
        "meeting",
        "primaria",
        "Salón 3",
        False,
    )


def test_an_update_writes_only_the_cells_the_file_fills(admin_client):
    event = _event()
    text = "titulo,inicio,tipo,nivel,descripcion,publicado\r\nJunta,01/09/2026,,,Salón 4,\r\n"
    dry = _post(admin_client, text, True)
    row = dry.data["rows"][0]
    assert row["action"] == "actualizar"
    assert row["warnings"] == [
        "Cambia: descripción. Las celdas vacías conservan lo que ya tiene el evento."
    ]

    assert _post(admin_client, text, False).status_code == 200
    event.refresh_from_db()
    assert (event.kind, event.level, event.description, event.is_published) == (
        "meeting",
        "primaria",
        "Salón 4",
        False,
    )


def test_publishing_is_said_and_done_only_when_the_cell_says_so(admin_client):
    event = _event()
    text = "titulo,inicio,publicado\r\nJunta,01/09/2026,sí\r\n"
    dry = _post(admin_client, text, True)
    assert dry.data["rows"][0]["warnings"][0].endswith("Se publicará.")
    _post(admin_client, text, False)
    event.refresh_from_db()
    assert event.is_published is True


def test_todos_resets_the_level_on_purpose(admin_client):
    event = _event()
    _post(admin_client, "titulo,inicio,nivel\r\nJunta,01/09/2026,todos\r\n", False)
    event.refresh_from_db()
    assert event.level == ""


def test_a_new_event_is_still_published_by_default(admin_client):
    _post(admin_client, "titulo,inicio\r\nNuevo,02/09/2026\r\n", False)
    assert SchoolEvent.objects.get(title="Nuevo").is_published is True
