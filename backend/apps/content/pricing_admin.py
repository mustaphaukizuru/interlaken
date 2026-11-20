"""
content/pricing_admin.py: «Costos y precios» in the console (/admin/costos).

The figures of /admisiones/costos and of the Admisiones estimator live in six
models (models.py: TuitionCost and the five PricingRow tables). Until now only
a superuser could edit them, in Django admin. This module gives Dirección a
spreadsheet-like editor:

* ``GET  /content/admin/pricing/``            every table: rows + a version
* ``PUT  /content/admin/pricing/``            save several tables at once
* ``GET|PUT /content/admin/pricing/<table>/``  one table
* ``GET  /content/admin/pricing/export/``     the whole price list as .xlsx
* ``POST /content/admin/pricing/import/``     read an .xlsx back (never writes)

A save sends the WHOLE table (the console edits a table and saves once):
rows with an ``id`` are updated, rows without one are created, rows missing
from the list are deleted, and the list order becomes ``order``. Everything
runs in one transaction: any invalid row rolls back every table, and the
answer lists each problem as ``{row, field, label, message}``. A ``version``
per table (taken when the console loaded it) turns a concurrent edit into a
409 instead of silently dropping the other person's rows.

Every created, changed or deleted row writes one ``AuditLog`` entry with the
amounts before and after (context ``cms.pricing``); the public pricing cache
is cleared when the transaction commits.

The import only reads the file: the console shows what would change and loads
the rows into the editor, where they are saved like any other edit.
"""

from __future__ import annotations

import hashlib
import io
import unicodedata
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation

from django.core.cache import cache
from django.db import transaction
from django.http import HttpResponse
from rest_framework import status
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.audit import record, record_export
from apps.core.exceptions import PayloadTooLarge, error_response
from apps.core.exporting import CONTENT_TYPES, looks_like_formula
from apps.core.exports import as_download, export_filename
from apps.core.permissions import IsAdmin
from apps.core.throttling import SharedScopedRateThrottle

from .models import (
    COSTS_CACHE_KEY,
    PRICING_CACHE_KEY,
    DaycareRate,
    EnrollmentFee,
    ExtracurricularActivity,
    FixedConcept,
    PricingPolicy,
    TuitionCost,
)
from .ops import audit_value, delete_keep_pk

AUDIT_CONTEXT = "cms.pricing"
MAX_ROWS = 100  # per table; the flyer has at most a dozen
MAX_AMOUNT = Decimal("999999.99")  # DecimalField(max_digits=8, decimal_places=2)
MAX_IMPORT_BYTES = 2 * 1024 * 1024
CENT = Decimal("0.01")


# ── table definitions ─────────────────────────────────────
@dataclass(frozen=True)
class Col:
    key: str
    label: str
    kind: str = "text"  # text | textarea | money | choice
    required: bool = True
    max_length: int = 0
    choices: tuple = ()  # ((value, label), ...)
    aliases: tuple = ()  # extra spreadsheet headers accepted on import
    width: int = 18


@dataclass(frozen=True)
class Table:
    key: str
    model: type
    label: str
    sheet: str
    cols: tuple
    unique: tuple = ()  # field keys whose combination must be unique
    sheet_aliases: tuple = ()
    title_of: tuple = ()  # field keys that name a row in messages
    # Rows the public page shows as separate lists (inscripción: one per
    # modality) number their ``order`` within their group, 1, 2, 3...
    group_by: str = ""

    def col(self, key):
        return next((c for c in self.cols if c.key == key), None)


MODALITY_CHOICES = tuple(EnrollmentFee.Modality.choices)

