"""
payments/multicobros_report.py: «Subir reporte de MultiCobros».

Staff export the day's transactions from MultiCobros once (Analítica →
Reportes → Transacciones Payworks 2 → exportar; the file is named like
``MovimientosPayworks_export_<n>.xlsx``) and upload it in the cafetería
console. Every row of the file gets ONE outcome, and every outcome that is not
``verificar`` is left for a person:

- ``verificar``: a real (PRD) approved sale of ours, credited and not verified
  yet, whose amount, referencia and (when we stored it) authorization code all
  equal the file's. The commit verifies it through
  ``multicobros.verify_approval``, the exact rule of the per-payment dialog,
  each in its own locked transaction, then applies it like the dialog does.
- ``ya_verificada``: already verified (uploading the same file twice is a no-op).
- ``diferencia``: the same operation with another amount, referencia,
  authorization code, PAGO id or state. Never verified.
- ``por_conciliar``: MultiCobros shows an approved sale our payment did not
  receive (expired, superseded, bank timeout). Never settled here: staff
  confirm each one in «Conciliar con MultiCobros», pre-filled with the file.
- ``no_aprobada_en_multicobros``: we hold it approved, MultiCobros does not.
- ``devolucion``: a refund or cancellation (or another non-sale row) of one of
  our payments. That payment is never verified from this file.
- ``rechazada``: declined in MultiCobros and not approved here either.
- ``sin_pago``: no payment of ours (another channel, or an old operation).
- ``simulacion``: a Payworks simulation (not PRD): ignored.
- ``no_aparece`` (not a file row): our approved PRD payments still to verify
  whose date is inside the file's dates but that the file does not list.

Privacy (the repository is public and the file holds card data): the upload is
read in memory only (``MemoryOnlyUploadHandler``, never a temporary file),
never stored, never logged. Only the columns below are read; of the card
number only the last 4 digits are kept, and CAVV, XID or Token 20 are never
touched. Stateless: the commit re-uploads the same file.
"""

from __future__ import annotations

import csv
import io
import logging
import re
import time
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from decimal import Decimal

from django.conf import settings
from django.core.files.uploadhandler import MemoryFileUploadHandler
from django.utils import timezone

from apps.core.exceptions import PayloadTooLarge, cap_message
from apps.core.importing import normalize_header, parse_date_es

from .models import BanorteCheckout, Payment
from .multicobros import (
    VerifyError,
    apply_verified,
    can_reconcile,
    parse_amount,
    review_reason,
    same_auth_code,
    verify_approval,
)

logger = logging.getLogger(__name__)

MAX_BYTES = 2 * 1024 * 1024
MAX_ROWS = 5_000
# The multipart envelope around a file at the cap (boundaries, headers, the
# dry_run field): a body above this is refused before it is read.
MAX_BODY_BYTES = MAX_BYTES + 64 * 1024
# Seconds the commit keeps starting «apply right away» calls. Each one reads
# Loyverse once on the short budget (at most 14 s), so the request ends well
# under gunicorn's 60 s; the rest is applied by the 5-minute POS mirror.
APPLY_BUDGET_SECONDS = 20
QUERY_CHUNK = 500

VIA = "multicobros-upload"
# ``apply_state`` of a verified top-up that reaches the wallet once it is in
# the POS (``pending_sync``: the apply budget ran out, the mirror applies it).
WAITING_STATES = frozenset({"waiting_pos", "waiting_verification", "pos_unknown", "pending_sync"})
AUDIT_CONTEXT = "payments.banorte.multicobros_upload"

OUTCOMES = (
    "verificar",
    "ya_verificada",
    "diferencia",
    "por_conciliar",
    "no_aprobada_en_multicobros",
    "devolucion",
    "rechazada",
    "sin_pago",
    "simulacion",
    "no_aparece",
)

