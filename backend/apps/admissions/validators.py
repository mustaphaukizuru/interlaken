"""
admissions/validators.py — value rules of the ficha de inscripción.

Pure functions (no DRF, no models): each ``normalize_*`` returns the cleaned
value or raises ``FichaValueError`` with the Spanish message the family reads
(usted form). The serializers in ``admissions.ficha`` turn that into a field
error.

* CURP: 18 characters, the official RENAPO pattern and check digit. Helpers
  read the birth date (position 17 sets the century: a digit is the 1900s, a
  letter the 2000s) and the sex (H → masculino, M → femenino, X accepted).
* Phones: 10 digits after stripping spaces, dashes, dots, parentheses and a
  +52 / 52 prefix (and the old mobile «1» after +52).
* Código postal: 5 digits.
* ``ESTADOS``: the 32 entidades federativas, the single list every state
  field uses.
"""

from __future__ import annotations

import re
import unicodedata
from datetime import date


class FichaValueError(ValueError):
    """A value the family typed is not valid; ``str(exc)`` is the message."""


# ── entidades federativas ────────────────────────────────────────────────
# Name (as stored and shown) → RENAPO code used inside the CURP.
ENTIDADES: dict[str, str] = {
    "Aguascalientes": "AS",
    "Baja California": "BC",
    "Baja California Sur": "BS",
    "Campeche": "CC",
    "Chiapas": "CS",
    "Chihuahua": "CH",
    "Ciudad de México": "DF",
    "Coahuila": "CL",
    "Colima": "CM",
    "Durango": "DG",
    "Estado de México": "MC",
    "Guanajuato": "GT",
    "Guerrero": "GR",
    "Hidalgo": "HG",
    "Jalisco": "JC",
    "Michoacán": "MN",
    "Morelos": "MS",
    "Nayarit": "NT",
    "Nuevo León": "NL",
    "Oaxaca": "OC",
    "Puebla": "PL",
    "Querétaro": "QT",
    "Quintana Roo": "QR",
    "San Luis Potosí": "SP",
    "Sinaloa": "SL",
    "Sonora": "SR",
    "Tabasco": "TC",
    "Tamaulipas": "TS",
    "Tlaxcala": "TL",
    "Veracruz": "VZ",
    "Yucatán": "YN",
    "Zacatecas": "ZS",
}
ESTADOS: tuple[str, ...] = tuple(ENTIDADES)
# «NE» = nacido en el extranjero.
CURP_STATE_CODES: frozenset[str] = frozenset(ENTIDADES.values()) | {"NE"}

MEXICO = "México"


def fold_text(text: str) -> str:
    """Lowercase, accents removed, single spaces: for lenient comparisons."""
    text = unicodedata.normalize("NFKD", str(text or ""))
    text = "".join(c for c in text if not unicodedata.combining(c))
    return " ".join(text.lower().split())


_STATE_ALIASES = {
    "cdmx": "Ciudad de México",
    "df": "Ciudad de México",
    "distrito federal": "Ciudad de México",
    "ciudad de mexico": "Ciudad de México",
    "edomex": "Estado de México",
    "edo mex": "Estado de México",
    "edo. mex.": "Estado de México",
    "mexico": "Estado de México",
    "estado de mexico": "Estado de México",
    "coahuila de zaragoza": "Coahuila",
    "michoacan de ocampo": "Michoacán",
    "veracruz de ignacio de la llave": "Veracruz",
}
_STATE_BY_FOLD = {fold_text(name): name for name in ESTADOS}


def normalize_state(value: str) -> str | None:
    """The canonical entidad name for ``value`` (accents/case/aliases tolerated), else None."""
    key = fold_text(value)
    if not key:
        return None
    return _STATE_BY_FOLD.get(key) or _STATE_ALIASES.get(key)


_MEXICO_ALIASES = {
    "mexico",
    "mx",
    "mex",
    "estados unidos mexicanos",
    "republica mexicana",
}


def normalize_country(value: str) -> str:
    """'mexico', 'MX', 'República Mexicana' → 'México'; other countries trimmed as typed."""
    text = " ".join(str(value or "").split())
    if fold_text(text) in _MEXICO_ALIASES:
        return MEXICO
    return text


def is_mexico(country: str) -> bool:
    return normalize_country(country) == MEXICO


# ── CURP ─────────────────────────────────────────────────────────────────
CURP_ALPHABET = "0123456789ABCDEFGHIJKLMNÑOPQRSTUVWXYZ"
CURP_RE = re.compile(
    r"^[A-Z][AEIOUX][A-Z]{2}"  # iniciales
    r"\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])"  # AAMMDD
    r"[HMX]"  # sexo
    r"(" + "|".join(sorted(CURP_STATE_CODES)) + r")"  # entidad de nacimiento
    r"[B-DF-HJ-NP-TV-Z]{3}"  # consonantes internas
    r"[A-Z\d]"  # siglo: dígito 1900, letra 2000
    r"\d$"  # dígito verificador
)
CURP_SEX = {"H": "masculino", "M": "femenino"}