TABLES: dict[str, Table] = {
    t.key: t
    for t in (
        Table(
            "inscripcion",
            EnrollmentFee,
            "Inscripción y reinscripción",
            "Inscripción",
            (
                Col("modality", "Modalidad", "choice", choices=MODALITY_CHOICES, width=26),
                Col("section", "Nivel", max_length=60, aliases=("seccion",), width=24),
                Col("gastos_administrativos", "Gastos administrativos", "money", width=22),
                Col(
                    "cuota",
                    "Inscripción o reinscripción",
                    "money",
                    aliases=("cuota", "inscripcion", "reinscripcion"),
                    width=26,
                ),
            ),
            unique=("section", "modality"),
            sheet_aliases=("inscripciones", "inscripcion y reinscripcion", "reinscripcion"),
            title_of=("section", "modality"),
            group_by="modality",
        ),
        Table(
            "colegiaturas",
            TuitionCost,
            "Colegiaturas",
            "Colegiaturas",
            (
                Col("section", "Sección", max_length=60, aliases=("nivel",), width=28),
                Col(
                    "colegiatura",
                    "Colegiatura mensual",
                    "money",
                    aliases=("colegiatura", "mensualidad"),
                    width=22,
                ),
            ),
            unique=("section",),
            sheet_aliases=("colegiatura",),
            title_of=("section",),
        ),
        Table(
            "seguros",
            FixedConcept,
            "Seguros y credenciales",
            "Seguros",
            (
                Col("name", "Concepto", max_length=80, width=28),
                Col("cost", "Costo anual", "money", aliases=("costo", "monto"), width=18),
            ),
            unique=("name",),
            sheet_aliases=("seguros y credenciales", "credenciales"),
            title_of=("name",),
        ),
        Table(
            "extraescolares",
            ExtracurricularActivity,
            "Extraescolares",
            "Extraescolares",
            (
                Col("name", "Clase", max_length=80, width=24),
                Col("levels", "Niveles", max_length=120, width=30),
                Col(
                    "annual_cost", "Anualidad", "money", aliases=("costo anual", "costo"), width=18
                ),
            ),
            unique=("name",),
            sheet_aliases=("extraescolar", "clases extraescolares"),
            title_of=("name",),
        ),
        Table(
            "estancia",
            DaycareRate,
            "Estancia",
            "Estancia",
            (
                Col("schedule", "Horario", max_length=60, width=20),
                Col("service", "Servicio", max_length=120, width=30),
                Col("daily_cost", "Costo diario", "money", width=16),
                Col("monthly_cost", "Costo mensual", "money", required=False, width=16),
                Col(
                    "monthly_note",
                    "Nota de la mensualidad",
                    required=False,
                    max_length=120,
                    aliases=("nota",),
                    width=32,
                ),
            ),
            unique=("schedule", "service"),
            sheet_aliases=("horario extendido",),
            title_of=("schedule", "service"),
        ),
        Table(
            "politicas",
            PricingPolicy,
            "Políticas de pago",
            "Políticas",
            (Col("text", "Política", "textarea", max_length=600, aliases=("texto",), width=90),),
            sheet_aliases=("politicas de pago", "politica"),
            title_of=("text",),
        ),
    )
}


def _fold(text) -> str:
    """'  Políticas de PAGO ' → 'politicas de pago' (accents and case folded)."""
    folded = "".join(
        ch for ch in unicodedata.normalize("NFKD", str(text or "")) if not unicodedata.combining(ch)
    )
    return " ".join(folded.lower().replace("_", " ").split())


# ── reading ───────────────────────────────────────────────
def _value(obj, col: Col):
    v = getattr(obj, col.key)
    if col.kind == "money":
        return None if v is None else f"{Decimal(v).quantize(CENT):.2f}"
    return v


def serialize_row(table: Table, obj) -> dict:
    row = {"id": obj.pk, "is_active": obj.is_active}
    for col in table.cols:
        row[col.key] = _value(obj, col)
    return row


def table_rows(table: Table, *, lock: bool = False):
    qs = table.model.objects.all().order_by("order", "id")
    if lock:
        qs = qs.select_for_update()
    return list(qs)


