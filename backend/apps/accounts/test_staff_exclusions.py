"""A4 (2026-11-18): staff cafetería accounts stay out of student-only logic.

A staff wallet is a ``StudentProfile`` with ``tipo='personal'``. It shares the
money flows with pupils but is never counted, listed, promoted, grouped into
a family, given a guardian or sent a family comunicado as a pupil. Invented
names only.
"""
from decimal import Decimal

import pytest
from django.urls import reverse

from apps.accounts.factories import (
    AdminFactory,
    ParentFactory,
    StudentProfileFactory,
    StudentUserFactory,
    UserFactory,
)
from apps.accounts.families import FamilyError, plan_link
from apps.accounts.family import family_alert_logins, family_notify_recipients
from apps.accounts.family_self import find_child
from apps.accounts.family_suggestions import candidates_qs
from apps.accounts.models import StudentProfile, User
from apps.accounts.recipients import delivery_users
from apps.cafeteria.models import CafeteriaBalance
from apps.cafeteria.services import link_students_to_loyverse, sync_health
from apps.portal.models import Announcement
from apps.portal.services import audience_users
from apps.portal.views import audiences_for_user

pytestmark = pytest.mark.django_db


def staff(email=None, **kw):
    user = kw.pop('user', None) or StudentUserFactory(**({'email': email} if email else {}))
    kw = {'grade': '', 'group': '', 'puesto': 'docente', **kw}
    return StudentProfileFactory(user=user, tipo='personal', **kw)


@pytest.fixture
def admin_api(api_client):
    api_client.force_authenticate(user=AdminFactory())
    return api_client


class TestNotices:
    def test_staff_notices_reach_the_person_only(self):
        s = staff()
        guardian = ParentFactory()
        s.parents.add(s.user, guardian)
        assert family_notify_recipients(s) == [s.user]
        assert delivery_users(s.user) == [s.user]
        assert family_alert_logins(s) == []

    def test_console_owner_gets_its_own_notices(self):
        admin = AdminFactory()
        s = staff(user=admin)
        assert family_notify_recipients(s) == [admin]

    def test_pupil_rule_unchanged(self):
        pupil = StudentProfileFactory()
        guardian = ParentFactory()
        pupil.parents.add(pupil.user, guardian)
        assert family_notify_recipients(pupil) == [guardian, pupil.user]


class TestAudiences:
    def test_staff_login_moves_from_family_audiences_to_personal(self):
        s = staff()
        pupil = StudentProfileFactory()
        parent = ParentFactory()
        teacher = UserFactory(role=User.Role.STAFF)
        for aud in (Announcement.Audience.PARENTS, Announcement.Audience.STUDENTS):
            ids = set(audience_users(aud).values_list('pk', flat=True))
            assert s.user_id not in ids and {pupil.user_id, parent.pk} <= ids
        staff_ids = set(audience_users(Announcement.Audience.STAFF).values_list('pk', flat=True))
        assert staff_ids == {s.user_id, teacher.pk}
        assert s.user_id in set(audience_users(Announcement.Audience.ALL).values_list('pk', flat=True))
        assert audiences_for_user(s.user) == [Announcement.Audience.ALL, Announcement.Audience.STAFF]

    def test_parent_who_is_staff_gets_both(self):
        parent = ParentFactory()
        staff(user=parent)
        assert parent.pk in set(audience_users(Announcement.Audience.PARENTS).values_list('pk', flat=True))
        assert parent.pk in set(audience_users(Announcement.Audience.STAFF).values_list('pk', flat=True))
        assert Announcement.Audience.STAFF in audiences_for_user(parent)

    def test_recipient_count_matches(self, admin_api):
        staff()
        ParentFactory()
        url = reverse('admin-announcement-recipient-count')
        assert admin_api.get(url, {'audience': 'parents'}).data['count'] == 1
        assert admin_api.get(url, {'audience': 'staff'}).data['count'] == 1


