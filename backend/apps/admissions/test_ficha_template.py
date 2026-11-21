"""
The anonymised «Ficha de inscripción» template (Fase 3) holds NO personal data.

``apps/admissions/ficha_export/ficha_inscripcion.xlsx`` is the school's 2021
Excel form with every value of the family that filled it removed. These tests
are the guard: the only non-empty cells are the printed labels below (exact
text), every cell the export writes is empty, and nothing else in the
package (links, comments, author, file paths, printer settings) can carry a
person's data. They also pin the print setup: Letter, portrait, the form
only, 1 page wide, exactly 3 pages.
"""

import io
import re
import zipfile

from openpyxl import load_workbook

from apps.admissions.ficha_export import cellmap, template
from apps.core.pdf_document import jpeg_image

# Every non-empty cell of the template and its exact text (rich-text labels
# compare as their plain text). A value cell would show up here.
LABELS = {
    "F2": "COLEGIO INTERLAKEN",
    "F3": "Ciclo Escolar",
    "F5": "FICHA DE INSCRIPCIÓN",
    "A8": "DATOS DEL ALUMNO",
    "B9": "APELLIDO PATERNO",
    "O9": "APELLIDO MATERNO",
    "B11": "NOMBRE",
    "C14": "Nivel (Preescolar, Primaria, Secundaria)",
    "L14": "Grado (al que se inscribe)",
    "R14": "Escuela anterior a Interlaken (sólo si aplica)",
    "B18": "Sexo",
    "G18": "Fecha de nacimiento",
    "P18": "Lugar de nacimiento",
    "B19": "Femenino",
    "D19": "Masculino",
    "G19": "Día",
    "I19": "Mes",
    "K19": "Año",
    "P19": "PAÍS",
    "V19": "ESTADO",
    "F22": "CURP ALUMNO",
    "A25": "DOMICILIO",
    "A26": "Calle",
    "L26": "Num Ext.",
    "P26": "Num Int.",
    "T26": "Entre Calles",
    "A29": "Estado",
    "I29": "Municipio o Delegación",
    "Q29": "Colonia",
    "Y29": "Código Postal",
    "J32": "Teléfono de casa (10 dígitos)",
    "A35": "DATOS ADICIONALES",
    "A36": "Tipo de Sangre",
    "F36": "Estatura",
    "K36": "Peso",
    "P36": "Alergias",
    "T36": "¿Cuáles?",
    "B37": "A+",
    "Q37": "SI",
    "B38": "A -",
    "Q38": "NO",
    "B39": "B+",
    "B40": "B -",
    "F40": "Enfermedades Crónicas",
    "B41": "AB+",
    "B42": "AB -",
    "B43": "O+",
    "B44": "O -",
    "A49": "DATOS DEL PADRE",
    "B50": "APELLIDO PATERNO",
    "O50": "APELLIDO MATERNO",
    "B52": "NOMBRE",
    "B55": "Sexo",
    "G55": "Fecha de nacimiento",
    "P55": "Lugar de nacimiento",
    "B56": "Femenino",
    "D56": "Masculino",
    "G56": "Día",
    "I56": "Mes",
    "K56": "Año",
    "P56": "PAÍS",
    "V56": "ESTADO",
    "A59": "CURP PADRE",
    "K59": "Estado Civil",
    "P59": "Grado académico",
    "L60": "Soltero",
    "Q60": "Técnico",
    "Y60": "Maestría",
    "L61": "Casado",
    "Q61": "Lic. / Ing",
    "Y61": "Doctorado",
    "A63": "Ocupación",
    "B64": "Asalariado sin estudios profesionales",
    "O64": "Negocio Propio",
    "V64": "Comerciante",
    "AB64": "Otro",
    "B65": "Asalariado con estudios profesionales",
    "O65": "Independiente",
    "V65": "Ama de casa",
    "A67": "Celular (10 dígitos)",
    "I67": "Teléfono oficina (10 dígitos)",
    "P67": "Extensión",
    "T67": "Correo electrónico",
    "A70": "DATOS DE LA MADRE",
    "B71": "APELLIDO PATERNO",
    "O71": "APELLIDO MATERNO",
    "B73": "NOMBRE",
    "B76": "Sexo",
    "G76": "Fecha de nacimiento",
    "P76": "Lugar de nacimiento",
    "B77": "Femenino",
    "D77": "Masculino",
    "G77": "Día",
    "I77": "Mes",
    "K77": "Año",
    "P77": "PAÍS",
    "V77": "ESTADO",
    "A80": "CURP MADRE",
    "K80": "Estado Civil",
    "P80": "Grado académico",
    "L81": "Soltero",
    "Q81": "Técnico",
    "Y81": "Maestría",
    "L82": "Casado",
    "Q82": "Lic. / Ing",
    "Y82": "Doctorado",
    "A84": "Ocupación",
    "B85": "Asalariado sin estudios profesionales",
    "O85": "Negocio Propio",
    "V85": "Comerciante",
    "AB85": "Otro",
    "B86": "Asalariado con estudios profesionales",
    "O86": "Independiente",
    "V86": "Ama de casa",
    "A88": "Celular (10 dígitos)",
    "J88": "Teléfono oficina (10 dígitos)",
    "R88": "Extensión",
    "V88": "Correo electrónico",
    "A91": "INFORMACIÓN EN CASO DE EMERGENCIA",
    "B92": "Apellido",
    "O92": "Nombre del Contacto",
    "A95": "Teléfono (10 dígitos)",
    "P95": "Celular (10 dígitos)",
    "A97": "AVISO DE PRIVACIDAD",
    "A99": "ADCE EDUCACIÓN, A.C., con domicilio en CALLE DE LA BOLA 34, RESIDENCIAL EL DORADO, TLALNEPANTLA, ESTADO DE MÉXICO, C.P. 54020, MÉXICO, utilizará sus datos personales recabados para:",
    "A100": "•  Llevar a cabo la inscripción del alumno en nuestro sistema escolar Servoescolar y en nuestro sistema escolar por Internet SESWEB.",
    "A101": "•  Llevar a cabo la inscripción del alumno ante la Secretaría de Educación Pública",
    "A102": "•  Generar la facturación electrónica que así se requiera.",
    "A104": "Para mayor información acerca del tratamiento y de los derechos que puede hacer valer, usted puede acceder al aviso de privacidad integral a través de:\nhttps://interlaken.edu.mx/aviso-de-privacidad",
    "A106": "Acepto la recopilación, uso, transferencia y almacenamiento de mis datos personales sensibles y los de mis hijos, los cuales fueron puestos a disposición de ADCE EDUCACIÓN, A.C. por mi propia voluntad, así mismo declaro haber leído, entendido y aceptado los términos y condiciones de Aviso de Privacidad.",
    "A109": "Nombre del Alumno:",
    "A111": "Nivel:",
    "I111": "Grado:",
    "R111": "Fecha:",
    "A119": "Nombre y Firma del Padre",
    "T119": "Nombre y Firma de la Madre",
}
# Cells that hold a label in the template and that the export may rewrite.
REWRITABLE_LABELS = {"F3", "L61", "L82"}
AVISO_URL = "https://interlaken.edu.mx/aviso-de-privacidad"
CURP_PATTERN = re.compile(rb"[A-Z]{4}\d{6}[HMX][A-Z]{5}[A-Z0-9]\d")
PHONE_PATTERN = re.compile(rb"(?<!\d)\d{10}(?!\d)")