def table_version(objs) -> str:
    """Changes whenever a row is added, removed or saved (``updated_at``)."""
    digest = hashlib.sha1()
    for obj in sorted(objs, key=lambda o: o.pk):
        digest.update(f"{obj.pk}:{obj.updated_at.isoformat()};".encode())
    return f"{len(objs)}-{digest.hexdigest()[:16]}"


def table_payload(table: Table) -> dict:
    objs = table_rows(table)
    return {
        "key": table.key,
        "label": table.label,
        "rows": [serialize_row(table, o) for o in objs],
        "version": table_version(objs),
    }


# ── validation ────────────────────────────────────────────
class RowErrors:
    def __init__(self):
        self.items: list[dict] = []

    def add(self, table: Table, row: int, col_key: str, message: str, line: int | None = None):
        col = table.col(col_key)
        item = {
            "row": row,
            "field": col_key,
            "label": col.label if col else col_key,
            "message": message,
        }
        if line is not None:
            item["line"] = line
        self.items.append(item)

    def __bool__(self):
        return bool(self.items)


def parse_amount(value) -> Decimal:
    """``6450``, ``'6,450.50'``, ``'$ 6450'``, Excel's ``6450.0`` → ``Decimal('6450.50')``.

    Raises ``ValueError`` with the message shown next to the cell.
    """
    if isinstance(value, bool):
        raise ValueError("Escriba un monto, por ejemplo 6450.00.")
    if isinstance(value, float):
        value = repr(value)
    text = str(value).strip().replace("$", "").replace(",", "").replace(" ", "")
    try:
        amount = Decimal(text)
    except InvalidOperation:
        raise ValueError("Escriba un monto, por ejemplo 6450.00.") from None
    if not amount.is_finite():
        raise ValueError("Escriba un monto, por ejemplo 6450.00.")
    if amount < 0:
        raise ValueError("El monto no puede ser negativo.")
    if amount != amount.quantize(CENT):
        raise ValueError("Use como máximo 2 decimales.")
    if amount > MAX_AMOUNT:
        raise ValueError("El monto máximo es $999,999.99.")
    return amount.quantize(CENT)


def _choice(col: Col, value):
    wanted = _fold(value)
    for val, label in col.choices:
        if wanted in (_fold(val), _fold(label)):
            return val
    # «Reinscripción» without «(alumnos Interlaken)», «nuevo» for «Nuevo ingreso».
    for val, label in col.choices:
        if wanted and (
            _fold(label).startswith(wanted) or _fold(val).startswith(wanted.replace(" ", "_"))
        ):
            return val
    raise ValueError("Elija una modalidad: Nuevo ingreso o Reinscripción.")


def clean_rows(
    table: Table, rows, errors: RowErrors, *, lines: list[int] | None = None
) -> list[dict]:
    """Validate the submitted rows of ``table``; returns them typed (``Decimal`` amounts)."""
    if not isinstance(rows, list):
        errors.add(table, 0, "", "La tabla debe ser una lista de filas.")
        return []
    if len(rows) > MAX_ROWS:
        errors.add(table, 0, "", f"Máximo {MAX_ROWS} filas por tabla.")
        return []
    out = []
    for i, raw in enumerate(rows):
        line = lines[i] if lines else None
        raw = raw if isinstance(raw, dict) else {}
        row: dict = {}
        rid = raw.get("id")
        if rid in ("", None):
            row["id"] = None
        else:
            try:
                row["id"] = int(rid)
            except (TypeError, ValueError):
                errors.add(table, i, "id", "Identificador de fila no válido.", line)
                row["id"] = None
        active = raw.get("is_active", True)
        row["is_active"] = (
            active
            if isinstance(active, bool)
            else str(active).strip().lower() not in ("0", "false", "no", "off", "")
        )
        for col in table.cols:
            value = raw.get(col.key)
            empty = value is None or (isinstance(value, str) and not value.strip())
            if empty:
                if col.required:
                    errors.add(table, i, col.key, "Este dato es obligatorio.", line)
                row[col.key] = None if col.kind == "money" else ""
                continue
            try:
                if col.kind == "money":
                    row[col.key] = parse_amount(value)
                elif col.kind == "choice":
                    row[col.key] = _choice(col, value)
                else:
                    text = (
                        " ".join(str(value).split()) if col.kind == "text" else str(value).strip()
                    )
                    if col.max_length and len(text) > col.max_length:
                        raise ValueError(f"Máximo {col.max_length} caracteres.")
                    if looks_like_formula(text) and text[0] in "=@":
                        raise ValueError("No puede empezar con «=» ni «@».")
                    row[col.key] = text
            except ValueError as exc:
                errors.add(table, i, col.key, str(exc), line)
                row[col.key] = None if col.kind == "money" else ""
        out.append(row)

    if table.unique:
        seen: dict[tuple, int] = {}
        for i, row in enumerate(out):
            key = tuple(_fold(row.get(k)) for k in table.unique)
            if not all(key):
                continue
            if key in seen:
                first = seen[key] + 1
                where = (
                    f' en {dict(MODALITY_CHOICES).get(row.get("modality"), "")}'
                    if "modality" in table.unique
                    else ""
                )
                errors.add(
                    table,
                    i,
                    table.unique[0],
                    f"Repetido{where}: la fila {first} ya tiene este valor.",
                    lines[i] if lines else None,
                )
            else:
                seen[key] = i
    return out


