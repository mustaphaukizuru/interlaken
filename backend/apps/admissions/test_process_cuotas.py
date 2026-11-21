"""Expediente (Fase 5): the «Cuotas por nivel» PDF, built live from the price tables."""

from decimal import Decimal

import pytest
from django.urls import reverse

from apps.admissions import cuotas_pdf, process
from apps.admissions.process_fixtures import staff_client
from apps.content.models import EnrollmentFee, FixedConcept, SiteSettings, TuitionCost

pytestmark = pytest.mark.django_db


def _prices():
    """Synthetic price rows (the seeded ones are replaced so the test owns every figure)."""
    EnrollmentFee.objects.all().delete()
    TuitionCost.objects.all().delete()
    FixedConcept.objects.all().delete()
    for section, modality, gastos, cuota in (
        ("Preescolar", "nuevo_ingreso", "1000.00", "5000.00"),
        ("Preescolar", "reinscripcion", "800.00", "4000.00"),
        ("Primaria", "nuevo_ingreso", "1100.00", "6100.00"),
        ("Primaria", "reinscripcion", "900.00", "5100.00"),
        ("Secundaria", "nuevo_ingreso", "1200.00", "7200.00"),
    ):
        EnrollmentFee.objects.create(
            section=section,
            modality=modality,
            gastos_administrativos=Decimal(gastos),
            cuota=Decimal(cuota),
        )
    TuitionCost.objects.create(
        section="Sección Maternal", inscripcion=None, colegiatura=Decimal("3111.00")
    )
    TuitionCost.objects.create(
        section="1° a 3° de Preescolar", inscripcion=Decimal("1"), colegiatura=Decimal("4222.00")
    )
    TuitionCost.objects.create(
        section="Primaria", inscripcion=Decimal("1"), colegiatura=Decimal("5333.00")
    )
    TuitionCost.objects.create(
        section="Secundaria", inscripcion=Decimal("1"), colegiatura=Decimal("6444.00")
    )
    TuitionCost.objects.create(
        section="Primaria antigua", colegiatura=Decimal("9999.00"), is_active=False
    )
    FixedConcept.objects.create(name="Seguro uno", cost=Decimal("100.00"))
    FixedConcept.objects.create(name="Seguro dos", cost=Decimal("250.00"))
    FixedConcept.objects.create(name="Opcional", cost=Decimal("999.00"), mandatory=False)


def test_level_figures_come_from_the_tables():
    _prices()
    f = cuotas_pdf.level_figures("preescolar")
    assert f["new_total"] == Decimal("6000.00") and f["again_total"] == Decimal("4800.00")
    assert [t.section for t in f["tuitions"]] == ["Sección Maternal", "1° a 3° de Preescolar"]
    assert f["insurance_total"] == Decimal("350.00")
    prim = cuotas_pdf.level_figures("primaria")
    assert [t.colegiatura for t in prim["tuitions"]] == [
        Decimal("5333.00")
    ]  # the inactive row is out
    assert cuotas_pdf.level_figures("secundaria")["again"] is None


def test_documents_show_the_figures_and_contact():
    _prices()
    SiteSettings.objects.update_or_create(
        pk=1, defaults={"phone_display": "(55) 0000-1111", "whatsapp_number": "5215500001111"}
    )
    lines = "\n".join(cuotas_pdf.level_document("preescolar").text_lines())
    for text in (
        "Cuotas Preescolar",
        "Inscripción nuevo ingreso",
        "$6,000.00",
        "$3,111.00",
        "$4,222.00",
        "Bono «Sigue con nosotros»",
        "$4,800.00",
        "Seguros y credenciales",
        "$350.00",
        "Teléfono: (55) 0000-1111",
        "WhatsApp: 55 0000 1111",
        "Inscripción Maternal  Sección Maternal  Sin costo",
    ):
        assert text in lines, text
    # The level's documents come from the Fase 4 list (required_docs).
    from apps.admissions.required_docs import documents_for_level

    names = [d.name for d in documents_for_level("preescolar")]
    assert names and f"Documentos para la inscripción: {'; '.join(names)}." in lines
    sec = "\n".join(cuotas_pdf.level_document("secundaria").text_lines())
    assert "Bono «Sigue con nosotros»" not in sec and "$8,400.00" in sec