MSG_CURP_LENGTH = "La CURP debe tener 18 caracteres (escribió {n})."
MSG_CURP_FORMAT = (
    "La CURP no tiene el formato oficial. Revísela en el acta de nacimiento "
    "o consúltela en gob.mx/curp."
)
MSG_CURP_DATE = "La fecha de nacimiento que contiene la CURP no es válida. Revise la CURP."
MSG_CURP_DIGIT = (
    "El último dígito de la CURP no corresponde a los demás. "
    "Revise que la haya escrito sin errores."
)
MSG_CURP_DOB = (
    "La CURP indica que la fecha de nacimiento es {fecha}. "
    "Revise la fecha de nacimiento o la CURP."
)
MSG_CURP_SEX = "El sexo que eligió no coincide con la CURP. Revise ambos datos."


def clean_curp(value: str) -> str:
    """Uppercase, without spaces or dashes (what people paste from the PDF)."""
    return re.sub(r"[\s\-]", "", str(value or "")).upper()


def curp_check_digit(first17: str) -> int:
    """The official check digit for the first 17 characters of a CURP."""
    total = 0
    for i, char in enumerate(first17[:17]):
        total += CURP_ALPHABET.index(char) * (18 - i)
    return (10 - total % 10) % 10


def curp_birth_date(curp: str) -> date | None:
    """The birth date encoded in a CURP (None when it is not a real date)."""
    curp = clean_curp(curp)
    if len(curp) < 17:
        return None
    try:
        yy, mm, dd = int(curp[4:6]), int(curp[6:8]), int(curp[8:10])
    except ValueError:
        return None
    century = 1900 if curp[16].isdigit() else 2000
    try:
        return date(century + yy, mm, dd)
    except ValueError:
        return None


def curp_sex(curp: str) -> str | None:
    """'masculino' (H), 'femenino' (M) or None (X or unreadable)."""
    curp = clean_curp(curp)
    return CURP_SEX.get(curp[10]) if len(curp) > 10 else None


def normalize_curp(value: str) -> str:
    """A valid CURP in canonical form, or ``FichaValueError``. Blank stays blank."""
    curp = clean_curp(value)
    if not curp:
        return ""
    if len(curp) != 18:
        raise FichaValueError(MSG_CURP_LENGTH.format(n=len(curp)))
    if not CURP_RE.match(curp):
        raise FichaValueError(MSG_CURP_FORMAT)
    if curp_birth_date(curp) is None:
        raise FichaValueError(MSG_CURP_DATE)
    if curp_check_digit(curp[:17]) != int(curp[17]):
        raise FichaValueError(MSG_CURP_DIGIT)
    return curp


def curp_agreement_errors(curp: str, dob: date | None, sex: str | None) -> list[str]:
    """Messages for a valid CURP that disagrees with the typed birth date or sex."""
    errors = []
    if not curp:
        return errors
    encoded = curp_birth_date(curp)
    if dob and encoded and encoded != dob:
        errors.append(MSG_CURP_DOB.format(fecha=encoded.strftime("%d/%m/%Y")))
    encoded_sex = curp_sex(curp)
    if sex and encoded_sex and encoded_sex != sex:
        errors.append(MSG_CURP_SEX)
    return errors


# ── teléfonos, código postal ─────────────────────────────────────────────
MSG_PHONE = "Escriba un teléfono de 10 dígitos, por ejemplo 55 1234 5678."
MSG_EXT = "La extensión solo lleva números (hasta 6)."
MSG_CP = "El código postal debe tener 5 dígitos."


def normalize_phone(value: str) -> str:
    """10 digits, or ``FichaValueError``. Blank stays blank."""
    digits = re.sub(r"[\s\-.()]", "", str(value or ""))
    if not digits:
        return ""
    country_code = False
    if digits.startswith("+52"):
        digits, country_code = digits[3:], True
    elif digits.startswith("52") and len(digits) in (12, 13):
        digits, country_code = digits[2:], True
    # «+52 1 55…»: the mobile prefix Mexico dropped in 2019, still on old cards.
    if country_code and len(digits) == 11 and digits.startswith("1"):
        digits = digits[1:]
    if not re.fullmatch(r"\d{10}", digits):
        raise FichaValueError(MSG_PHONE)
    return digits


def normalize_extension(value: str) -> str:
    ext = re.sub(r"\s", "", str(value or ""))
    if ext and not re.fullmatch(r"\d{1,6}", ext):
        raise FichaValueError(MSG_EXT)
    return ext


def normalize_postal_code(value: str) -> str:
    cp = re.sub(r"\s", "", str(value or ""))
    if cp and not re.fullmatch(r"\d{5}", cp):
        raise FichaValueError(MSG_CP)
    return cp


# ── estatura, peso ───────────────────────────────────────────────────────
def normalize_measure(value: str, *, low: float, high: float, message: str) -> str:
    """A number in [low, high] as text ('120', '120.5'); blank stays blank."""
    text = str(value or "").strip().replace(",", ".")
    if not text:
        return ""
    try:
        number = float(text)
    except ValueError:
        raise FichaValueError(message) from None
    if not (low <= number <= high):
        raise FichaValueError(message)
    return f"{number:g}"


MSG_HEIGHT = "Escriba la estatura en centímetros, por ejemplo 120."
MSG_WEIGHT = "Escriba el peso en kilogramos, por ejemplo 25."


def normalize_height_cm(value: str) -> str:
    return normalize_measure(value, low=30, high=230, message=MSG_HEIGHT)


def normalize_weight_kg(value: str) -> str:
    return normalize_measure(value, low=2, high=250, message=MSG_WEIGHT)
