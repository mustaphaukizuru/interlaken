"""
admissions/ficha_export/cellmap.py — where each datum of the ficha goes in
``ficha_inscripcion.xlsx`` (the school's 2021 «Ficha de inscripción», sheet
«Hoja1», anonymised: see ``test_ficha_template.py``).

Entries are keyed by a logical field id («alumno.curp», «padre.estado_civil»):

* ``CELLS``: one value in one cell (the top-left cell of its merged box);
* ``MARKS``: an «X» in the box of the chosen option (sexo, tipo de sangre,
  alergias, estado civil, grado académico, ocupación). «Otro» marks its box
  only: the form has no space for the text (the concentrado has it);
* ``LABEL_CELLS``: a printed label the export may rewrite. The form has boxes
  for «Soltero» and «Casado» only: «Unión libre», «Divorciado/a» and
  «Viudo/a» mark the second box and replace its «Casado» label.

Every coordinate is a cell of the original form: the export never adds a
cell, a merge or a note. ``data.py`` builds the values, ``excel.py`` writes
them into the template and ``pdf.py`` draws the same cells on its Letter
pages, so both files agree.
"""

from __future__ import annotations

SHEET = "Hoja1"
MARK = "X"

# What prints: exactly the three pages Excel prints of the original, at
# 100 % with its own margins and row heights (no manual breaks, no scaling):
# A1:AC137, rows 1-45, 46-91 and 92-137 (the privacy box ends at row 130;
# 131-137 are the blank foot of page 3). Column AD, the tail of the two
# e-mail boxes, falls outside the printed width in the original too.
PRINT_AREA = "A1:AC137"
LAST_COLUMN = 29  # AC
PAGES: tuple[tuple[int, int], ...] = ((1, 45), (46, 91), (92, 137))

# ── single values ────────────────────────────────────────────────────────
CELLS: dict[str, str] = {
    "ciclo": "F3",
    # Datos del alumno
    "alumno.apellido_paterno": "B10",
    "alumno.apellido_materno": "O10",
    "alumno.nombre": "B12",
    "alumno.nivel": "C15",
    "alumno.grado": "L15",
    "alumno.escuela_anterior": "R15",
    "alumno.nacimiento_dia": "G20",
    "alumno.nacimiento_mes": "I20",
    "alumno.nacimiento_anio": "K20",
    "alumno.pais_nacimiento": "P20",
    "alumno.estado_nacimiento": "V20",
    "alumno.curp": "F23",
    # Domicilio
    "domicilio.calle": "A27",
    "domicilio.num_ext": "L27",
    "domicilio.num_int": "P27",
    "domicilio.entre_calles": "T27",
    "domicilio.estado": "A30",
    "domicilio.municipio": "I30",
    "domicilio.colonia": "Q30",
    "domicilio.codigo_postal": "Y30",
    "domicilio.telefono_casa": "J33",
    # Datos adicionales (salud)
    "salud.estatura": "F37",
    "salud.peso": "K37",
    "salud.alergias_cuales": "T37",
    "salud.enfermedades": "F41",
    # Información en caso de emergencia
    "emergencia.apellidos": "B93",
    "emergencia.nombre": "O93",
    "emergencia.telefono": "G95",
    "emergencia.celular": "V95",
    # Aviso de privacidad: the signature lines
    "firma.alumno": "G109",
    "firma.nivel": "C111",
    "firma.grado": "K111",
    "firma.fecha": "T111",
    "firma.padre": "A118",
    "firma.madre": "T118",
}

# The two parent blocks share a layout 21 rows apart, except the contact
# row (the madre's columns are shifted in the original form).
_GUARDIAN_CELLS = {
    "padre": {
        "apellido_paterno": "B51",
        "apellido_materno": "O51",
        "nombre": "B53",
        "nacimiento_dia": "G57",
        "nacimiento_mes": "I57",
        "nacimiento_anio": "K57",
        "pais_nacimiento": "P57",
        "estado_nacimiento": "V57",
        "curp": "A60",
        "celular": "A68",
        "telefono_oficina": "I68",
        "extension": "P68",
        "correo": "T68",
    },
    "madre": {
        "apellido_paterno": "B72",
        "apellido_materno": "O72",
        "nombre": "B74",
        "nacimiento_dia": "G78",
        "nacimiento_mes": "I78",
        "nacimiento_anio": "K78",
        "pais_nacimiento": "P78",
        "estado_nacimiento": "V78",
        "curp": "A81",
        "celular": "A89",
        "telefono_oficina": "J89",
        "extension": "R89",
        "correo": "V89",
    },
}
for _role, _cells in _GUARDIAN_CELLS.items():
    CELLS.update({f"{_role}.{key}": cell for key, cell in _cells.items()})

# ── «X» marks: option value (ficha_schema) → its box ─────────────────────
SEXO_BOXES = {"alumno": ("B20", "D20"), "padre": ("B57", "D57"), "madre": ("B78", "D78")}
BLOOD_BOXES = {
    "A+": "A37",
    "A-": "A38",
    "B+": "A39",
    "B-": "A40",
    "AB+": "A41",
    "AB-": "A42",
    "O+": "A43",
    "O-": "A44",
}
# «no_se» (No lo sé) has no box on the form: nothing is marked.

MARKS: dict[str, dict[str, str]] = {
    "salud.tipo_sangre": BLOOD_BOXES,
    "salud.alergias": {"si": "P37", "no": "P38"},
}
for _who, (_fem, _masc) in SEXO_BOXES.items():
    MARKS[f"{_who}.sexo"] = {"femenino": _fem, "masculino": _masc}


def _guardian_marks(row: int) -> dict[str, dict[str, str]]:
    """Estado civil, grado académico and ocupación of the block whose
    «Estado Civil» first box is on ``row`` (60 padre, 81 madre)."""
    second, occ = row + 1, row + 4
    return {
        "estado_civil": {
            "soltero": f"K{row}",
            "casado": f"K{second}",
            "union_libre": f"K{second}",
            "divorciado": f"K{second}",
            "viudo": f"K{second}",
        },
        "grado_academico": {
            "tecnico": f"P{row}",
            "licenciatura": f"P{second}",
            "maestria": f"X{row}",
            "doctorado": f"X{second}",
        },
        "ocupacion": {
            "asalariado_sin_estudios": f"A{occ}",
            "asalariado_con_estudios": f"A{occ + 1}",
            "negocio_propio": f"N{occ}",
            "independiente": f"N{occ + 1}",
            "comerciante": f"U{occ}",
            "ama_de_casa": f"U{occ + 1}",
            "otro": f"AA{occ}",
        },
    }


GUARDIAN_ROWS = {"padre": 60, "madre": 81}
for _role, _row in GUARDIAN_ROWS.items():
    for _key, _boxes in _guardian_marks(_row).items():
        MARKS[f"{_role}.{_key}"] = _boxes

# ── labels the export may rewrite ────────────────────────────────────────
LABEL_CELLS: dict[str, str] = {
    "padre.estado_civil": "L61",
    "madre.estado_civil": "L82",
}
# Statuses without a box of their own (they take the «Casado» box).
RELABELED_MARITAL = ("union_libre", "divorciado", "viudo")


def value_cells() -> set[str]:
    """Every cell the export may write: values, marks and rewritable labels."""
    cells = set(CELLS.values()) | set(LABEL_CELLS.values())
    for boxes in MARKS.values():
        cells |= set(boxes.values())
    return cells
