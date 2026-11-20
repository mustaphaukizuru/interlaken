"""
content/table_block.py: limits of the generic «Tabla» block.

The block stores ``{columns: [{label, align?, format?}], rows: [[cell, ...]],
highlight: row index | None}``. Its limits come from the frontend registry
through block_manifest.json (``tables: {prop: {columns, rows, cell}}``), so
the editor and the API refuse the same tables. The page renders every cell as
text (no HTML), so nothing here needs sanitising beyond types and sizes.
"""

from __future__ import annotations

ALIGNS = {"left", "center", "right"}
FORMATS = {"text", "money", "number", "percent"}


def _text_ok(value, cell: int) -> bool:
    if isinstance(value, bool):
        return False
    if isinstance(value, (int, float)):
        value = str(value)
    return isinstance(value, str) and len(value) <= cell


def table_problem(value, limits: dict) -> str | None:
    """Why ``value`` is not an acceptable table (Spanish, for the editor), or None."""
    max_cols = int(limits.get("columns") or 8)
    max_rows = int(limits.get("rows") or 60)
    cell = int(limits.get("cell") or 300)
    if not isinstance(value, dict):
        return "la tabla no es válida."
    columns = value.get("columns")
    rows = value.get("rows", [])
    if not isinstance(columns, list) or not columns:
        return "la tabla necesita al menos una columna."
    if len(columns) > max_cols:
        return f"la tabla admite hasta {max_cols} columnas."
    for i, col in enumerate(columns, start=1):
        if not isinstance(col, dict) or not _text_ok(col.get("label", ""), cell):
            return f"el encabezado de la columna {i} no es válido (máximo {cell} caracteres)."
        if col.get("align") not in (None, "", *ALIGNS):
            return f"la alineación de la columna {i} no es válida."
        if col.get("format") not in (None, "", *FORMATS):
            return f"el formato de la columna {i} no es válido."
    if not isinstance(rows, list):
        return "las filas de la tabla no son válidas."
    if len(rows) > max_rows:
        return f"la tabla admite hasta {max_rows} filas."
    for r, row in enumerate(rows, start=1):
        if not isinstance(row, list) or len(row) > len(columns):
            return f"la fila {r} no coincide con las columnas."
        for c, text in enumerate(row, start=1):
            if not _text_ok(text, cell):
                return (
                    f"la celda de la fila {r}, columna {c} no es válida (máximo {cell} caracteres)."
                )
    highlight = value.get("highlight")
    if highlight is not None and (
        isinstance(highlight, bool)
        or not isinstance(highlight, int)
        or not 0 <= highlight < len(rows)
    ):
        return "la fila destacada no existe."
    return None
