"""
admissions/cuotas_pdf.py — «Cuotas por nivel», built live from the price tables.

One Letter page per level (Preescolar includes Maternal, Primaria,
Secundaria), with the same hand-rolled engine as receipts
(``apps.core.pdf_document``; no PDF library may be added):

* Inscripción nuevo ingreso = cuota + gastos administrativos (``EnrollmentFee``),
* colegiatura mensual of every ``TuitionCost`` row of the level,
* Bono «Sigue con nosotros» = reinscripción + gastos administrativos,
* seguros y credenciales, total of the mandatory ``FixedConcept`` rows,
* the documents the level asks for (the Fase 4 list, ``required_docs``, through
  ``process.required_documents``; the block is left out without it),
* the school's contact (``SiteSettings``).

No personal data: the public link (``GET cuotas/<level>.pdf``) and the email
attachment of «Enviar cuotas» are the same file.
"""

from __future__ import annotations

from decimal import Decimal

from django.core.cache import cache

from apps.core.pdf_document import (
    BOLD,
    MUTED,
    REGULAR,
    Column,
    Document,
    Row,
    Table,
    _assemble,
    _Layout,
    wrap,
)

from .validators import fold_text

# level → (label, TuitionCost section keywords, EnrollmentFee section keyword)
LEVELS: dict[str, tuple[str, tuple[str, ...], str]] = {
    "preescolar": ("Preescolar", ("maternal", "preescolar"), "preescolar"),
    "primaria": ("Primaria", ("primaria",), "primaria"),
    "secundaria": ("Secundaria", ("secundaria",), "secundaria"),
}
ALL = "todos"
CACHE_KEY = "admissions.cuotas-pdf.v2:{}"  # v2: the school cycle on every page
CACHE_TTL = 120  # seconds: a price edit shows within two minutes


def _money(value) -> str:
    from apps.portal.emailing import money

    return money(value)


def _matches(section: str, keywords) -> bool:
    folded = fold_text(section)
    return any(k in folded for k in keywords)


def level_figures(level: str) -> dict:
    """The numbers of one level page, straight from the active price rows."""
    from apps.content.models import EnrollmentFee, FixedConcept, TuitionCost

    label, tuition_keys, fee_key = LEVELS[level]
    fees = {
        f.modality: f
        for f in EnrollmentFee.objects.filter(is_active=True).order_by("order", "id")
        if _matches(f.section, (fee_key,))
    }
    new = fees.get(EnrollmentFee.Modality.NUEVO_INGRESO)
    again = fees.get(EnrollmentFee.Modality.REINSCRIPCION)
    tuitions = [
        t
        for t in TuitionCost.objects.filter(is_active=True).order_by("order", "id")
        if _matches(t.section, tuition_keys)
    ]
    insurance = [
        c
        for c in FixedConcept.objects.filter(is_active=True, mandatory=True).order_by("order", "id")
    ]
    return {
        "level": level,
        "label": label,
        "new": new,
        "new_total": (new.cuota + new.gastos_administrativos) if new else None,
        "again": again,
        "again_total": (again.cuota + again.gastos_administrativos) if again else None,
        "tuitions": tuitions,
        "insurance": insurance,
        "insurance_total": sum((c.cost for c in insurance), Decimal("0")) if insurance else None,
    }


def price_cycle() -> tuple[int, dict]:
    """``(cycle start year, {price group: year})``: the cycle these prices are
    for, the same rule as the Costos page (``content.site_years``): the year
    the school published them for, or the announced cycle when that is newer.
    ``years`` only holds the groups the school stamped with a year."""
    from django.utils import timezone

    from apps.content.site_years import price_cycle_start, year_settings

    from_month, raw = year_settings()
    years = {
        k: v for k, v in (raw or {}).items() if isinstance(v, int) and not isinstance(v, bool)
    }
    return price_cycle_start(years, timezone.localdate(), from_month), years


def _contact() -> list[tuple[str, str]]:
    from django.conf import settings

    from apps.content.models import SiteSettings

    s = SiteSettings.load()
    wa = "".join(ch for ch in (s.whatsapp_number or "") if ch.isdigit())
    wa_text = ""
    if len(wa) >= 10:
        last = wa[-10:]
        wa_text = f"{last[:2]} {last[2:6]} {last[6:]}"
    rows = [
        ("Teléfono", s.phone_display),
        ("WhatsApp", wa_text),
        ("Correo", s.contact_email or getattr(settings, "ADMISSIONS_EMAIL", "")),
        ("Horario", s.office_hours),
        ("Dirección", s.address),
    ]
    return [(k, v) for k, v in rows if v]