# Column key → the header MultiCobros prints (matched normalized: accents,
# NBSP, case and extra spaces ignored).
REQUIRED_COLUMNS = {
    "control": "Número de Control",
    "monto": "Monto",
    "referencia": "Referencia",
    "resultado": "Resultado Payworks",
    "modo": "Modo de Transacción",
    "tipo": "Tipo de Transacción",
    "fecha": "Fecha de Transacción",
    "codigo_aut": "Código de Autorización",
}
OPTIONAL_COLUMNS = {
    "afiliacion": "Afiliación",
    "hora": "Hora de Transacción",
    "ref1": "Referencia 1",
    "estado": "Estado",
    "tarjeta": "Número de Tarjeta",
    # How a refund row points at its sale (matched only for non-sale rows).
    "ref_original": "Referencia Original",
    "ref_previa": "Referencia Previa",
}
_HEADER_KEYS = {
    normalize_header(label): key for key, label in {**REQUIRED_COLUMNS, **OPTIONAL_COLUMNS}.items()
}

_PAGO_RE = re.compile(r"^PAGO(\d{1,12})$")
_APPROVED_WORDS = frozenset({"A", "APROBADA", "APROBADO"})
_RESULT_LABELS = dict(BanorteCheckout.Result.choices)


class ReportError(ValueError):
    """A file the upload refuses as a whole (HTTP 400, nothing verified)."""

    def __init__(self, message: str, *, code: str = "invalid_report", **extra):
        super().__init__(message)
        self.code = code
        self.extra = extra


class MemoryOnlyUploadHandler(MemoryFileUploadHandler):
    """Keep the upload in memory whatever ``FILE_UPLOAD_MAX_MEMORY_SIZE`` says:
    never a temporary file on disk. The view bounds the body first
    (``MAX_BODY_BYTES``), so memory stays bounded too."""

    def handle_raw_input(self, *args, **kwargs):
        super().handle_raw_input(*args, **kwargs)
        self.activated = True


# ── parsing ──────────────────────────────────────────────────


@dataclass
class FileRow:
    line: int
    control: str = ""
    amount: Decimal | None = None
    referencia: str = ""
    codigo_aut: str = ""
    resultado: str = ""  # Payworks letter as shown ("A", "D"...)
    approved: bool = False
    modo: str = ""
    tipo: str = ""
    is_sale: bool = False
    fecha: date | None = None
    hora: str = ""
    afiliacion: str = ""
    ref1: str = ""
    pago_id: int | None = None
    estado: str = ""
    last4: str = ""
    ref_original: str = ""
    ref_previa: str = ""


def _text(value) -> str:
    """A cell as text: a lone space (MultiCobros' empty), NBSP and padding stripped."""
    if value is None:
        return ""
    if isinstance(value, bool):
        return ""
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        return str(int(value)) if value.is_integer() else repr(value)
    if isinstance(value, datetime):
        return value.isoformat(sep=" ")
    if isinstance(value, date):
        return value.isoformat()
    return str(value).replace("\xa0", " ").strip()


def _digits(value) -> str:
    return re.sub(r"\D", "", _text(value))


def _amount(value, *, decimal_comma: bool = False) -> Decimal | None:
    if isinstance(value, int) and not isinstance(value, bool):
        return Decimal(value)
    if isinstance(value, float):
        return parse_amount(repr(value))
    text = _text(value)
    if decimal_comma and re.fullmatch(r"\$?\s*\d+,\d{1,2}", text):
        text = text.replace(",", ".")
    return parse_amount(text) if text else None


def _fecha(value) -> date | None:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    text = _text(value)
    if not text:
        return None
    try:
        return parse_date_es(text.split(" ")[0])
    except ValueError:
        return None


def _hora(value) -> str:
    if isinstance(value, datetime):
        return value.strftime("%H:%M")
    if hasattr(value, "strftime"):  # datetime.time
        return value.strftime("%H:%M")
    match = re.match(r"^(\d{1,2}):(\d{2})", _text(value))
    return f"{int(match.group(1)):02d}:{match.group(2)}" if match else ""


