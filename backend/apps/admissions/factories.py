"""
Synthetic test data for the ficha de inscripción (the repo is public: no real
person's data, ever). ``make_curp`` builds a CURP with a valid check digit for
any invented initials, birth date and sex.
"""

from __future__ import annotations

from datetime import date

from .cycles import cycle_start_year, running_cycle
from .validators import curp_check_digit


def make_curp(
    dob: date, sex: str = "M", *, initials: str = "XAXX", state: str = "DF", consonants: str = "RRN"
) -> str:
    """A well-formed CURP for invented data. ``sex``: 'H', 'M' or 'X'."""
    century = "A" if dob.year >= 2000 else "0"
    body = f"{initials}{dob:%y%m%d}{sex}{state}{consonants}{century}"
    return body + str(curp_check_digit(body))


def child_dob_for(grade_number: int = 1, *, base_age: int = 5) -> date:
    """A birth date that fits «N° Primaria» in the running cycle (31-Dec rule)."""
    return date(cycle_start_year() - (base_age + grade_number), 5, 1)


CHILD_DOB = child_dob_for(1)  # 1° Primaria
MOTHER_DOB = date(1988, 3, 15)
FATHER_DOB = date(1986, 11, 2)
CHILD_CURP = make_curp(CHILD_DOB, "M", initials="LOHA")
MOTHER_CURP = make_curp(MOTHER_DOB, "M", initials="HEGM")
FATHER_CURP = make_curp(FATHER_DOB, "H", initials="LOPJ", state="MC")


def start_payload(**over) -> dict:
    data = {
        "contact_name": "Marta Hernández Gil",
        "contact_email": "marta.ficha@ejemplo.test",
        "contact_phone": "55 1111 2222",
        "contact_relationship": "Madre",
        "child_given_names": "Ana Sofía",
        "child_paternal_surname": "López",
        "child_maternal_surname": "Hernández",
        "grade_applying": "1° Primaria",
        "cycle": "actual",
        "referral_source": "redes",
        "wants_visit": True,
        "message": "Nos interesa conocer el colegio.",
    }
    data.update(over)
    return data


def alumno_data(**over) -> dict:
    data = {
        "child_paternal_surname": "López",
        "child_maternal_surname": "Hernández",
        "child_given_names": "Ana Sofía",
        "grade_applying": "1° Primaria",
        "cycle": running_cycle(),
        "previous_school": "",
        "child_sex": "femenino",
        "child_dob": CHILD_DOB.isoformat(),
        "child_birth_country": "México",
        "child_birth_state": "Ciudad de México",
        "child_curp": CHILD_CURP,
    }
    data.update(over)
    return data


def domicilio_data(**over) -> dict:
    data = {
        "address_street": "Calle Ficticia",
        "address_ext_number": "12",
        "address_int_number": "",
        "address_between_streets": "Norte y Sur",
        "address_state": "Estado de México",
        "address_municipality": "Tlalnepantla",
        "address_neighborhood": "Colonia Inventada",
        "address_postal_code": "54000",
        "home_phone": "5533334444",
    }
    data.update(over)
    return data


def salud_data(**over) -> dict:
    data = {
        "blood_type": "O+",
        "estatura": "118",
        "peso": "22",
        "has_allergies": "si",
        "allergies": "Polen",
        "chronic_conditions": "Ninguna",
        "medical_notes": "",
        "consent_medical_data": True,
    }
    data.update(over)
    return data


def madre_data(**over) -> dict:
    data = {
        "not_applicable": False,
        "is_legal_guardian": True,
        "paternal_surname": "Hernández",
        "maternal_surname": "Gil",
        "given_names": "Marta",
        "sex": "femenino",
        "dob": MOTHER_DOB.isoformat(),
        "birth_country": "México",
        "birth_state": "Puebla",
        "curp": MOTHER_CURP,
        "marital_status": "casado",
        "education_level": "licenciatura",
        "occupation": "independiente",
        "occupation_other": "",
        "mobile": "5511112222",
        "office_phone": "",
        "office_ext": "",
        "email": "marta.ficha@ejemplo.test",
    }
    data.update(over)
    return data


def padre_data(**over) -> dict:
    data = {
        "not_applicable": False,
        "is_legal_guardian": True,
        "paternal_surname": "López",
        "maternal_surname": "Pérez",
        "given_names": "Julio",
        "sex": "masculino",
        "dob": FATHER_DOB.isoformat(),
        "birth_country": "México",
        "birth_state": "Estado de México",
        "curp": FATHER_CURP,
        "marital_status": "casado",
        "education_level": "maestria",
        "occupation": "otro",
        "occupation_other": "Músico",
        "mobile": "5544445555",
        "office_phone": "5566667777",
        "office_ext": "123",
        "email": "julio.ficha@ejemplo.test",
    }
    data.update(over)
    return data


def emergencia_data(**over) -> dict:
    data = {
        "emergency_surnames": "Gil Ramos",
        "emergency_given_names": "Rosa",
        "emergency_rel": "Abuela",
        "emergency_phone": "",
        "emergency_mobile": "5577778888",
    }
    data.update(over)
    return data


SECTION_DATA = {
    "alumno": alumno_data,
    "domicilio": domicilio_data,
    "salud": salud_data,
    "padre": padre_data,
    "madre": madre_data,
    "emergencia": emergencia_data,
}