def _sheet():
    wb = load_workbook(template.TEMPLATE_PATH, rich_text=True)
    return wb, wb[cellmap.SHEET]


def test_only_the_printed_labels_are_filled():
    _wb, ws = _sheet()
    filled = {
        c.coordinate: str(c.value) for row in ws.iter_rows() for c in row if c.value is not None
    }
    assert filled == LABELS


def test_every_cell_the_export_writes_is_empty():
    _wb, ws = _sheet()
    for coord in sorted(cellmap.value_cells() - REWRITABLE_LABELS):
        assert ws[coord].value is None, coord
    for coord in REWRITABLE_LABELS:
        assert coord in LABELS


def test_no_links_comments_or_author():
    wb, ws = _sheet()
    links = {
        c.coordinate: c.hyperlink.target
        for row in ws.iter_rows()
        for c in row
        if getattr(c, "hyperlink", None) is not None
    }
    assert links == {"A104": AVISO_URL}
    assert not any(c.comment for row in ws.iter_rows() for c in row if hasattr(c, "comment"))
    props = wb.properties
    assert props.creator == "Colegio Interlaken"
    assert props.lastModifiedBy == "Colegio Interlaken"
    assert props.lastPrinted is None
    assert not props.description and not props.subject and not props.keywords


def test_package_parts_carry_no_personal_traces():
    with zipfile.ZipFile(io.BytesIO(template.template_bytes())) as zf:
        names = zf.namelist()
        assert not [
            n for n in names if "printerSettings" in n or "comments" in n or "customXml" in n
        ]
        assert [n for n in names if n.startswith("xl/media/")] == ["xl/media/image1.jpeg"]
        for name in names:
            if not name.endswith((".xml", ".rels")):
                continue
            body = zf.read(name)
            assert b"absPath" not in body, name
            assert b"mailto:" not in body, name
            assert b"@" not in body, name
            assert not CURP_PATTERN.search(body), name
            assert not PHONE_PATTERN.search(body), name
        assert b"<Company>" not in zf.read("docProps/app.xml")


def test_fixes_over_the_2021_form():
    _wb, ws = _sheet()
    assert ws["A59"].value == "CURP PADRE" and ws["A80"].value == "CURP MADRE"
    assert ws["F3"].value == "Ciclo Escolar"
    assert "ADCE EDUCACIÓN, A.C." in ws["A99"].value
    assert (
        "CALLE DE LA BOLA 34, RESIDENCIAL EL DORADO, TLALNEPANTLA, ESTADO DE MÉXICO, " "C.P. 54020"
    ) in ws["A99"].value
    assert ws["A104"].value.endswith(AVISO_URL)
    assert "interlaken.com.mx" not in str(LABELS)


def test_print_setup_is_letter_one_page_wide_three_pages():
    _wb, ws = _sheet()
    assert ws.print_area == "'Hoja1'!$A$1:$AD$130"
    assert int(ws.page_setup.paperSize) == 1  # Letter
    assert ws.page_setup.orientation == "portrait"
    assert ws.sheet_properties.pageSetUpPr.fitToPage is True
    assert (ws.page_setup.fitToWidth, ws.page_setup.fitToHeight) == (1, 0)
    assert [b.id for b in ws.row_breaks.brk] == list(cellmap.ROW_BREAKS) == [48, 90]
    assert ws["A49"].value == "DATOS DEL PADRE"  # page 2 starts here
    assert ws["A91"].value == "INFORMACIÓN EN CASO DE EMERGENCIA"  # page 3 starts here
    # Every page fits a Letter sheet at 100 % (Excel adds a page otherwise).
    margins = (ws.page_margins.top + ws.page_margins.bottom) * 72
    for first, last in cellmap.PAGES:
        height = sum(ws.row_dimensions[r].height or 15.75 for r in range(first, last + 1))
        assert height <= 792 - margins - 15, (first, last)


def test_logo_is_the_official_jpeg():
    _wb, ws = _sheet()
    assert len(ws._images) == 1
    assert jpeg_image(template.logo_jpeg()) is not None