def _to_row(line: int, cells: dict, *, decimal_comma: bool) -> FileRow:
    """Only the columns this module uses; the card number shrinks to its last 4."""
    resultado = _text(cells.get("resultado")).upper()
    tipo = _text(cells.get("tipo"))
    ref1 = _text(cells.get("ref1")).upper().replace(" ", "")
    pago = _PAGO_RE.match(ref1)
    card = _digits(cells.get("tarjeta"))
    return FileRow(
        line=line,
        control=_text(cells.get("control")).upper(),
        amount=_amount(cells.get("monto"), decimal_comma=decimal_comma),
        referencia=_text(cells.get("referencia")),
        codigo_aut=_text(cells.get("codigo_aut")).upper(),
        resultado=resultado[:1] if resultado else "",
        approved=resultado in _APPROVED_WORDS,
        modo=_text(cells.get("modo")).upper(),
        tipo=tipo,
        is_sale=normalize_header(tipo) == "venta",
        fecha=_fecha(cells.get("fecha")),
        hora=_hora(cells.get("hora")),
        afiliacion=_text(cells.get("afiliacion")),
        ref1=ref1,
        pago_id=int(pago.group(1)) if pago else None,
        estado=_text(cells.get("estado")).upper(),
        last4=card[-4:] if len(card) >= 4 else "",
        ref_original=_text(cells.get("ref_original")),
        ref_previa=_text(cells.get("ref_previa")),
    )


def _columns(headers) -> dict[int, str]:
    """``{position: column key}``; a 400 naming what is missing."""
    found: dict[int, str] = {}
    for i, header in enumerate(headers):
        key = _HEADER_KEYS.get(normalize_header(_text(header)))
        if key and key not in found.values():
            found[i] = key
    missing = [label for key, label in REQUIRED_COLUMNS.items() if key not in found.values()]
    if missing:
        raise ReportError(
            "Este archivo no parece el reporte «Transacciones Payworks 2» de MultiCobros: "
            f"faltan las columnas {', '.join(missing)}.",
            code="missing_columns",
            missing=missing,
        )
    return found


def _filled(values) -> bool:
    return bool(values) and any(_text(v) for v in values)


def _bounded(lines):
    """``(line, values)`` of the non-empty rows, refusing more than ``MAX_ROWS``
    data rows (the header is the first one) before reading further."""
    kept = []
    for line, values in lines:
        if not _filled(values):
            continue
        if len(kept) > MAX_ROWS:
            raise PayloadTooLarge(
                detail=cap_message(MAX_ROWS, verb="Exporte menos días en MultiCobros")
            )
        kept.append((line, values))
    return kept


def _rows_from(table, *, decimal_comma: bool = False) -> list[FileRow]:
    """``table``: ``(line, values)`` of the non-empty rows, the header first."""
    if not table:
        raise ReportError("El archivo está vacío o no tiene encabezados.", code="empty_report")
    columns = _columns(table[0][1])
    rows = []
    for line, values in table[1:]:
        cells = {key: values[i] for i, key in columns.items() if i < len(values)}
        rows.append(_to_row(line, cells, decimal_comma=decimal_comma))
    if not rows:
        raise ReportError("El reporte no tiene operaciones.", code="empty_report")
    return rows


def _xlsx_table(data: bytes):
    from openpyxl import load_workbook

    try:
        wb = load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    except Exception:
        raise ReportError(
            "No se pudo leer el archivo .xlsx. Expórtelo de nuevo en MultiCobros.",
            code="unreadable",
        ) from None
    try:
        ws = wb["data"] if "data" in wb.sheetnames else wb.worksheets[0]
        return _bounded(enumerate(ws.iter_rows(values_only=True), start=1))
    except (PayloadTooLarge, ReportError):
        raise
    except Exception:
        raise ReportError(
            "No se pudo leer el archivo .xlsx. Expórtelo de nuevo en MultiCobros.",
            code="unreadable",
        ) from None
    finally:
        wb.close()