# ── saving ────────────────────────────────────────────────
class VersionConflict(Exception):
    """A table changed since the console loaded it (another person saved)."""

    def __init__(self, tables):
        super().__init__("conflict")
        self.tables = tables


class RowErrorsFound(Exception):
    """``{table_key: [{row, field, label, message}, ...]}``; nothing was written."""

    def __init__(self, errors: dict):
        super().__init__("invalid rows")
        self.errors = errors


def _snapshot(table: Table, obj) -> dict:
    snap = {c.key: audit_value(getattr(obj, c.key)) for c in table.cols}
    snap["is_active"] = obj.is_active
    return snap


def _apply_table(table: Table, cleaned: list[dict], current: list, actor, context: str) -> dict:
    by_id = {o.pk: o for o in current}
    counts = {"created": 0, "updated": 0, "deleted": 0}
    keep = {r["id"] for r in cleaned if r["id"]}
    for obj in current:
        if obj.pk not in keep:
            snapshot = _snapshot(table, obj)
            delete_keep_pk(obj)
            record(
                "delete",
                obj,
                {k: [v, None] for k, v in snapshot.items()},
                actor=actor,
                context=context,
            )
            counts["deleted"] += 1
    positions: dict[str, int] = {}
    for row in cleaned:
        group = str(row.get(table.group_by) or "") if table.group_by else ""
        positions[group] = order = positions.get(group, 0) + 1
        values = {c.key: row[c.key] for c in table.cols}
        values["is_active"] = row["is_active"]
        values["order"] = order
        obj = by_id.get(row["id"]) if row["id"] else None
        if obj is None:
            obj = table.model(**values)
            obj.save()
            record(
                "create",
                obj,
                {k: [None, audit_value(v)] for k, v in values.items()},
                actor=actor,
                context=context,
            )
            counts["created"] += 1
            continue
        diff = {}
        for key, new in values.items():
            old = getattr(obj, key)
            if isinstance(old, Decimal) or isinstance(new, Decimal):
                same = (old is None and new is None) or (
                    old is not None
                    and new is not None
                    and Decimal(old).quantize(CENT) == Decimal(new).quantize(CENT)
                )
            else:
                same = old == new
            if not same:
                diff[key] = [audit_value(old), audit_value(new)]
                setattr(obj, key, new)
        if diff:
            obj.save()
            record("update", obj, diff, actor=actor, context=context)
            counts["updated"] += 1
    return counts


def invalidate_pricing() -> None:
    cache.delete(PRICING_CACHE_KEY)
    cache.delete(COSTS_CACHE_KEY)


