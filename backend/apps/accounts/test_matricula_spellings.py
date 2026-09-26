"""``ci09932`` and ``09932`` are one student everywhere (decision C3.1).

The office writes the matrícula the Loyverse way (``ci`` prefix, added after
Loyverse's bulk import dropped leading zeros and the barcode stopped scanning);
the app keys on the digits. The roster search, the CSV importer and the
serializer must agree, and the console shows the Loyverse spelling under
"Código Loyverse" while "Matrícula" stays canonical.
"""
import io

import pytest
from django.urls import reverse

from apps.accounts.factories import AdminFactory, StudentProfileFactory
from apps.accounts.models import StudentProfile
from apps.cafeteria.models import LoyverseProfile
from apps.core.matricula import is_ci_code, normalize_matricula, search_key

pytestmark = pytest.mark.django_db


def linked(code, loyverse_code):
    s = StudentProfileFactory(student_id=code, loyverse_id=f'uuid-{code}')
    LoyverseProfile.objects.create(student=s, loyverse_id=s.loyverse_id, kind='student',
                                   customer_code=loyverse_code, name='X')
    return s


class TestHelpers:
    def test_normalise_strips_only_the_ci_prefix(self):
        assert normalize_matricula('ci09932') == '09932'
        assert normalize_matricula(' CI09932 ') == '09932'
        assert normalize_matricula('09932') == '09932'
        assert normalize_matricula('cielo') == 'elo'       # by design: prefix only
        assert normalize_matricula(None) == ''

    def test_search_key_only_rewrites_a_full_loyverse_code(self):
        assert is_ci_code('ci09932') and is_ci_code('CI1') and not is_ci_code('ci') \
            and not is_ci_code('cielo') and not is_ci_code('09932')
        assert search_key('ci09932') == '09932'
        assert search_key('Cielo') == 'Cielo'               # a name, untouched
        assert search_key('  09932 ') == '09932'


class TestRosterSearch:
    def test_search_finds_the_student_by_either_spelling(self, api_client):
        juan = StudentProfileFactory(student_id='09932')
        StudentProfileFactory(student_id='09933')
        legacy = StudentProfileFactory(student_id='ci09934')   # a CSV row imported before the fix
        api_client.force_authenticate(AdminFactory())
        url = reverse('students')

        def ids(term):
            return [r['id'] for r in api_client.get(url, {'search': term}).json()['results']]

        assert ids('ci09932') == [juan.id]
        assert ids('09932') == [juan.id]
        assert ids('CI09932') == [juan.id]
        assert ids('09934') == [legacy.id] and ids('ci09934') == [legacy.id]

    def test_search_still_matches_names_that_start_with_ci(self, api_client):
        s = StudentProfileFactory(student_id='09999')
        s.user.first_name = 'Cielo'
        s.user.save(update_fields=['first_name'])
        api_client.force_authenticate(AdminFactory())
        found = api_client.get(reverse('students'), {'search': 'cielo'}).json()['results']
        assert [r['id'] for r in found] == [s.id]


class TestLoyverseCodeField:
    def test_linked_student_shows_the_loyverse_spelling_and_keeps_the_canonical_matricula(
            self, api_client, django_assert_num_queries):
        s = linked('09932', 'ci09932')
        plain = StudentProfileFactory(student_id='09933', loyverse_id='')
        api_client.force_authenticate(AdminFactory())

        with django_assert_num_queries(2):                  # count + rows, profile joined
            rows = {r['id']: r for r in api_client.get(reverse('students')).json()['results']}
        assert rows[s.id]['student_id'] == '09932'
        assert rows[s.id]['loyverse_code'] == 'ci09932'
        assert rows[plain.id]['loyverse_code'] == '09933'

        detail = api_client.get(reverse('student-detail', args=[s.id])).json()
        assert detail['loyverse_code'] == 'ci09932'

    def test_blank_snapshot_code_falls_back_to_the_matricula(self, api_client):
        s = linked('09932', '')
        api_client.force_authenticate(AdminFactory())
        assert api_client.get(reverse('student-detail', args=[s.id])).json()['loyverse_code'] == '09932'


HEADER = 'matricula,nombre,apellidos,grado,grupo\n'


def _csv(*lines):
    f = io.BytesIO((HEADER + '\n'.join(lines)).encode('utf-8-sig'))
    f.name = 'alumnos.csv'
    return f


class TestCsvImporter:
    def test_ci_prefixed_rows_match_the_existing_digits_and_never_duplicate(self, api_client):
        existing = StudentProfileFactory(student_id='09932', grade='3° Primaria')
        api_client.force_authenticate(AdminFactory())

        resp = api_client.post(reverse('import-students'),
                               {'file': _csv('ci09932,Juan,Chavez,4° Primaria,A'), 'dry_run': '0'},
                               format='multipart')

        body = resp.json()
        assert body['counts']['actualizar'] == 1 and body['counts']['crear'] == 0
        assert body['rows'][0]['key'] == '09932'
        assert StudentProfile.objects.filter(student_id__in=['09932', 'ci09932']).count() == 1
        existing.refresh_from_db()
        assert existing.grade == '4° Primaria'

    def test_both_spellings_in_one_file_are_a_duplicate(self, api_client):
        api_client.force_authenticate(AdminFactory())
        resp = api_client.post(reverse('import-students'), {
            'file': _csv('ci09933,Ana,Ruiz,1° Primaria,A', '09933,Ana,Ruiz,1° Primaria,A'),
            'dry_run': '1'}, format='multipart')
        rows = resp.json()['rows']
        assert rows[0]['action'] == 'crear'
        assert rows[1]['action'] == 'error'
        assert rows[1]['errors'] == ['Duplicado de la fila 2.']

    def test_a_new_row_is_stored_and_mailed_with_the_digits(self, api_client):
        api_client.force_authenticate(AdminFactory())
        api_client.post(reverse('import-students'),
                        {'file': _csv('CI09934,Sara,Duran,2° Secundaria,B'), 'dry_run': '0'},
                        format='multipart')
        s = StudentProfile.objects.get(student_id='09934')
        assert s.user.email == '09934@alumnos.interlaken.edu.mx'
