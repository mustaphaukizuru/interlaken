"""«Costos y precios» console API (pricing_admin.py): read, atomic save-all,
validation, version conflicts, audit with amounts, cache, export and import."""

import io
from decimal import Decimal

import pytest
from django.core.cache import cache
from openpyxl import Workbook, load_workbook

from apps.accounts.factories import ParentFactory, UserFactory
from apps.core.models import AuditLog

from .models import PRICING_CACHE_KEY, EnrollmentFee, FixedConcept, PricingPolicy, TuitionCost

pytestmark = pytest.mark.django_db

BASE = "/api/v1/content/admin/pricing/"
PUBLIC = "/api/v1/content/pricing/"


@pytest.fixture(autouse=True)
def _clear_cache():
    cache.clear()
    yield
    cache.clear()


def table(client, key):
    return client.get(f"{BASE}{key}/").json()


def put_table(client, key, rows, version=None, **extra):
    body = {"rows": rows, **extra}
    if version:
        body["version"] = version
    return client.put(f"{BASE}{key}/", body, format="json")


# ── access ────────────────────────────────────────────────
def test_only_admins(api_client):
    assert api_client.get(BASE).status_code in (401, 403)
    api_client.force_authenticate(user=ParentFactory())
    assert api_client.get(BASE).status_code == 403
    staff = UserFactory(role="staff", staff_areas=["admisiones", "comunicados", "cafeteria"])
    api_client.force_authenticate(user=staff)
    assert api_client.get(BASE).status_code == 403
    assert api_client.put(f"{BASE}seguros/", {"rows": []}, format="json").status_code == 403
    assert api_client.get(f"{BASE}export/").status_code == 403


# ── read ──────────────────────────────────────────────────
def test_lists_every_table_in_public_order(admin_client):
    data = admin_client.get(BASE).json()["tables"]
    assert list(data) == [
        "inscripcion",
        "colegiaturas",
        "seguros",
        "extraescolares",
        "estancia",
        "politicas",
    ]
    fees = data["inscripcion"]["rows"]
    assert len(fees) == 6
    assert {"id", "is_active", "modality", "section", "gastos_administrativos", "cuota"} <= set(
        fees[0]
    )
    assert fees[0]["cuota"] == "7000.00"
    tuition = data["colegiaturas"]["rows"]
    assert [r["section"] for r in tuition] == [
        "Sección Maternal",
        "1° a 3° de Preescolar",
        "Primaria",
        "Secundaria",
    ]
    multa = [r for r in data["estancia"]["rows"] if r["monthly_cost"] is None]
    assert multa and multa[0]["monthly_note"]
    for t in data.values():
        assert t["version"]


def test_unknown_table(admin_client):
    assert admin_client.get(f"{BASE}nada/").status_code == 404
    assert (
        admin_client.put(BASE, {"tables": {"nada": {"rows": []}}}, format="json").status_code == 400
    )


# ── save ──────────────────────────────────────────────────
def test_change_one_amount_audits_before_and_after_and_refreshes_the_site(
    admin_client, api_client, django_capture_on_commit_callbacks
):
    assert api_client.get(PUBLIC).status_code == 200  # primes the public cache
    t = table(admin_client, "colegiaturas")
    rows = t["rows"]
    primaria = next(r for r in rows if r["section"] == "Primaria")
    primaria["colegiatura"] = "6,700.50"  # thousands separator accepted
    with django_capture_on_commit_callbacks(execute=True):
        res = put_table(admin_client, "colegiaturas", rows, t["version"])
    assert res.status_code == 200, res.json()
    assert res.json()["counts"] == {"created": 0, "updated": 1, "deleted": 0}
    assert TuitionCost.objects.get(section="Primaria").colegiatura == Decimal("6700.50")
    entry = AuditLog.objects.filter(object_type="content.tuitioncost", action="update").latest("id")
    assert entry.changes == {"colegiatura": ["6650.00", "6700.50"]}
    assert entry.context == "cms.pricing"
    public = api_client.get(PUBLIC).json()
    assert any(r["colegiatura"] == "6700.50" for r in public["tuition"])
    # The new version differs; the old one is now stale.
    assert res.json()["version"] != t["version"]