def _csv_table(data: bytes):
    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = data.decode("latin-1")
    text = text.lstrip("﻿")
    first = text.splitlines()[0] if text.strip() else ""
    delimiter = ";" if first.count(";") > first.count(",") else ","
    reader = csv.reader(io.StringIO(text), delimiter=delimiter)
    try:
        # ``line_num`` is the physical line, as a spreadsheet numbers it.
        table = _bounded((reader.line_num, values) for values in reader)
    except csv.Error:
        raise ReportError("No se pudo leer el archivo .csv.", code="unreadable") from None
    return table, delimiter == ";"


def parse_report(upload) -> list[FileRow]:
    """The uploaded MultiCobros export as ``FileRow`` objects (nothing kept but those).

    ``.xlsx`` (openpyxl read-only, sheet ``data``) or ``.csv`` (UTF-8 with or
    without BOM, else latin-1; comma or semicolon). Refuses ``.xls`` and any
    other format, files over ``MAX_BYTES`` and more than ``MAX_ROWS`` rows,
    and a report of another afiliación (when ``BANORTE_MERCHANT_ID`` is set).
    """
    name = (getattr(upload, "name", "") or "").strip().lower()
    if getattr(upload, "size", 0) > MAX_BYTES:
        raise PayloadTooLarge(detail="El archivo excede el límite de 2 MB.")
    data = upload.read()
    if len(data) > MAX_BYTES:
        raise PayloadTooLarge(detail="El archivo excede el límite de 2 MB.")
    if name.endswith(".xls") or data[:4] == b"\xd0\xcf\x11\xe0":
        raise ReportError(
            "Los archivos .xls (Excel 97-2003) no se pueden leer. En MultiCobros exporte el "
            "reporte en .xlsx o .csv.",
            code="unsupported_format",
        )
    if name.endswith(".xlsx"):
        if data[:4] != b"PK\x03\x04":
            raise ReportError(
                "El archivo no es un .xlsx válido. Expórtelo de nuevo en MultiCobros.",
                code="unreadable",
            )
        rows = _rows_from(_xlsx_table(data))
    elif name.endswith(".csv"):
        table, decimal_comma = _csv_table(data)
        rows = _rows_from(table, decimal_comma=decimal_comma)
    else:
        raise ReportError(
            "Suba el reporte exportado de MultiCobros en formato .xlsx o .csv.",
            code="unsupported_format",
        )
    _check_afiliacion(rows)
    return rows


def _check_afiliacion(rows: list[FileRow]) -> None:
    ours = (getattr(settings, "BANORTE_MERCHANT_ID", "") or "").strip().lstrip("0")
    if not ours:
        return
    for row in rows:
        theirs = row.afiliacion.lstrip("0")
        if theirs and theirs != ours:
            raise ReportError(
                "Este reporte es de otra afiliación. Exporte el de la afiliación del colegio "
                "en MultiCobros.",
                code="other_merchant",
            )


# ── matching ─────────────────────────────────────────────────


@dataclass
class Outcome:
    outcome: str
    message: str
    line: int | None = None
    control: str = ""
    pago_id: int | None = None
    student_name: str = ""
    student_code: str = ""
    amount: Decimal | None = None
    fecha: date | None = None
    hora: str = ""
    last4: str = ""
    tipo: str = ""
    resultado: str = ""
    apply_state: str = ""
    # What the commit sends to ``verify_approval`` / the reconcile dialog.
    payment: Payment | None = None
    referencia: str = ""
    codigo_aut: str = ""
    prefill: dict | None = None
    reconcile: dict | None = None

    def as_dict(self) -> dict:
        return {
            "line": self.line,
            "control_number": self.control,
            "pago_id": self.pago_id,
            "student_name": self.student_name,
            "student_code": self.student_code,
            "amount": None if self.amount is None else f"{self.amount:.2f}",
            "date": self.fecha.isoformat() if self.fecha else None,
            "time": self.hora,
            "outcome": self.outcome,
            "message": self.message,
            "card_last4": self.last4,
            "tipo": self.tipo,
            "resultado": self.resultado,
            "apply_state": self.apply_state,
            "prefill": self.prefill,
            "reconcile": self.reconcile,
        }