def test_pdf_is_valid_with_one_page_per_level():
    _prices()
    pdf = cuotas_pdf.render_cuotas_pdf()
    assert pdf.startswith(b"%PDF-1.4") and pdf.rstrip().endswith(b"%%EOF")
    assert pdf.count(b"/Type /Page ") == 3 and b"/Count 3" in pdf
    for amount in (b"$6,000.00", b"$7,200.00", b"$8,400.00", b"$5,333.00", b"$6,444.00"):
        assert amount in pdf
    one = cuotas_pdf.render_cuotas_pdf(["primaria"])
    assert b"/Count 1" in one and b"$7,200.00" in one and b"$6,444.00" not in one


def test_documents_block_follows_the_list_and_disappears_without_it(monkeypatch):
    from apps.admissions.document_models import RequiredDocument
    from apps.admissions.required_docs import documents_for_level

    sec = documents_for_level("secundaria")
    first = sec[0]
    RequiredDocument.objects.filter(pk=first.pk).update(active=False)
    lines = cuotas_pdf.level_document("secundaria").text_lines()
    block = next(line for line in lines if line.startswith("Documentos para la inscripción"))
    assert first.name not in block.split(": ", 1)[1].split("; ") and sec[1].name in block
    monkeypatch.setattr(process, "DOCUMENT_HOOK_MODULES", ())
    monkeypatch.setattr(process, "_discovered", {})
    monkeypatch.setattr(process, "_document_hooks", {})
    lines = cuotas_pdf.level_document("secundaria").text_lines()
    assert not any(line.startswith("Documentos para la inscripción") for line in lines)


def test_required_documents_block_with_the_hook():
    saved = dict(process._document_hooks)
    try:
        process.register_documents_hooks(
            required_for_level=lambda level: [{"label": "Acta de nacimiento"}, "CURP"]
        )
        lines = cuotas_pdf.level_document("primaria").text_lines()
        assert "Documentos para la inscripción: Acta de nacimiento; CURP." in lines
    finally:
        process._document_hooks.clear()
        process._document_hooks.update(saved)


def test_public_endpoint_and_staff_preview(admin_client):
    from rest_framework.test import APIClient

    api_client = APIClient()  # anonymous (the api_client fixture IS admin_client here)
    _prices()
    r = api_client.get(reverse("cuotas-pdf", args=["primaria"]))
    assert r.status_code == 200 and r["Content-Type"] == "application/pdf"
    assert (
        r.content.startswith(b"%PDF")
        and 'filename="cuotas-primaria.pdf"' in r["Content-Disposition"]
    )
    assert r["Cache-Control"].startswith("public")
    assert api_client.get(reverse("cuotas-pdf", args=["todos"])).content.count(b"/Type /Page ") == 3
    assert api_client.get(reverse("cuotas-pdf", args=["bachillerato"])).status_code == 404
    assert api_client.get(reverse("cuotas-pdf-preview", args=["primaria"])).status_code == 401
    assert (
        staff_client("cafeteria").get(reverse("cuotas-pdf-preview", args=["primaria"])).status_code
        == 403
    )
    preview = admin_client.get(reverse("cuotas-pdf-preview", args=["secundaria"]))
    assert preview.status_code == 200 and preview["Cache-Control"] == "no-store"


def test_works_with_the_seeded_school_prices():
    """The real seed (migrations 0006/0008/0029) renders every level."""
    pdf = cuotas_pdf.render_cuotas_pdf()
    assert pdf.count(b"/Type /Page ") == 3
    assert cuotas_pdf.level_figures("primaria")["new"] is not None
