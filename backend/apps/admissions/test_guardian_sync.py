"""The ficha's parent blocks keep the legacy parent1_* / parent2_* fields right
(admissions.guardians.sync_legacy_parents), and the 0012 backfill builds those
blocks for records created before the ficha. Synthetic names only."""

import importlib

import pytest
from django.apps import apps as django_apps

from apps.admissions.guardians import legacy_parent_values, split_full_name, sync_legacy_parents
from apps.admissions.models import PreRegistration, Registration, RegistrationGuardian

pytestmark = pytest.mark.django_db


def _reg(**over):
    data = dict(
        child_first_name="Ana",
        child_last_name="López Hernández",
        child_dob="2019-05-01",
        level="primaria",
        grade_applying="1° Primaria",
        contact_name="Marta Hernández Gil",
        contact_email="Marta.Ficha@Ejemplo.test",
        contact_phone="5511112222",
        contact_relationship="Madre",
        parent1_name="x",
        parent1_email="x@ejemplo.test",
        parent1_phone="0",
    )
    data.update(over)
    return Registration.objects.create(**data)


def _guardian(reg, role, **over):
    data = dict(
        given_names="Nombre",
        paternal_surname="Apellido",
        mobile="5500000000",
        email=f"{role}@ejemplo.test",
    )
    data.update(over)
    return RegistrationGuardian.objects.create(registration=reg, role=role, **data)


def test_contact_matching_a_block_is_parent1_and_the_other_parent2():
    reg = _reg()
    _guardian(
        reg,
        "madre",
        given_names="Marta",
        paternal_surname="Hernández",
        maternal_surname="Gil",
        email="marta.ficha@ejemplo.test",
        mobile="5599990000",
        occupation="ama_de_casa",
    )
    _guardian(
        reg,
        "padre",
        given_names="Julio",
        paternal_surname="López",
        email="julio.ficha@ejemplo.test",
        mobile="5544445555",
    )
    changed = sync_legacy_parents(reg)
    reg.refresh_from_db()
    assert reg.parent1_name == "Marta Hernández Gil"
    assert reg.parent1_email == "Marta.Ficha@Ejemplo.test"
    assert reg.parent1_phone == "5599990000"  # the block's mobile wins
    assert reg.parent1_occupation == "Ama de casa"
    assert (reg.parent2_name, reg.parent2_email, reg.parent2_phone) == (
        "Julio López",
        "julio.ficha@ejemplo.test",
        "5544445555",
    )
    assert "parent2_email" in changed
    assert sync_legacy_parents(reg) == []  # idempotent


def test_contact_who_is_not_a_parent_keeps_parent1_and_padre_is_parent2():
    reg = _reg(
        contact_name="Rosa Gil Ramos",
        contact_email="rosa@ejemplo.test",
        contact_relationship="Abuelo/a",
    )
    _guardian(reg, "madre", email="madre@ejemplo.test")
    _guardian(reg, "padre", email="padre@ejemplo.test")
    sync_legacy_parents(reg)
    reg.refresh_from_db()
    assert (reg.parent1_name, reg.parent1_email, reg.parent1_phone) == (
        "Rosa Gil Ramos",
        "rosa@ejemplo.test",
        "5511112222",
    )
    assert reg.parent1_occupation == ""
    assert reg.parent2_email == "padre@ejemplo.test"  # Excel order: padre first


def test_legal_guardian_goes_first_for_parent2():
    reg = _reg(contact_email="rosa@ejemplo.test", contact_relationship="Abuelo/a")
    _guardian(reg, "padre", email="padre@ejemplo.test")
    _guardian(reg, "madre", email="madre@ejemplo.test", is_legal_guardian=True)
    sync_legacy_parents(reg)
    assert reg.parent2_email == "madre@ejemplo.test"


def test_no_aplica_block_is_never_parent2():
    reg = _reg()
    _guardian(reg, "madre", email="marta.ficha@ejemplo.test")
    _guardian(reg, "padre", not_applicable=True, given_names="", paternal_surname="", email="")
    sync_legacy_parents(reg)
    assert (reg.parent2_name, reg.parent2_email, reg.parent2_phone) == ("", "", "")


def test_shared_email_or_no_email_gives_no_parent2():
    reg = _reg()
    _guardian(reg, "madre", email="marta.ficha@ejemplo.test")
    padre = _guardian(reg, "padre", email="MARTA.ficha@ejemplo.test")
    sync_legacy_parents(reg)
    assert reg.parent2_email == ""
    padre.email = ""
    padre.save()
    sync_legacy_parents(reg)
    assert reg.parent2_email == ""


def test_contact_parent_with_another_email_in_her_block_is_not_parent2():
    """Contact says «Madre» but typed a work email in the madre block: that block
    is the same person, so parent2 is the father."""
    reg = _reg()
    _guardian(reg, "madre", email="marta.trabajo@ejemplo.test")
    _guardian(reg, "padre", email="julio.ficha@ejemplo.test")
    sync_legacy_parents(reg)
    assert reg.parent1_email == "Marta.Ficha@Ejemplo.test"
    assert reg.parent2_email == "julio.ficha@ejemplo.test"


