"""CURP, phone, postal-code and entidad rules of the ficha (admissions.validators).

Every CURP here is synthetic: invented initials, built by ``make_curp`` with the
official check digit. No real person's data.
"""

from datetime import date

import pytest

from apps.admissions import validators as v
from apps.admissions.factories import make_curp


class TestCurpCheckDigit:
    def test_generated_curp_is_valid_and_normalized(self):
        curp = make_curp(date(2019, 5, 1), "M", initials="LOHA")
        assert len(curp) == 18
        messy = f"  {curp[:6].lower()} {curp[6:12]}-{curp[12:]} "
        assert v.normalize_curp(messy) == curp

    @pytest.mark.parametrize("position", range(17))
    def test_changing_any_character_breaks_the_check_digit_or_format(self, position):
        curp = make_curp(date(2019, 5, 1), "M", initials="LOHA")
        replacement = "1" if curp[position].isalpha() else "Z"
        if curp[position] == replacement:
            replacement = "2"
        tampered = curp[:position] + replacement + curp[position + 1 :]
        with pytest.raises(v.FichaValueError):
            v.normalize_curp(tampered)

    def test_wrong_check_digit_message(self):
        curp = make_curp(date(2019, 5, 1), "M", initials="LOHA")
        wrong = curp[:17] + str((int(curp[17]) + 1) % 10)
        with pytest.raises(v.FichaValueError, match="último dígito"):
            v.normalize_curp(wrong)

    def test_algorithm_weights_and_alphabet(self):
        # 17 zeros sum to 0 → (10 - 0) % 10 = 0; one 'A' (value 10) at weight 18
        # sums 180 → 0 as well; 'B' (11) at weight 18 → 198 → 2.
        assert v.curp_check_digit("0" * 17) == 0
        assert v.curp_check_digit("A" + "0" * 16) == 0
        assert v.curp_check_digit("B" + "0" * 16) == 2
        # Ñ sits between N and O in the official alphabet.
        assert v.CURP_ALPHABET.index("Ñ") == v.CURP_ALPHABET.index("N") + 1


class TestCurpFormat:
    def test_length(self):
        with pytest.raises(v.FichaValueError, match="18 caracteres"):
            v.normalize_curp("ABC123")

    def test_unknown_state_code(self):
        good = make_curp(date(2019, 5, 1), "M", initials="LOHA")
        bad_state = good[:11] + "ZZ" + good[13:]
        with pytest.raises(v.FichaValueError, match="formato oficial"):
            v.normalize_curp(bad_state)

    def test_impossible_date(self):
        # 30 February matches the pattern (day 01-31) but is no date.
        body = "LOHA190230MDFRRNA"
        curp = body + str(v.curp_check_digit(body))
        with pytest.raises(v.FichaValueError, match="fecha de nacimiento"):
            v.normalize_curp(curp)

    def test_blank_stays_blank(self):
        assert v.normalize_curp("   ") == ""

    def test_born_abroad_code_ne_is_accepted(self):
        curp = make_curp(date(2018, 2, 14), "H", initials="SAPE", state="NE")
        assert v.normalize_curp(curp) == curp


class TestCurpContents:
    def test_century_from_position_17(self):
        assert v.curp_birth_date(make_curp(date(1988, 3, 15), "M", initials="HEGM")) == date(
            1988, 3, 15
        )
        assert v.curp_birth_date(make_curp(date(2015, 7, 9), "H", initials="LOPJ")) == date(
            2015, 7, 9
        )

    def test_sex(self):
        assert v.curp_sex(make_curp(date(2015, 7, 9), "H")) == "masculino"
        assert v.curp_sex(make_curp(date(2015, 7, 9), "M")) == "femenino"
        assert v.curp_sex(make_curp(date(2015, 7, 9), "X")) is None

    def test_x_sex_is_valid(self):
        curp = make_curp(date(2015, 7, 9), "X")
        assert v.normalize_curp(curp) == curp
        assert v.curp_agreement_errors(curp, date(2015, 7, 9), "femenino") == []

    def test_agreement(self):
        curp = make_curp(date(2015, 7, 9), "H")
        assert v.curp_agreement_errors(curp, date(2015, 7, 9), "masculino") == []
        errors = v.curp_agreement_errors(curp, date(2015, 7, 10), "femenino")
        assert len(errors) == 2
        assert "09/07/2015" in errors[0]
        assert "sexo" in errors[1]


class TestPhonesAndPostalCode:
    @pytest.mark.parametrize(
        "raw",
        [
            "5512345678",
            "55 1234 5678",
            "55-1234-5678",
            "(55) 1234.5678",
            "+52 55 1234 5678",
            "525512345678",
            "+52 1 55 1234 5678",
            "52 1 5512345678",
        ],
    )
    def test_phone_normalizes_to_ten_digits(self, raw):
        assert v.normalize_phone(raw) == "5512345678"

    @pytest.mark.parametrize(
        "raw", ["12345", "551234567", "55123456789", "cinco", "+1 555 123 4567"]
    )
    def test_phone_rejects(self, raw):
        with pytest.raises(v.FichaValueError, match="10 dígitos"):
            v.normalize_phone(raw)

    def test_postal_code(self):
        assert v.normalize_postal_code(" 01234 ") == "01234"
        with pytest.raises(v.FichaValueError, match="5 dígitos"):
            v.normalize_postal_code("1234")

    def test_extension(self):
        assert v.normalize_extension("123") == "123"
        with pytest.raises(v.FichaValueError):
            v.normalize_extension("12a")


class TestEntidades:
    def test_thirty_two_states(self):
        assert len(v.ESTADOS) == 32 == len(set(v.ESTADOS))
        assert "Ciudad de México" in v.ESTADOS and "Estado de México" in v.ESTADOS

    @pytest.mark.parametrize(
        "raw,expected",
        [
            ("cdmx", "Ciudad de México"),
            ("ciudad de mexico", "Ciudad de México"),
            ("Edomex", "Estado de México"),
            ("nuevo leon", "Nuevo León"),
            ("YUCATAN", "Yucatán"),
        ],
    )
    def test_state_aliases(self, raw, expected):
        assert v.normalize_state(raw) == expected

    def test_unknown_state(self):
        assert v.normalize_state("Texas") is None

    def test_country(self):
        assert v.normalize_country("mexico") == "México"
        assert v.normalize_country(" República  Mexicana ") == "México"
        assert v.normalize_country("España") == "España"
        assert v.is_mexico("MX") and not v.is_mexico("Canadá")


class TestMeasures:
    def test_height_and_weight(self):
        assert v.normalize_height_cm("118") == "118"
        assert v.normalize_height_cm("118,5") == "118.5"
        assert v.normalize_weight_kg("22.0") == "22"
        with pytest.raises(v.FichaValueError, match="centímetros"):
            v.normalize_height_cm("1.20")
        with pytest.raises(v.FichaValueError, match="kilogramos"):
            v.normalize_weight_kg("mucho")