def save_tables(payload: dict, actor, *, context: str = AUDIT_CONTEXT) -> dict:
    """Validate then write ``{table_key: {rows, version?}}`` in one transaction.

    Returns ``{'tables': {key: table_payload}, 'counts': {key: {...}}}``.
    Raises ``RowErrorsFound`` or ``VersionConflict`` before writing anything.
    """
    errors = RowErrors()
    cleaned: dict[str, list[dict]] = {}
    by_table: dict[str, RowErrors] = {}
    for key, body in payload.items():
        table = TABLES[key]
        table_errors = RowErrors()
        cleaned[key] = clean_rows(table, (body or {}).get("rows"), table_errors)
        by_table[key] = table_errors
        errors.items.extend(table_errors.items)

    with transaction.atomic():
        current = {key: table_rows(TABLES[key], lock=True) for key in payload}
        stale = [
            key
            for key, body in payload.items()
            if (body or {}).get("version") and body["version"] != table_version(current[key])
        ]
        if stale:
            raise VersionConflict(stale)
        # A row id that is not (any more) in the table: stop before writing.
        for key, rows in cleaned.items():
            known = {o.pk for o in current[key]}
            for i, row in enumerate(rows):
                if row["id"] and row["id"] not in known:
                    by_table[key].add(
                        TABLES[key], i, "id", "Esta fila ya no existe; recargue la página."
                    )
        if any(by_table.values()):
            raise RowErrorsFound({k: v.items for k, v in by_table.items() if v})
        counts = {
            key: _apply_table(TABLES[key], rows, current[key], actor, context)
            for key, rows in cleaned.items()
        }
        transaction.on_commit(invalidate_pricing)
    return {"tables": {key: table_payload(TABLES[key]) for key in payload}, "counts": counts}


def _save_response(payload: dict, request) -> Response:
    source = str(request.data.get("source") or "").strip()
    context = f"{AUDIT_CONTEXT}.import" if source == "import" else AUDIT_CONTEXT
    try:
        result = save_tables(payload, request.user, context=context)
    except RowErrorsFound as exc:
        total = sum(len(v) for v in exc.errors.values())
        return error_response(
            (
                "Revise los datos marcados: no se guardó nada."
                if total != 1
                else "Revise el dato marcado: no se guardó nada."
            ),
            code="invalid_rows",
            errors=exc.errors,
        )
    except VersionConflict as exc:
        names = ", ".join(TABLES[k].label for k in exc.tables)
        return error_response(
            f"Otra persona cambió {names} mientras usted editaba. Recargue para ver la versión actual; "
            "sus cambios no se guardaron.",
            status.HTTP_409_CONFLICT,
            code="version_conflict",
            tables=exc.tables,
        )
    return Response(result)


# ── views ─────────────────────────────────────────────────
class AdminPricingView(APIView):
    """GET every price table; PUT ``{tables: {key: {rows, version}}, source?}`` saves them together."""

    permission_classes = [IsAdmin]
    parser_classes = [JSONParser]

    def get(self, request):
        return Response({"tables": {key: table_payload(t) for key, t in TABLES.items()}})

    def put(self, request):
        tables = request.data.get("tables") if isinstance(request.data, dict) else None
        if not isinstance(tables, dict) or not tables:
            return error_response("Envíe al menos una tabla en «tables».")
        unknown = [k for k in tables if k not in TABLES]
        if unknown:
            return error_response(f'Tabla desconocida: {", ".join(unknown)}.')
        return _save_response(tables, request)