@dataclass
class Report:
    outcomes: list[Outcome] = field(default_factory=list)
    date_from: date | None = None
    date_to: date | None = None
    dry_run: bool = True
    verified: int = 0
    applied: int = 0
    waiting: int = 0

    @property
    def counts(self) -> dict[str, int]:
        out = dict.fromkeys(OUTCOMES, 0)
        for o in self.outcomes:
            out[o.outcome] += 1
        return out

    def as_dict(self) -> dict:
        body = {
            "dry_run": self.dry_run,
            "total_rows": sum(1 for o in self.outcomes if o.line is not None),
            "date_from": self.date_from.isoformat() if self.date_from else None,
            "date_to": self.date_to.isoformat() if self.date_to else None,
            "counts": self.counts,
            "rows": [o.as_dict() for o in self.outcomes],
        }
        if not self.dry_run:
            body.update(verified=self.verified, applied=self.applied, waiting=self.waiting)
        return body


def _mxn(value) -> str:
    return "-" if value is None else f"${value:,.2f}"


def _in_chunks(values):
    values = list(values)
    for i in range(0, len(values), QUERY_CHUNK):
        yield values[i : i + QUERY_CHUNK]


def _checkouts(**lookup):
    """Checkouts matching ``field__in=values`` (chunked), with what a row shows."""
    ((name, values),) = lookup.items()
    found = []
    for chunk in _in_chunks(v for v in set(values) if v not in ("", None)):
        found.extend(
            BanorteCheckout.objects.filter(**{name: chunk}).select_related(
                "payment__related_topup__student__user", "verified_by"
            )
        )
    return found


def _who(outcome: Outcome, checkout: BanorteCheckout) -> Outcome:
    """Student and folio from OUR database (never from the file)."""
    payment = checkout.payment
    outcome.payment = payment
    outcome.pago_id = payment.pk
    outcome.control = checkout.control_number
    topup = payment.related_topup
    student = topup.student if topup is not None else None
    if student is not None:
        outcome.student_name = student.user.full_name
        outcome.student_code = student.student_id or ""
    return outcome


def _base(row: FileRow) -> Outcome:
    return Outcome(
        outcome="",
        message="",
        line=row.line,
        control=row.control,
        pago_id=row.pago_id,
        amount=row.amount,
        fecha=row.fecha,
        hora=row.hora,
        last4=row.last4,
        tipo=row.tipo,
        resultado=row.resultado,
        referencia=row.referencia,
        codigo_aut=row.codigo_aut,
    )


def _differences(row: FileRow, checkout: BanorteCheckout) -> list[str]:
    """What the file and our operation disagree on, one plain sentence each
    (empty: the same charge). "Plataforma" is this app."""
    payment = checkout.payment
    found = []
    if row.amount is None or row.amount != payment.amount:
        found.append(
            f"El monto no coincide: MultiCobros {_mxn(row.amount)}, plataforma {_mxn(payment.amount)}."
        )
    if checkout.referencia and row.referencia != checkout.referencia:
        found.append(
            f"La referencia no coincide: MultiCobros {row.referencia or '-'}, "
            f"plataforma {checkout.referencia}."
        )
    if checkout.codigo_aut and not same_auth_code(checkout.codigo_aut, row.codigo_aut):
        found.append(
            f"El número de autorización no coincide: MultiCobros {row.codigo_aut or '-'}, "
            f"plataforma {checkout.codigo_aut}."
        )
    if row.pago_id is not None and row.pago_id != payment.pk:
        found.append(
            f"La Referencia 1 no coincide: MultiCobros PAGO{row.pago_id}, plataforma PAGO{payment.pk}."
        )
    if not checkout.is_live:
        found.append(f"En la plataforma es una simulación ({checkout.mode}), sin cargo real.")
    if row.estado and row.estado != "C":
        found.append(f"MultiCobros la muestra con estado «{row.estado}» (se espera «C»).")
    return found


