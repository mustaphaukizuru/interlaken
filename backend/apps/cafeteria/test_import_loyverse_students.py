"""
Import the student roster directly from Loyverse: only real students are created
(numeric matrícula + ci@interlaken email — staff/test skipped), grades decode from
the Loyverse address code, Mexican names split apellidos-first, students are linked
(loyverse_id), and opening balances seed once. Idempotent, dry-run by default.
"""
from decimal import Decimal

import pytest

from apps.accounts.models import StudentProfile, User
from apps.cafeteria.models import CafeteriaBalance
from apps.cafeteria.services import (_is_loyverse_student, _parse_grade_code,
                                     _split_loyverse_name,
                                     import_students_from_loyverse)


def _cust(code, name, email, addr='', pts=0, cid=None):
    return {'id': cid or f'uuid-{code}', 'customer_code': code, 'name': name,
            'email': email, 'address': addr, 'total_points': pts}


STUDENT = _cust('10184', 'Correa Cervantes Maximiliano', 'ci10184@interlaken.com.mx', '6APRI', 160)
STAFF = _cust('177', 'ZP-Jessica Soto', 'jsoto@interlaken.com.mx', '', 0)
TEST = _cust('987654', 'Prueba Prueba', 'ren@hotmail.com', '', 0)


class TestHelpers:
    def test_grade_decode(self):
        assert _parse_grade_code('6APRI') == ('6° Primaria', 'A')
        assert _parse_grade_code('3BSEC') == ('3° Secundaria', 'B')
        assert _parse_grade_code('1ASEC') == ('1° Secundaria', 'A')
        assert _parse_grade_code('') == ('', '')
        assert _parse_grade_code('garbage') == ('', '')

    def test_name_split_apellidos_first(self):
        assert _split_loyverse_name('Alvarado Felix Alejandro') == ('Alejandro', 'Alvarado Felix')
        assert _split_loyverse_name('Correa Cervantes Maximiliano') == ('Maximiliano', 'Correa Cervantes')
        assert _split_loyverse_name('Lopez Aguila Pia Renata') == ('Pia Renata', 'Lopez Aguila')

    def test_student_filter_excludes_staff_and_test(self):
        assert _is_loyverse_student(STUDENT) is True
        assert _is_loyverse_student(STAFF) is False
        assert _is_loyverse_student(TEST) is False


@pytest.mark.django_db
class TestImport:
    def test_dry_run_creates_nothing(self):
        r = import_students_from_loyverse([STUDENT, STAFF, TEST])
        assert r['candidates'] == 1 and r['skipped_non_student'] == 2
        assert r['created'] == 1 and r['commit'] is False
        assert StudentProfile.objects.count() == 0

    def test_commit_creates_student_linked_and_seeded(self):
        r = import_students_from_loyverse([STUDENT, STAFF, TEST], commit=True)
        assert r['created'] == 1
        p = StudentProfile.objects.get(student_id='10184')
        assert p.user.first_name == 'Maximiliano'
        assert p.user.last_name == 'Correa Cervantes'
        assert p.grade == '6° Primaria' and p.group == 'A'
        assert p.loyverse_id == 'uuid-10184'
        assert p.user.role == User.Role.STUDENT
        # Student email == parent email, so the account is its own guardian
        # (purchase notifications fan out over student.parents).
        assert p.user in p.parents.all()
        cb = CafeteriaBalance.objects.get(student=p)
        assert cb.balance == Decimal('160') and cb.last_synced is not None
        assert r['balance_seeded'] == Decimal('160')

    def test_idempotent_update_by_matricula(self):
        import_students_from_loyverse([STUDENT], commit=True)
        moved = _cust('10184', 'Correa Cervantes Maximiliano',
                      'ci10184@interlaken.com.mx', '6BPRI', 160)   # changed group
        r = import_students_from_loyverse([moved], commit=True)
        assert r['created'] == 0 and r['updated'] == 1
        assert StudentProfile.objects.filter(student_id='10184').count() == 1
        assert StudentProfile.objects.get(student_id='10184').group == 'B'

    def test_seed_is_once_never_reapplied(self):
        import_students_from_loyverse([STUDENT], commit=True)
        p = StudentProfile.objects.get(student_id='10184')
        cb = CafeteriaBalance.objects.get(student=p)
        cb.balance = Decimal('999')          # simulate a top-up after seeding
        cb.save(update_fields=['balance'])
        again = _cust('10184', 'Correa Cervantes Maximiliano',
                      'ci10184@interlaken.com.mx', '6APRI', 50)
        r = import_students_from_loyverse([again], commit=True)
        assert CafeteriaBalance.objects.get(student=p).balance == Decimal('999')
        assert r['balance_seeded'] == Decimal('0')