class TestRoster:
    def test_alumnos_list_hides_staff_and_personal_tab_shows_them(self, admin_api):
        pupil = StudentProfileFactory()
        s = staff()
        url = reverse('students')
        ids = lambda **p: {r['id'] for r in admin_api.get(url, p).data['results']}  # noqa: E731
        assert ids() == {pupil.pk}
        assert ids(tipo='personal') == {s.pk}
        assert ids(tipo='todos') == {pupil.pk, s.pk}

    def test_link_pass_never_flags_staff_as_leavers(self):
        s = staff(student_id='rdemo', loyverse_id='', email='rdemo@interlaken.com.mx')
        gone = staff(student_id='xdemo', loyverse_id='')
        report = link_students_to_loyverse(
            [{'id': 'u-1', 'customer_code': 'rdemo', 'email': 'rdemo@interlaken.com.mx',
              'name': 'ZP-Rosa Demo'}], commit=True)
        assert report['possible_leavers'] == [] and report['unmatched_students'] == []
        assert report['unmatched_staff'] == 1
        s.refresh_from_db()
        gone.refresh_from_db()
        assert s.loyverse_id == 'u-1' and gone.loyverse_id == ''

    def test_family_suggestions_skip_staff(self):
        s = staff()
        assert s.pk not in set(candidates_qs().values_list('pk', flat=True))


class TestFamilies:
    def test_staff_never_joins_a_family(self):
        a, b = StudentProfileFactory(), staff()
        with pytest.raises(FamilyError):
            plan_link([a.pk, b.pk])

    def test_family_self_service_cannot_find_staff(self):
        s = staff(student_id='rdemo', email='rdemo@interlaken.com.mx')
        assert find_child('rdemo') is None and find_child('rdemo@interlaken.com.mx') is None
        assert find_child(StudentProfileFactory(student_id='55509').student_id) is not None
        assert s.pk

    def test_no_guardian_for_staff(self, admin_api):
        s = staff()
        resp = admin_api.post(reverse('student-guardians', args=[s.pk]),
                              {'email': 'tutor.demo@test.mx'}, format='json')
        assert resp.status_code == 400
        assert not User.objects.filter(email='tutor.demo@test.mx').exists()


class TestSchoolYear:
    def test_rollover_skips_staff(self, admin_api):
        s = staff()
        CafeteriaBalance.objects.create(student=s, low_balance_threshold=Decimal('100'))
        pupil = StudentProfileFactory(grade='3° Secundaria')
        CafeteriaBalance.objects.create(student=pupil)
        preview = admin_api.get(reverse('school-year-preview')).data
        assert preview['active_total'] == 1 and preview['graduates'] == 1
        resp = admin_api.post(reverse('school-year-run'), {
            'confirm': 'AVANZAR', 'new_cycle': '2027-2028', 'reset_threshold': 30,
            'promote_grades': True}, format='json')
        assert resp.data['graduated'] == 1 and resp.data['thresholds_reset'] == 1
        s.refresh_from_db()
        assert s.status == 'active' and s.cafeteria_balance.low_balance_threshold == Decimal('100')


class TestCounts:
    def test_bulk_topup_by_group_skips_staff(self, admin_api):
        StudentProfileFactory(grade='1° Primaria', group='A')
        staff(group='A')
        resp = admin_api.post(reverse('admin-bulk-topup'), {
            'amount': 10, 'reason': 'Beca demo', 'group': '', 'grade': '1° Primaria',
            'preview': True}, format='json')
        assert resp.status_code == 200, resp.data
        assert resp.data.get('count', resp.data.get('students')) in (1, [1]) or \
            len(resp.data.get('students', [])) == 1

    def test_sync_health_counts_apart(self):
        StudentProfileFactory()
        staff()
        data = sync_health()
        assert (data['active_students'], data['active_staff']) == (1, 1)

    def test_csv_import_refuses_a_staff_code(self):
        from apps.accounts.import_students import StudentImport
        from apps.core.importing import ImportRow

        staff(student_id='rdemo')
        row = ImportRow(line=2)
        StudentImport().validate_row({'matricula': 'rdemo', 'nombre': 'R', 'apellidos': 'D',
                                      'grado': '1° Primaria'}, row)
        assert row.action == 'error'

    def test_analytics_adoption_counts_pupils(self):
        from apps.portal.analytics import build_payload

        StudentProfileFactory()
        staff()
        assert build_payload()['cafeteria']['adoption']['active_students'] == 1


def test_profile_str():
    assert 'Personal (Docente)' in str(staff())
    assert StudentProfile.Tipo.PERSONAL == 'personal'