def test_old_wizard_record_without_blocks_keeps_parent2_and_occupation():
    reg = _reg(
        contact_name="",
        contact_email="",
        contact_phone="",
        contact_relationship="",
        parent1_name="Lía Ruiz",
        parent1_email="lia@ejemplo.test",
        parent1_phone="5512121212",
        parent1_occupation="Arquitecta",
        parent2_name="Iván Mora",
        parent2_email="ivan@ejemplo.test",
        parent2_phone="5534343434",
    )
    assert sync_legacy_parents(reg) == []
    reg.refresh_from_db()
    assert reg.parent1_occupation == "Arquitecta"
    assert reg.parent2_email == "ivan@ejemplo.test"


def test_occupation_otro_uses_the_typed_text():
    reg = _reg()
    _guardian(
        reg,
        "madre",
        email="marta.ficha@ejemplo.test",
        occupation="otro",
        occupation_other="Veterinaria",
    )
    sync_legacy_parents(reg)
    assert reg.parent1_occupation == "Veterinaria"


def test_pure_values_on_an_unsaved_registration():
    reg = Registration(
        contact_name="Eva Ruiz", contact_email="eva@ejemplo.test", contact_phone="5512345678"
    )
    values = legacy_parent_values(reg, [])
    assert values["parent1_name"] == "Eva Ruiz" and values["parent1_email"] == "eva@ejemplo.test"
    assert sync_legacy_parents(reg, [], save=False) and reg.pk is None


@pytest.mark.parametrize(
    "name,expected",
    [
        ("", ("", "", "")),
        ("Ana", ("Ana", "", "")),
        ("Ana López", ("Ana", "López", "")),
        ("Ana López Hernández", ("Ana", "López", "Hernández")),
        ("Ana Sofía López Hernández", ("Ana Sofía", "López", "Hernández")),
    ],
)
def test_split_full_name(name, expected):
    assert split_full_name(name) == expected


class TestBackfillMigration:
    """0012_ficha_backfill on records shaped like the ones created before the ficha."""

    def _migration(self):
        return importlib.import_module("apps.admissions.migrations.0012_ficha_backfill")

    def test_forwards_builds_blocks_contact_and_name_parts(self):
        pre = PreRegistration.objects.create(
            child_first_name="Ana",
            child_last_name="López Hernández",
            child_dob="2019-05-01",
            level="primaria",
            grade_applying="1° Primaria",
            parent_name="Marta Hernández Gil",
            parent_email="marta@ejemplo.test",
            parent_phone="5511112222",
            relationship="Madre",
        )
        reg = Registration.objects.create(
            pre_registration=pre,
            child_first_name="Ana",
            child_last_name="López Hernández",
            child_dob="2019-05-01",
            level="primaria",
            grade_applying="1° Primaria",
            parent1_name="Marta Hernández Gil",
            parent1_email="marta@ejemplo.test",
            parent1_phone="5511112222",
            parent1_occupation="Diseñadora",
            parent2_name="Julio López",
            parent2_email="julio@ejemplo.test",
            parent2_phone="5544445555",
            emergency_name="Rosa Gil Ramos",
        )
        lone = Registration.objects.create(
            child_first_name="Leo",
            child_last_name="Mora",
            child_dob="2018-01-01",
            level="primaria",
            grade_applying="2° Primaria",
            parent1_name="Iván Mora",
            parent1_email="ivan@ejemplo.test",
            parent1_phone="5534343434",
        )

        self._migration().forwards(django_apps, None)

        reg.refresh_from_db()
        assert (reg.child_given_names, reg.child_paternal_surname, reg.child_maternal_surname) == (
            "Ana",
            "López",
            "Hernández",
        )
        assert (reg.contact_name, reg.contact_email, reg.contact_relationship) == (
            "Marta Hernández Gil",
            "marta@ejemplo.test",
            "Madre",
        )
        assert (reg.emergency_given_names, reg.emergency_surnames) == ("Rosa", "Gil Ramos")
        assert reg.ficha_version == Registration.FichaVersion.LEGACY
        blocks = {g.role: g for g in reg.guardians.all()}
        # The pre-registro said «Madre»: parent 1 goes to the madre block.
        assert (
            blocks["madre"].given_names,
            blocks["madre"].paternal_surname,
            blocks["madre"].maternal_surname,
        ) == ("Marta", "Hernández", "Gil")
        assert (
            blocks["madre"].occupation == "otro"
            and blocks["madre"].occupation_other == "Diseñadora"
        )
        assert blocks["padre"].email == "julio@ejemplo.test" and blocks["padre"].sex == ""
        # No hint: parent 1 → padre (Excel order); no parent 2 → one block only.
        assert list(lone.guardians.values_list("role", flat=True)) == ["padre"]

        # Re-running creates nothing twice; the sync keeps the same legacy fields.
        self._migration().forwards(django_apps, None)
        assert reg.guardians.count() == 2
        before = (reg.parent1_email, reg.parent2_email)
        sync_legacy_parents(reg)
        assert (reg.parent1_email, reg.parent2_email) == before

    def test_backwards_removes_blocks_and_fills_missing_birth_dates(self):
        reg = Registration.objects.create(
            child_first_name="Ana",
            child_last_name="López",
            child_dob=None,
            level="primaria",
            grade_applying="1° Primaria",
            parent1_name="M",
            parent1_email="m@ejemplo.test",
            parent1_phone="1",
        )
        _guardian(reg, "madre")
        self._migration().backwards(django_apps, None)
        reg.refresh_from_db()
        assert reg.guardians.count() == 0
        assert reg.child_dob.year == 1900