class AdminPricingTableView(APIView):
    """GET one table; PUT ``{rows, version}`` replaces it (atomic, audited)."""

    permission_classes = [IsAdmin]
    parser_classes = [JSONParser]

    def _table(self, key):
        return TABLES.get(key)

    def get(self, request, table):
        t = self._table(table)
        if t is None:
            return error_response("Tabla desconocida.", status.HTTP_404_NOT_FOUND)
        return Response(table_payload(t))

    def put(self, request, table):
        t = self._table(table)
        if t is None:
            return error_response("Tabla desconocida.", status.HTTP_404_NOT_FOUND)
        body = request.data if isinstance(request.data, dict) else {}
        result = _save_response(
            {t.key: {"rows": body.get("rows"), "version": body.get("version")}}, request
        )
        if result.status_code == 200:
            result.data = {**result.data["tables"][t.key], "counts": result.data["counts"][t.key]}
        return result


# ── spreadsheet ───────────────────────────────────────────
INSTRUCTIONS = (
    "Precios del Colegio Interlaken: una hoja por tabla de Admisiones › Costos.",
    "Cambie los montos y textos, agregue filas al final o borre filas completas.",
    "Deje vacía la columna «ID» en las filas nuevas y no la cambie en las demás.",
    "«Visible» = Sí o No (No oculta la fila en el sitio sin borrarla).",
    "Las hojas que borre del archivo no se tocan. Al importar verá cada cambio antes de guardarlo.",
)
MONEY_FORMAT = '"$"#,##0.00'


def _cell_value(col: Col, obj):
    v = getattr(obj, col.key)
    if col.kind == "money":
        return None if v is None else Decimal(v).quantize(CENT)
    if col.kind == "choice":
        return dict(col.choices).get(v, v)
    return v


def workbook_bytes() -> tuple[bytes, int]:
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font
    from openpyxl.utils import get_column_letter

    wb = Workbook()
    info = wb.active
    info.title = "Instrucciones"
    info.column_dimensions["A"].width = 100
    info.append(["Cómo usar este archivo"])
    info["A1"].font = Font(bold=True, size=13)
    for line in INSTRUCTIONS:
        info.append([line])
    total = 0
    bold = Font(bold=True)
    for table in TABLES.values():
        ws = wb.create_sheet(table.sheet)
        headers = [c.label for c in table.cols] + ["Visible", "ID"]
        ws.append(headers)
        for cell in ws[1]:
            cell.font = bold
        ws.freeze_panes = "A2"
        widths = [c.width for c in table.cols] + [10, 8]
        for i, w in enumerate(widths, start=1):
            ws.column_dimensions[get_column_letter(i)].width = w
        for obj in table_rows(table):
            values = [_cell_value(c, obj) for c in table.cols] + [
                "Sí" if obj.is_active else "No",
                obj.pk,
            ]
            ws.append(values)
            total += 1
            r = ws.max_row
            for i, col in enumerate(table.cols, start=1):
                cell = ws.cell(row=r, column=i)
                if col.kind == "money":
                    cell.number_format = MONEY_FORMAT
                elif isinstance(cell.value, str) and cell.data_type == "f":
                    cell.data_type = "s"
                if col.kind == "textarea":
                    cell.alignment = Alignment(wrap_text=True, vertical="top")
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue(), total


class AdminPricingExportView(APIView):
    """GET the price list as .xlsx (one sheet per table, plus instructions)."""

    permission_classes = [IsAdmin]

    def get(self, request):
        data, total = workbook_bytes()
        record_export(
            "content.pricing", "xlsx", {}, total, request.user, context="export:content.pricing"
        )
        response = HttpResponse(data, content_type=CONTENT_TYPES["xlsx"])
        return as_download(response, export_filename("precios", "xlsx"))


def _sheet_table(title) -> Table | None:
    wanted = _fold(title)
    for table in TABLES.values():
        names = {_fold(table.sheet), _fold(table.key), _fold(table.label)} | {
            _fold(a) for a in table.sheet_aliases
        }
        if wanted in names:
            return table
    return None


