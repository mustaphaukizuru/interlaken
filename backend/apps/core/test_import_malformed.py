"""QA sweep 2026-11-24: every CSV/XLSX import answers 400 (never 500) for a
malformed file, and stops reading once a file is over its row cap."""
import io
import zipfile

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.urls import reverse
from openpyxl import Workbook

from apps.core.importing import UploadError, parse_upload

pytestmark = pytest.mark.django_db

IMPORT_URLS = [
    "import-students",
    "admin-staff-import",
    "pre-register-import",
    "bookings-admin-slots-import",
    "admin-calendar-import",
    "admin-redirects-import",
    "admin-balances-import",
]


def _xlsx(rows):
    wb = Workbook()
    ws = wb.active
    for r in rows:
        ws.append(r)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def _truncated_sheet_xlsx():
    """A valid workbook whose sheet XML is cut in half: openpyxl opens it and
    only fails (xml ParseError) while iterating the rows."""
    src = zipfile.ZipFile(io.BytesIO(_xlsx([["matricula", "nombre"], ["1", "x"]])))
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as z:
        for item in src.infolist():
            content = src.read(item.filename)
            if item.filename == "xl/worksheets/sheet1.xml":
                content = content[: len(content) // 2]
            z.writestr(item, content)
    return out.getvalue()


MALFORMED = {
    # Binary bytes decode as latin-1 and carry bare CRs: csv.Error.
    "garbage.csv": bytes(range(256)) * 20,
    # One 200 KB cell is above csv's 131,072-character field limit.
    "bigfield.csv": b"matricula,nombre\n1," + b"x" * 200_000 + b"\n",
    "corrupt-sheet.xlsx": _truncated_sheet_xlsx(),
}


@pytest.mark.parametrize("url_name", IMPORT_URLS)
@pytest.mark.parametrize("filename", sorted(MALFORMED))
def test_malformed_file_is_a_400_on_every_import(admin_client, url_name, filename):
    upload = SimpleUploadedFile(filename, MALFORMED[filename],
                                content_type="application/octet-stream")
    resp = admin_client.post(reverse(url_name), {"file": upload}, format="multipart")
    assert resp.status_code == 400, (url_name, filename, resp.content[:300])
    assert "No se pudo leer el archivo" in resp.data["detail"]


@pytest.mark.parametrize("url_name", IMPORT_URLS)
def test_over_the_row_cap_is_still_a_413(admin_client, url_name):
    body = b"matricula,nombre\n" + b"1,a\n" * 2_100
    upload = SimpleUploadedFile("many.csv", body, content_type="text/csv")
    resp = admin_client.post(reverse(url_name), {"file": upload}, format="multipart")
    assert resp.status_code == 413, (url_name, resp.content[:300])


class TestParseUploadStopsAtTheCap:
    def test_csv_stops_reading_at_cap_plus_one(self):
        body = b"a,b\n" + b"1,2\n" * 50_000
        rows, headers, fmt = parse_upload(SimpleUploadedFile("x.csv", body), max_rows=10)
        assert fmt == "csv" and headers == ["a", "b"]
        assert len(rows) == 11

    def test_xlsx_stops_reading_at_cap_plus_one(self):
        data = _xlsx([["a", "b"]] + [[i, i] for i in range(500)])
        rows, _headers, fmt = parse_upload(SimpleUploadedFile("x.xlsx", data), max_rows=10)
        assert fmt == "xlsx" and len(rows) == 11

    def test_without_a_cap_everything_is_read(self):
        body = b"a,b\n" + b"1,2\n" * 50
        rows, _headers, _fmt = parse_upload(SimpleUploadedFile("x.csv", body))
        assert len(rows) == 50

    def test_csv_error_names_the_line(self):
        with pytest.raises(UploadError, match="fila 2"):
            parse_upload(SimpleUploadedFile("x.csv", MALFORMED["bigfield.csv"]))

    def test_valid_files_still_parse(self):
        rows, headers, _ = parse_upload(SimpleUploadedFile(
            "ok.csv", "matrícula;nombre\r\n7;José\r\n".encode("utf-8-sig")))
        assert headers == ["matrícula", "nombre"]
        assert rows == [(2, {"matrícula": "7", "nombre": "José"})]