def _sale_outcome(row: FileRow, checkout: BanorteCheckout, *, approved_elsewhere: bool) -> Outcome:
    out = _who(_base(row), checkout)
    payment = checkout.payment
    if not row.approved:
        label = _RESULT_LABELS.get(row.resultado, row.resultado or "sin resultado")
        if checkout.resultado_payw == BanorteCheckout.Result.APPROVED and not approved_elsewhere:
            out.outcome = "no_aprobada_en_multicobros"
            out.message = (
                f"En la plataforma consta aprobada, pero MultiCobros la muestra {label.lower()} "
                f"({row.resultado or '-'}). No la cargue en el POS y avise a dirección."
            )
        else:
            out.outcome = "rechazada"
            out.message = f"MultiCobros la muestra {label.lower()}: no hubo cargo. Nada que hacer."
        return out
    if payment.status == Payment.Status.REFUNDED:
        out.outcome = "devolucion"
        out.message = "Este pago ya se devolvió en la plataforma: no lo cargue en el POS."
        return out
    diffs = _differences(row, checkout)
    if diffs:
        out.outcome = "diferencia"
        out.message = f"{' '.join(diffs)} No lo cargue en el POS y avise a dirección."
        return out
    if payment.status == Payment.Status.SUCCESS:
        if checkout.verified_at is not None:
            out.outcome = "ya_verificada"
            who = checkout.verified_by.full_name if checkout.verified_by_id else ""
            out.message = f"Ya estaba verificada{f' por {who}' if who else ''}."
        elif checkout.resultado_payw != BanorteCheckout.Result.APPROVED or not checkout.referencia:
            out.outcome = "diferencia"
            out.message = (
                "En la plataforma está acreditada sin la aprobación completa de Banorte. No la cargue en "
                "el POS y avise a dirección."
            )
        else:
            out.outcome = "verificar"
            out.message = "Aprobada en MultiCobros; monto, referencia y autorización coinciden."
        return out
    if can_reconcile(payment):
        reason = review_reason(payment, checkout) or payment.failure_label() or "sin respuesta"
        out.outcome = "por_conciliar"
        out.message = (
            f"MultiCobros la muestra aprobada, pero en la plataforma no se acreditó: {reason}. "
            "Revísela y confírmela con «Conciliar»."
        )
        out.prefill = {
            "referencia": row.referencia,
            "codigo_aut": row.codigo_aut,
            "amount": f"{row.amount:.2f}",
        }
        out.reconcile = {
            "control_number": checkout.control_number,
            "created_at": checkout.created_at,
            "mode": checkout.mode,
            "review_reason": review_reason(payment, checkout) or "",
            "failure_label": payment.failure_label(),
            "last_error": checkout.last_error,
            "amount": f"{payment.amount:.2f}",
        }
        return out
    out.outcome = "diferencia"
    out.message = (
        f"MultiCobros la muestra aprobada, pero en la plataforma el pago está «{payment.get_status_display()}» "
        f"({payment.failure_label() or 'resultado final'}). No lo cargue en el POS y avise a "
        "dirección."
    )
    return out


def _local_day(value) -> date | None:
    return timezone.localdate(value) if value else None