def level_document(level: str) -> Document:
    from apps.content.site_years import cycle_label

    from .process import required_documents

    f = level_figures(level)
    # QA 2026-11-24: the PDF never said which school cycle it was for. A price
    # group still stamped with an older year is marked as such.
    cycle, years = price_cycle()
    stale_years: set[int] = set()

    def older(group: str) -> str:
        year = years.get(group)
        if year is None or year >= cycle:
            return ""
        stale_years.add(year)
        return f" · precio del ciclo {cycle_label(year)}"

    rows: list[Row] = []
    summary: list[tuple[str, str]] = []
    new = f["new"]
    if new:
        rows.append(
            Row(
                [
                    "Inscripción nuevo ingreso",
                    f"Cuota {_money(new.cuota)} + gastos administrativos "
                    f"{_money(new.gastos_administrativos)}{older('fees')}",
                    _money(f["new_total"]),
                ]
            )
        )
        summary.append(("Inscripción nuevo ingreso", _money(f["new_total"])))
    for t in f["tuitions"]:
        if t.inscripcion is None and level == "preescolar" and _matches(t.section, ("maternal",)):
            rows.append(Row(["Inscripción Maternal", t.section, "Sin costo"]))
    for t in f["tuitions"]:
        rows.append(
            Row(
                [
                    "Colegiatura mensual",
                    f"{t.section} · 11 mensualidades, agosto a junio{older('tuition')}",
                    _money(t.colegiatura),
                ]
            )
        )
    if f["tuitions"]:
        amounts = sorted({t.colegiatura for t in f["tuitions"]})
        value = _money(amounts[0]) if len(amounts) == 1 else f"desde {_money(amounts[0])}"
        summary.append(("Colegiatura mensual", value))
    again = f["again"]
    if again:
        rows.append(
            Row(
                [
                    "Bono «Sigue con nosotros»",
                    f"Reinscripción {_money(again.cuota)} + gastos administrativos "
                    f"{_money(again.gastos_administrativos)}{older('fees')}",
                    _money(f["again_total"]),
                ]
            )
        )
    if f["insurance"]:
        names = ", ".join(c.name for c in f["insurance"])
        rows.append(
            Row(["Seguros y credenciales", f"Pago anual: {names}{older('insurance')}",
                 _money(f["insurance_total"])])
        )
    notes = []
    if stale_years:
        previous = ", ".join(cycle_label(y) for y in sorted(stale_years))
        notes.append(
            f"Los importes marcados son del ciclo {previous}: el colegio aún no publica los del "
            f"ciclo {cycle_label(cycle)}."
        )
    documents = required_documents(level)
    if documents:
        notes.append("Documentos para la inscripción: " + "; ".join(documents) + ".")
    return Document(
        title=f"Cuotas {f['label']}",
        reference="Admisiones",
        subtitle=" · ".join(
            x for x in (f"Ciclo escolar {cycle_label(cycle)}",
                        "Incluye Maternal" if level == "preescolar" else "") if x
        ),
        summary=summary,
        info=_contact(),
        table=Table(
            columns=[
                Column("Concepto", width=140),
                Column("Detalle"),
                Column("Importe", width=100, align="right", strong=True),
            ],
            rows=rows,
            empty_text="El colegio aún no publica las cuotas de este nivel.",
        ),
        notes=notes,
        footer="Colegio Interlaken · Admisiones",
    )


class _CuotasLayout(_Layout):
    """The receipt layout with the contact as one «Etiqueta  valor» line per row."""

    def info(self):
        rows = self.doc.info
        if not rows:
            return
        self.ensure(26 + 34)
        self.heading("Contacto")
        for label, value in rows:
            lines = wrap(value, REGULAR, 10, self.width - 110)
            h = 6 + 13 * len(lines) + 4
            self.ensure(h)
            self.c.text(
                self.left, self.y - 12, label.upper(), font=BOLD, size=7.2, rgb=MUTED, spacing=0.5
            )
            for k, line in enumerate(lines):
                self.c.text(self.left + 110, self.y - 12 - 13 * k, line, font=REGULAR, size=10)
            self.y -= h
        self.y -= 10


def _render(levels: list[str]) -> bytes:
    from django.utils import timezone

    pages = []
    layout = None
    generated = timezone.localtime(timezone.now()).strftime("%d/%m/%Y %H:%M")
    for level in levels:
        layout = _CuotasLayout(level_document(level))
        layout.summary()
        layout.table("Cuotas")
        layout.notes()
        layout.info()
        layout.footers(generated)
        pages.extend(layout.pages)
    return _assemble(
        pages, layout.pw, layout.ph, layout.logo, "Cuotas por nivel · Colegio Interlaken"
    )


def render_cuotas_pdf(levels: list[str] | None = None, *, use_cache: bool = False) -> bytes:
    """PDF bytes for ``levels`` (default: the three levels, one page each)."""
    levels = [lv for lv in (levels or list(LEVELS)) if lv in LEVELS] or list(LEVELS)
    if not use_cache:
        return _render(levels)
    key = CACHE_KEY.format("-".join(levels))
    data = cache.get(key)
    if data is None:
        data = _render(levels)
        cache.set(key, data, CACHE_TTL)
    return data


def levels_for(param: str) -> list[str] | None:
    """URL value → levels; ``None`` for an unknown level (404)."""
    if param == ALL:
        return list(LEVELS)
    return [param] if param in LEVELS else None