def test_grouped_inscripcion_keeps_its_order_per_modality(admin_client):
    t = table(admin_client, "inscripcion")
    rows = sorted(t["rows"], key=lambda r: (r["modality"] != "nuevo_ingreso", r["cuota"]))
    res = put_table(admin_client, "inscripcion", rows, t["version"])
    assert res.json()["counts"] == {"created": 0, "updated": 0, "deleted": 0}
    rows[0], rows[1] = rows[1], rows[0]  # Primaria before Preescolar (nuevo ingreso)
    res = put_table(admin_client, "inscripcion", rows, res.json()["version"])
    assert res.json()["counts"] == {"created": 0, "updated": 2, "deleted": 0}
    nuevo = EnrollmentFee.objects.filter(modality="nuevo_ingreso").order_by("order")
    assert [(f.section, f.order) for f in nuevo] == [
        ("Primaria", 1),
        ("Preescolar", 2),
        ("Secundaria", 3),
    ]
    re = EnrollmentFee.objects.filter(modality="reinscripcion").order_by("order")
    assert [f.order for f in re] == [1, 2, 3]


def test_unchanged_save_writes_nothing(admin_client):
    t = table(admin_client, "seguros")
    before = AuditLog.objects.count()
    res = put_table(admin_client, "seguros", t["rows"], t["version"])
    assert res.status_code == 200
    assert res.json()["counts"] == {"created": 0, "updated": 0, "deleted": 0}
    assert AuditLog.objects.count() == before
    assert res.json()["version"] == t["version"]


def test_create_delete_reorder_and_hide_in_one_save(admin_client):
    t = table(admin_client, "seguros")
    rows = t["rows"]
    deleted = rows.pop(0)  # Seguro accidentes
    rows.reverse()  # Credenciales first
    rows[0]["is_active"] = False
    rows.append({"name": "Seguro escolar ampliado", "cost": "150", "is_active": True})
    res = put_table(admin_client, "seguros", rows, t["version"])
    assert res.status_code == 200, res.json()
    # Credenciales moved and was hidden; Seguro orfandad keeps position 2.
    assert res.json()["counts"] == {"created": 1, "updated": 1, "deleted": 1}
    names = list(FixedConcept.objects.order_by("order").values_list("name", "order", "is_active"))
    assert names == [
        ("Credenciales", 1, False),
        ("Seguro orfandad", 2, True),
        ("Seguro escolar ampliado", 3, True),
    ]
    gone = AuditLog.objects.get(
        object_type="content.fixedconcept", action="delete", object_id=str(deleted["id"])
    )
    assert gone.changes["cost"] == ["500.00", None]
    made = AuditLog.objects.get(object_type="content.fixedconcept", action="create")
    assert made.changes["cost"] == [None, "150.00"]
    # The public bundle shows only visible rows, in the new order.
    public = admin_client.get(PUBLIC).json()["fixed_concepts"]
    assert [c["name"] for c in public] == ["Seguro orfandad", "Seguro escolar ampliado"]


def test_validation_lists_every_problem_and_writes_nothing(admin_client):
    t = table(admin_client, "inscripcion")
    # The console sends each modality as one group: nuevo ingreso, then reinscripción.
    rows = sorted(t["rows"], key=lambda r: (r["modality"] != "nuevo_ingreso", r["cuota"]))
    rows[0]["cuota"] = "-1"
    rows[1]["gastos_administrativos"] = "10.505"
    rows[2]["section"] = "  "
    rows[4]["section"] = rows[3]["section"]  # same level twice in reinscripción
    rows.append(
        {"modality": "otra", "section": "Maternal", "gastos_administrativos": "mil", "cuota": "1e9"}
    )
    res = put_table(admin_client, "inscripcion", rows, t["version"])
    assert res.status_code == 400
    body = res.json()
    assert body["code"] == "invalid_rows"
    errs = {(e["row"], e["field"]): e["message"] for e in body["errors"]["inscripcion"]}
    assert errs[(0, "cuota")] == "El monto no puede ser negativo."
    assert errs[(1, "gastos_administrativos")] == "Use como máximo 2 decimales."
    assert errs[(2, "section")] == "Este dato es obligatorio."
    assert "Repetido en Reinscripción" in errs[(4, "section")]
    assert errs[(6, "modality")].startswith("Elija una modalidad")
    assert errs[(6, "gastos_administrativos")].startswith("Escriba un monto")
    assert errs[(6, "cuota")] == "El monto máximo es $999,999.99."
    label = next(
        e["label"] for e in body["errors"]["inscripcion"] if e["field"] == "gastos_administrativos"
    )
    assert label == "Gastos administrativos"
    assert EnrollmentFee.objects.count() == 6
    assert EnrollmentFee.objects.order_by("order", "id").first().cuota == Decimal("7000.00")