def analyze(rows: list[FileRow]) -> Report:
    """One ``Outcome`` per file row, plus ``no_aparece`` (read-only, no locks)."""
    report = Report()
    by_control = {
        c.control_number: c for c in _checkouts(control_number__in=[r.control for r in rows])
    }

    # Refunds and cancellations may carry their own control number: they also
    # point at the sale's referencia, or keep its Referencia 1.
    loose = [r for r in rows if r.modo == "PRD" and not r.is_sale and r.control not in by_control]
    by_ref = {
        c.referencia: c
        for c in _checkouts(
            referencia__in=[v for r in loose for v in (r.ref_original, r.ref_previa)]
        )
    }
    by_pago = {c.payment_id: c for c in _checkouts(payment_id__in=[r.pago_id for r in loose])}

    def checkout_of(row):
        found = by_control.get(row.control)
        if found is None and not row.is_sale:
            found = by_ref.get(row.ref_original) or by_ref.get(row.ref_previa)
            found = found or by_pago.get(row.pago_id)
        return found

    live = [r for r in rows if r.modo == "PRD"]
    refunded = {checkout_of(r).pk for r in live if not r.is_sale and checkout_of(r) is not None}
    approved_sales: dict[int, set] = {}
    for r in live:
        c = checkout_of(r)
        if r.is_sale and r.approved and c is not None:
            approved_sales.setdefault(c.pk, set()).add((r.referencia, r.amount))

    for row in rows:
        out = _base(row)
        if row.modo != "PRD":
            out.outcome = "simulacion"
            out.message = f"Operación de simulación (modo {row.modo or 'sin modo'}): sin cargo real. Se ignora."
            report.outcomes.append(out)
            continue
        checkout = checkout_of(row)
        if checkout is None:
            out.outcome = "sin_pago"
            out.message = (
                "No corresponde a ningún pago de la app (otro canal de cobro o una operación "
                "que no es de esta plataforma)."
            )
            report.outcomes.append(out)
            continue
        if not row.is_sale:
            out = _who(out, checkout)
            out.outcome = "devolucion"
            out.message = (
                f"MultiCobros muestra «{row.tipo or 'otro movimiento'}» de este pago. No lo cargue "
                "en el POS sin revisarlo en MultiCobros."
            )
        elif checkout.pk in refunded:
            out = _who(out, checkout)
            out.outcome = "devolucion"
            out.message = (
                "MultiCobros también muestra una devolución o cancelación de este pago: no se "
                "verifica. Revíselo en MultiCobros."
            )
        elif len(approved_sales.get(checkout.pk, ())) > 1:
            out = _who(out, checkout)
            out.outcome = "diferencia"
            out.message = (
                "MultiCobros muestra dos ventas aprobadas distintas con este número de control. "
                "No lo cargue en el POS y avise a dirección."
            )
        else:
            out = _sale_outcome(row, checkout, approved_elsewhere=checkout.pk in approved_sales)
        report.outcomes.append(out)

    dates = [r.fecha for r in rows if r.fecha is not None]
    if dates:
        report.date_from, report.date_to = min(dates), max(dates)
        report.outcomes.extend(_missing(report, {r.control for r in rows}))
    return report


def _missing(report: Report, controls: set[str]) -> list[Outcome]:
    """Our approved PRD payments still to verify, inside the file's dates, not in it."""
    start = report.date_from - timedelta(days=1)
    end = report.date_to + timedelta(days=1)
    candidates = (
        BanorteCheckout.objects.filter(
            resultado_payw=BanorteCheckout.Result.APPROVED,
            mode="PRD",
            verified_at__isnull=True,
            payment__status=Payment.Status.SUCCESS,
            created_at__date__gte=start,
            created_at__date__lte=end,
        )
        .select_related("payment__related_topup__student__user", "verified_by")
        .order_by("created_at", "pk")
    )
    out = []
    for checkout in candidates:
        day = _local_day(checkout.result_at or checkout.created_at)
        if checkout.control_number in controls or not (report.date_from <= day <= report.date_to):
            continue
        when = timezone.localtime(checkout.result_at or checkout.created_at)
        row = Outcome(
            outcome="no_aparece",
            message=(
                "Banorte no muestra este cobro en el reporte: no lo cargue en el POS. Búsquelo en "
                "MultiCobros por número de control."
            ),
            amount=checkout.payment.amount,
            fecha=when.date(),
            hora=when.strftime("%H:%M"),
        )
        out.append(_who(row, checkout))
    return out