def _header_map(table: Table, headers) -> dict[int, str]:
    out: dict[int, str] = {}
    for i, h in enumerate(headers):
        name = _fold(h)
        if not name:
            continue
        if name in ("id", "id no modificar"):
            out[i] = "id"
        elif name in ("visible", "activo", "mostrar"):
            out[i] = "is_active"
        else:
            for col in table.cols:
                if col.key in out.values():
                    continue
                if name in {_fold(col.label), _fold(col.key)} | {_fold(a) for a in col.aliases}:
                    out[i] = col.key
                    break
    return out


def read_workbook(data: bytes) -> dict:
    """Parse an uploaded price workbook: ``{tables, ignored_sheets}`` (no writes)."""
    from openpyxl import load_workbook

    try:
        wb = load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    except Exception:
        raise ValueError(
            "No se pudo leer el archivo. Use el Excel (.xlsx) descargado con «Exportar Excel»."
        ) from None
    tables: dict[str, dict] = {}
    ignored: list[str] = []
    try:
        for ws in wb.worksheets:
            table = _sheet_table(ws.title)
            if table is None or table.key in tables:
                ignored.append(ws.title)
                continue
            iterator = ws.iter_rows(values_only=True)
            headers = list(next(iterator, ()) or ())
            mapping = _header_map(table, headers)
            missing = [c.label for c in table.cols if c.required and c.key not in mapping.values()]
            if missing:
                tables[table.key] = {
                    "sheet": ws.title,
                    "rows": [],
                    "errors": [
                        {
                            "row": 0,
                            "line": 1,
                            "field": "",
                            "label": "",
                            "message": f'Faltan columnas: {", ".join(missing)}.',
                        }
                    ],
                }
                continue
            rows, lines = [], []
            for line, values in enumerate(iterator, start=2):
                cells = list(values or ())
                if not any(v not in (None, "") and str(v).strip() for v in cells):
                    continue
                raw = {}
                for i, key in mapping.items():
                    v = cells[i] if i < len(cells) else None
                    raw[key] = v.strip() if isinstance(v, str) else v
                if "is_active" in raw:
                    flag = _fold(raw["is_active"])
                    raw["is_active"] = flag not in ("no", "n", "0", "false", "falso", "oculto")
                rows.append(raw)
                lines.append(line)
                if len(rows) > MAX_ROWS:
                    break
            errors = RowErrors()
            cleaned = clean_rows(table, rows, errors, lines=lines)
            known = set(table.model.objects.values_list("pk", flat=True))
            for i, row in enumerate(cleaned):
                if row["id"] and row["id"] not in known:
                    errors.add(
                        table,
                        i,
                        "id",
                        f'No existe una fila con ID {row["id"]} en {table.label}; borre el ID para agregarla como nueva.',
                        lines[i],
                    )
            tables[table.key] = {
                "sheet": ws.title,
                "rows": [
                    {k: (f"{v:.2f}" if isinstance(v, Decimal) else v) for k, v in r.items()}
                    for r in cleaned
                ],
                "errors": errors.items,
            }
    finally:
        wb.close()
    return {"tables": tables, "ignored_sheets": ignored}


class AdminPricingImportView(APIView):
    """POST multipart ``file`` (.xlsx): what the file contains, validated. Never writes."""

    permission_classes = [IsAdmin]
    throttle_classes = [SharedScopedRateThrottle]
    throttle_scope = "admin-import"
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request):
        upload = request.FILES.get("file")
        if upload is None:
            return error_response("Adjunte el archivo de Excel (.xlsx) en el campo «file».")
        if getattr(upload, "size", 0) > MAX_IMPORT_BYTES:
            raise PayloadTooLarge(detail="El archivo excede el límite de 2 MB.")
        data = upload.read()
        if data[:4] != b"PK\x03\x04":
            return error_response(
                "Use un archivo de Excel (.xlsx), como el que descarga «Exportar Excel»."
            )
        try:
            result = read_workbook(data)
        except ValueError as exc:
            return error_response(str(exc))
        if not result["tables"]:
            names = ", ".join(t.sheet for t in TABLES.values())
            return error_response(f"El archivo no tiene ninguna hoja de precios ({names}).")
        return Response(result)