def test_save_all_is_atomic_across_tables(admin_client):
    data = admin_client.get(BASE).json()["tables"]
    seguros = data["seguros"]
    seguros["rows"][0]["cost"] = "999.00"
    politicas = data["politicas"]
    politicas["rows"][0]["text"] = ""
    res = admin_client.put(
        BASE,
        {
            "tables": {
                "seguros": {"rows": seguros["rows"], "version": seguros["version"]},
                "politicas": {"rows": politicas["rows"], "version": politicas["version"]},
            }
        },
        format="json",
    )
    assert res.status_code == 400
    assert list(res.json()["errors"]) == ["politicas"]
    assert FixedConcept.objects.get(name="Seguro accidentes").cost == Decimal("500.00")

    politicas["rows"][0]["text"] = "Nueva política de pago."
    res = admin_client.put(
        BASE,
        {
            "tables": {
                "seguros": {"rows": seguros["rows"], "version": seguros["version"]},
                "politicas": {"rows": politicas["rows"], "version": politicas["version"]},
            }
        },
        format="json",
    )
    assert res.status_code == 200, res.json()
    assert FixedConcept.objects.get(name="Seguro accidentes").cost == Decimal("999.00")
    assert PricingPolicy.objects.order_by("order").first().text == "Nueva política de pago."
    assert set(res.json()["tables"]) == {"seguros", "politicas"}


def test_concurrent_edit_is_a_conflict(admin_client):
    t = table(admin_client, "seguros")
    other = FixedConcept.objects.get(name="Credenciales")
    other.cost = Decimal("400.00")
    other.save()  # someone else saved meanwhile
    t["rows"][0]["cost"] = "1.00"
    res = put_table(admin_client, "seguros", t["rows"], t["version"])
    assert res.status_code == 409
    assert res.json()["code"] == "version_conflict"
    assert res.json()["tables"] == ["seguros"]
    assert FixedConcept.objects.get(name="Seguro accidentes").cost == Decimal("500.00")


def test_unknown_row_id_is_refused(admin_client):
    t = table(admin_client, "seguros")
    t["rows"][0]["id"] = 999999
    res = put_table(admin_client, "seguros", t["rows"], t["version"])
    assert res.status_code == 400
    assert res.json()["errors"]["seguros"][0]["message"].startswith("Esta fila ya no existe")


def test_optional_money_and_long_text(admin_client):
    t = table(admin_client, "estancia")
    rows = t["rows"]
    rows[0]["monthly_cost"] = ""
    rows[1]["monthly_note"] = "x" * 121
    res = put_table(admin_client, "estancia", rows, t["version"])
    assert res.status_code == 400
    assert res.json()["errors"]["estancia"] == [
        {
            "row": 1,
            "field": "monthly_note",
            "label": "Nota de la mensualidad",
            "message": "Máximo 120 caracteres.",
        }
    ]
    rows[1]["monthly_note"] = "Matutina y vespertina"
    res = put_table(admin_client, "estancia", rows, t["version"])
    assert res.status_code == 200
    assert res.json()["rows"][0]["monthly_cost"] is None


def test_formula_text_is_refused(admin_client):
    t = table(admin_client, "extraescolares")
    t["rows"][0]["name"] = '=HYPERLINK("x")'
    res = put_table(admin_client, "extraescolares", t["rows"], t["version"])
    assert res.status_code == 400


def test_import_source_is_named_in_the_audit(admin_client):
    t = table(admin_client, "seguros")
    t["rows"][0]["cost"] = "520"
    res = put_table(admin_client, "seguros", t["rows"], t["version"], source="import")
    assert res.status_code == 200
    assert (
        AuditLog.objects.filter(object_type="content.fixedconcept").latest("id").context
        == "cms.pricing.import"
    )


# ── export / import ───────────────────────────────────────
def _export(client):
    res = client.get(f"{BASE}export/")
    assert res.status_code == 200
    assert res["Content-Disposition"].startswith('attachment; filename="precios_')
    return b"".join(res.streaming_content) if hasattr(res, "streaming_content") else res.content


