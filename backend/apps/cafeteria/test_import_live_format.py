"""The Loyverse roster as it actually is, not as the first fixtures imagined it.

Verified read-only against the live account on 2026-09-16, all 350 students
share one shape:

    customer_code  ci09938                       (app stores 09938)
    name           Calles Lopez Sebastian-1PRI   (apellidos, nombre, -grade)
    address        1PRI                          (no group letter)

Three parsers each assumed a different shape, and together they made
"Importar desde Loyverse" useless: it accepted nobody, and once that was fixed
it would have created 350 duplicates named "Sebastian-1PRI" with grade N/D.
"""

import pytest

from apps.accounts.factories import StudentProfileFactory
from apps.accounts.models import StudentProfile
from apps.cafeteria.services import (
    _matricula,
    _parse_grade_code,
    _split_loyverse_name,
    _strip_grade_suffix,
    import_students_from_loyverse,
    link_students_to_loyverse,
)

LIVE = {
    'id': 'uuid-09938', 'customer_code': 'ci09938',
    'name': 'Calles Lopez Sebastian-1PRI', 'email': 'ci09938@interlaken.com.mx',
    'address': '1PRI', 'total_points': 49,
}


class TestParsers:
    def test_matricula_strips_the_ci_prefix_to_match_the_app(self):
        assert _matricula('ci09938') == '09938'
        assert _matricula('CI10184') == '10184'
        assert _matricula('10184') == '10184'      # already bare: unchanged
        assert _matricula('') == ''

    def test_grade_code_without_a_group_letter(self):
        assert _parse_grade_code('1PRI') == ('1° Primaria', '')
        assert _parse_grade_code('3SEC') == ('3° Secundaria', '')
        assert _parse_grade_code('6APRI') == ('6° Primaria', 'A')   # old shape still works
        assert _parse_grade_code('') == ('', '')

    def test_grade_suffix_comes_off_the_name_before_the_split(self):
        assert _strip_grade_suffix('Calles Lopez Sebastian-1PRI') == 'Calles Lopez Sebastian'
        assert _strip_grade_suffix('Rodriguez Arredondo Sara Roberta-1SEC') == 'Rodriguez Arredondo Sara Roberta'
        assert _split_loyverse_name('Calles Lopez Sebastian-1PRI') == ('Sebastian', 'Calles Lopez')
        assert _split_loyverse_name('Rodriguez Arredondo Sara Roberta-1SEC') == ('Sara Roberta', 'Rodriguez Arredondo')


@pytest.mark.django_db
class TestImportAgainstTheExistingRoster:
    def test_an_existing_student_is_updated_not_duplicated(self):
        """The 333 linked students hold bare-digit matrículas. Before
        normalising, the dry run reported 'Creados: 350, Actualizados: 0'.

        Grade and link follow Loyverse. The name does NOT on a first pass:
        with no record of what Loyverse said last time, the sync cannot tell a
        rename from a console correction, so it keeps the console's name
        (decision C3.2) and only lists the grade/link changes."""
        existing = StudentProfileFactory(student_id='09938', grade='N/D', group='')
        console_name = (existing.user.first_name, existing.user.last_name)

        report = import_students_from_loyverse([LIVE], commit=True)

        assert report['updated'] == 1 and report['created'] == 0
        assert StudentProfile.objects.filter(student_id='09938').count() == 1
        existing.refresh_from_db()
        assert existing.grade == '1° Primaria'
        assert existing.loyverse_id == 'uuid-09938'
        assert (existing.user.first_name, existing.user.last_name) == console_name
        assert {c['field'] for c in report['changes']} == {'grado', 'codigo', 'vinculo'}

    def test_an_empty_console_name_is_filled_from_loyverse(self):
        """The one first-pass case where Loyverse wins: the app holds no name."""
        existing = StudentProfileFactory(student_id='09938', grade='N/D', group='')
        existing.user.first_name = existing.user.last_name = ''
        existing.user.save(update_fields=['first_name', 'last_name'])

        import_students_from_loyverse([LIVE], commit=True)

        existing.refresh_from_db()
        assert (existing.user.first_name, existing.user.last_name) == ('Sebastian', 'Calles Lopez')

    def test_a_new_student_is_created_with_a_real_name_and_grade(self):
        report = import_students_from_loyverse([LIVE], commit=True)

        assert report['created'] == 1
        s = StudentProfile.objects.get(student_id='09938')
        assert (s.user.first_name, s.user.last_name) == ('Sebastian', 'Calles Lopez')
        assert s.grade == '1° Primaria'
        assert s.loyverse_id == 'uuid-09938'

    def test_dry_run_reports_the_sample_with_the_cleaned_name(self):
        report = import_students_from_loyverse([LIVE], commit=False)
        sample = report['samples'][0]
        assert sample['matricula'] == '09938'
        assert sample['name'] == 'Sebastian Calles Lopez'
        assert sample['grade'] == '1° Primaria'


@pytest.mark.django_db
class TestLinkAgainstTheExistingRoster:
    def test_links_a_bare_digit_matricula_to_a_ci_prefixed_customer(self):
        s = StudentProfileFactory(student_id='09938', loyverse_id='')

        report = link_students_to_loyverse([LIVE], commit=True)

        assert report['linked'] == 1
        s.refresh_from_db()
        assert s.loyverse_id == 'uuid-09938'
        assert report['changes'][0]['matched_by'] == 'código'