# ── commit ───────────────────────────────────────────────────


def commit(report: Report, actor) -> Report:
    """Verify every ``verificar`` row through ``verify_approval`` (one locked
    transaction each), then apply the newly verified ones after their commit,
    like the dialog. Nothing else is written. Audited per verification (with
    ``via``) and once for the whole upload (counts only)."""
    from apps.cafeteria.models import CafeteriaBalance, TopUpRequest
    from apps.core.audit import record_import

    report.dry_run = False
    seen: set[int] = set()
    newly: list[Outcome] = []
    for out in report.outcomes:
        if out.outcome != "verificar" or out.payment is None:
            continue
        if out.payment.pk in seen:  # the same sale listed twice
            out.outcome, out.message = "ya_verificada", "Repetida en el archivo: ya se verificó."
            continue
        seen.add(out.payment.pk)
        try:
            result = verify_approval(
                out.payment.pk,
                referencia=out.referencia,
                amount=out.amount,
                codigo_aut=out.codigo_aut,
                actor=actor,
                via=VIA,
            )
        except VerifyError as exc:  # changed since the preview: left for a person
            out.outcome, out.message = "diferencia", f"No se verificó: {exc}"
            continue
        out.payment = result.payment
        if result.newly_verified:
            out.message = "Verificada."
            newly.append(out)
        else:
            out.outcome, out.message = "ya_verificada", "Ya estaba verificada."

    def topup_status(payment):
        return (
            TopUpRequest.objects.filter(pk=payment.related_topup_id)
            .values_list("status", flat=True)
            .first()
        )

    # Applied only after every verification committed: two top-ups of one
    # student that Loyverse holds together go in at the first call (the
    # mirror applies a gap only when every paid top-up in it is verified).
    paid_before = {
        o.payment.pk for o in newly if topup_status(o.payment) == TopUpRequest.Status.PAID
    }
    deadline = time.monotonic() + APPLY_BUDGET_SECONDS
    for out in newly:
        payment = out.payment
        status = topup_status(payment)
        if payment.pk in paid_before and status == TopUpRequest.Status.COMPLETED:
            state = "applied"  # by the call of another top-up of the same student
        elif payment.pk in paid_before and time.monotonic() > deadline:
            state = "pending_sync"  # the 5-minute POS mirror applies it
        else:
            state = apply_verified(payment, quick_read=True)["apply_state"]
        out.apply_state = state
        if state == "applied":
            balance = (
                CafeteriaBalance.objects.filter(
                    student__topup_requests__pk=payment.related_topup_id
                )
                .values_list("balance", flat=True)
                .first()
            )
            suffix = f", saldo {_mxn(balance)}" if balance is not None else ""
            out.message = f"Verificada y aplicada (ya estaba en Loyverse{suffix})."
        elif state in WAITING_STATES:
            out.message = "Verificada: se aplica sola cuando esté cargada en el POS de Loyverse."
        else:
            out.message = "Verificada."

    report.verified = len(newly)
    report.applied = sum(1 for o in newly if o.apply_state == "applied")
    report.waiting = sum(1 for o in newly if o.apply_state in WAITING_STATES)
    counts = {**report.counts, "verificadas": report.verified, "aplicadas": report.applied}
    record_import("multicobros", counts, actor, context=AUDIT_CONTEXT)
    logger.info("multicobros upload by user=%s: %s", getattr(actor, "pk", None), counts)
    return report