def _upload(client, data, name="precios.xlsx"):
    f = io.BytesIO(data)
    f.name = name
    return client.post(f"{BASE}import/", {"file": f}, format="multipart")


def test_export_has_one_sheet_per_table_and_is_audited(admin_client):
    wb = load_workbook(io.BytesIO(_export(admin_client)))
    assert wb.sheetnames == [
        "Instrucciones",
        "Inscripción",
        "Colegiaturas",
        "Seguros",
        "Extraescolares",
        "Estancia",
        "Políticas",
    ]
    ws = wb["Inscripción"]
    assert [c.value for c in ws[1]] == [
        "Modalidad",
        "Nivel",
        "Gastos administrativos",
        "Inscripción o reinscripción",
        "Visible",
        "ID",
    ]
    first = [c.value for c in ws[2]]
    assert (
        first[0] == "Nuevo ingreso"
        and first[1] == "Preescolar"
        and Decimal(str(first[3])) == Decimal("7000")
    )
    assert ws["C2"].number_format == '"$"#,##0.00'
    assert AuditLog.objects.filter(action="export", object_type="export:content.pricing").exists()


def test_import_round_trip_reads_changes_without_writing(admin_client):
    wb = load_workbook(io.BytesIO(_export(admin_client)))
    ws = wb["Colegiaturas"]
    ws["B4"] = 6990.5  # Primaria
    ws.append(["Bachillerato", "7500", "No", None])  # a new hidden row
    del wb["Seguros"]  # missing sheet = table untouched
    buf = io.BytesIO()
    wb.save(buf)
    before = AuditLog.objects.filter(action="update").count()
    res = _upload(admin_client, buf.getvalue())
    assert res.status_code == 200, res.json()
    body = res.json()
    assert "seguros" not in body["tables"]
    assert body["ignored_sheets"] == ["Instrucciones"]
    col = body["tables"]["colegiaturas"]
    assert col["errors"] == []
    assert col["rows"][2]["colegiatura"] == "6990.50" and col["rows"][2]["id"]
    assert col["rows"][-1] == {
        "id": None,
        "is_active": False,
        "section": "Bachillerato",
        "colegiatura": "7500.00",
    }
    # Nothing written.
    assert TuitionCost.objects.get(section="Primaria").colegiatura == Decimal("6650.00")
    assert AuditLog.objects.filter(action="update").count() == before


def test_import_reports_bad_cells_with_their_line(admin_client):
    wb = load_workbook(io.BytesIO(_export(admin_client)))
    ws = wb["Inscripción"]
    ws["D3"] = "ocho mil"
    ws["F4"] = 424242
    ws["A5"] = "Reinscripción"  # label without «(alumnos Interlaken)»
    buf = io.BytesIO()
    wb.save(buf)
    body = _upload(admin_client, buf.getvalue()).json()
    errs = body["tables"]["inscripcion"]["errors"]
    assert {(e["line"], e["field"]) for e in errs} == {(3, "cuota"), (4, "id")}
    assert body["tables"]["inscripcion"]["rows"][3]["modality"] == "reinscripcion"


def test_import_needs_the_columns_and_an_xlsx(admin_client):
    wb = Workbook()
    wb.active.title = "Colegiaturas"
    wb.active.append(["Sección", "Otra cosa"])
    buf = io.BytesIO()
    wb.save(buf)
    body = _upload(admin_client, buf.getvalue()).json()
    assert (
        body["tables"]["colegiaturas"]["errors"][0]["message"]
        == "Faltan columnas: Colegiatura mensual."
    )

    wb = Workbook()
    wb.active.title = "Hoja1"
    buf = io.BytesIO()
    wb.save(buf)
    res = _upload(admin_client, buf.getvalue())
    assert res.status_code == 400 and "ninguna hoja de precios" in res.json()["detail"]

    res = _upload(admin_client, b"seccion,colegiatura\nPrimaria,1\n", name="precios.csv")
    assert res.status_code == 400 and ".xlsx" in res.json()["detail"]


def test_public_bundle_still_cached_between_edits(api_client):
    api_client.get(PUBLIC)
    assert cache.get(PRICING_CACHE_KEY) is not None
