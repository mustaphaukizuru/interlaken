"""Admin console for families (hermanos), 2026-11-13: link, merge, remove, list, export."""
import csv
import io

import pytest
from django.urls import reverse

from apps.accounts.factories import (
    ParentFactory,
    StudentProfileFactory,
    StudentUserFactory,
    UserFactory,
)
from apps.accounts.families import FAMILY_MAX_STUDENTS, link_students
from apps.accounts.models import Family, StudentProfile, User
from apps.core.models import AuditLog
from apps.portal.models import Notification

pytestmark = pytest.mark.django_db

LINK = reverse('admin-families-link')
LIST = reverse('admin-families')


def _kid(first, last='Pérez López', email=None, **kw):
    login = StudentUserFactory(first_name=first, last_name=last, **({'email': email} if email else {}))
    profile = StudentProfileFactory(user=login, **kw)
    profile.parents.add(login)
    return profile


def _family_of(profile):
    profile.refresh_from_db()
    return profile.family


class TestPermissions:
    @pytest.mark.parametrize('url', [LIST, LINK, reverse('admin-family-suggestions')])
    def test_families_and_outsider_staff_are_refused(self, api_client, url):
        for user in (ParentFactory(), UserFactory(role=User.Role.STAFF, staff_areas=['cafeteria'])):
            api_client.force_authenticate(user)
            resp = api_client.get(url) if url != LINK else api_client.post(url, {}, format='json')
            assert resp.status_code == 403

    def test_staff_with_the_alumnos_area_may_link(self, api_client):
        a, b = _kid('Ana'), _kid('Luis')
        api_client.force_authenticate(UserFactory(role=User.Role.STAFF, staff_areas=['alumnos']))
        resp = api_client.post(LINK, {'student_ids': [a.pk, b.pk], 'notify': False}, format='json')
        assert resp.status_code == 200, resp.data
        assert _family_of(a) == _family_of(b) is not None


class TestLink:
    def test_dry_run_changes_nothing_and_explains_the_access(self, admin_client):
        a, b = _kid('Ana'), _kid('Luis')
        resp = admin_client.post(LINK, {'student_ids': [a.pk, b.pk], 'dry_run': True}, format='json')
        assert resp.status_code == 200, resp.data
        body = resp.data
        assert body['dry_run'] is True and body['action'] == 'create'
        assert body['name'] == 'Familia Pérez López'
        assert sorted(s['id'] for s in body['adding']) == sorted([a.pk, b.pk])
        gains = {g['email']: g['gains'] for g in body['new_access']}
        assert gains[a.user.email] == [b.user.full_name]
        assert gains[b.user.email] == [a.user.full_name]
        assert not Family.objects.exists()

    def test_create_audits_and_notifies_after_commit(self, admin_client, django_capture_on_commit_callbacks):
        a, b = _kid('Ana'), _kid('Luis')
        with django_capture_on_commit_callbacks(execute=True):
            resp = admin_client.post(LINK, {'student_ids': [a.pk, b.pk], 'name': 'Familia Pérez'}, format='json')
        assert resp.status_code == 200, resp.data
        fam = _family_of(a)
        assert fam.name == 'Familia Pérez' and _family_of(b) == fam
        assert resp.data['result']['id'] == fam.pk
        assert {s['id'] for s in resp.data['result']['students']} == {a.pk, b.pk}
        # Each sibling's login learns it now sees the other.
        for login in (a.user, b.user):
            notices = Notification.objects.filter(user=login, title='Sus hijos, juntos en el portal')
            assert notices.count() == 1
            # The family's name is the school's internal label: never sent to families.
            assert 'Familia Pérez' not in notices.get().message
        # The family and each student's Historial record the change.
        assert AuditLog.objects.filter(object_type='accounts.family', object_id=str(fam.pk), action='create').exists()
        history = AuditLog.objects.filter(object_type='accounts.studentprofile', object_id=str(a.pk))
        assert any(row.changes.get('family') == [None, 'Familia Pérez'] for row in history)

    def test_notify_false_sends_nothing(self, admin_client, django_capture_on_commit_callbacks):
        a, b = _kid('Ana'), _kid('Luis')
        with django_capture_on_commit_callbacks(execute=True):
            admin_client.post(LINK, {'student_ids': [a.pk, b.pk], 'notify': False}, format='json')
        assert not Notification.objects.exists()

    def test_add_to_an_existing_family(self, admin_client):
        a, b, c = _kid('Ana'), _kid('Luis'), _kid('Sofía')
        fam, _ = link_students([a.pk, b.pk], notify=False)
        resp = admin_client.post(LINK, {'student_ids': [c.pk], 'family': fam.pk, 'notify': False}, format='json')
        assert resp.status_code == 200 and resp.data['action'] == 'add'
        assert _family_of(c) == fam and fam.students.count() == 3

    def test_linking_two_families_merges_them_into_the_bigger(self, admin_client):
        a, b, c, d, e = (_kid(n) for n in ('Ana', 'Luis', 'Sofía', 'Mario', 'Eva'))
        big, _ = link_students([a.pk, b.pk, c.pk], name='Familia Grande', notify=False)
        small, _ = link_students([d.pk, e.pk], name='Familia Chica', notify=False)
        plan = admin_client.post(LINK, {'student_ids': [a.pk, d.pk], 'dry_run': True}, format='json').data
        assert plan['action'] == 'merge'
        assert plan['family']['id'] == big.pk
        assert [m['name'] for m in plan['merging']] == ['Familia Chica']
        resp = admin_client.post(LINK, {'student_ids': [a.pk, d.pk], 'notify': False}, format='json')
        assert resp.status_code == 200
        assert not Family.objects.filter(pk=small.pk).exists()
        assert set(big.students.values_list('pk', flat=True)) == {a.pk, b.pk, c.pk, d.pk, e.pk}

    def test_already_together_is_a_no_op(self, admin_client):
        a, b = _kid('Ana'), _kid('Luis')
        fam, _ = link_students([a.pk, b.pk], notify=False)
        resp = admin_client.post(LINK, {'student_ids': [a.pk, b.pk]}, format='json')
        assert resp.status_code == 200 and resp.data['action'] == 'none'
        assert Family.objects.count() == 1 and _family_of(a) == fam

    @pytest.mark.parametrize('payload, message', [
        ({'student_ids': []}, 'al menos dos'),
        ({'student_ids': ['x']}, 'válidos'),
        ({'student_ids': [999999, 999998]}, 'ya no existe'),
        ({'student_ids': [1], 'family': 999999}, 'familia ya no existe'),
        ({'student_ids': [1], 'family': 'abc'}, 'no es válida'),
        ({'student_ids': [1, 2], 'family': 'abc', 'dry_run': True}, 'no es válida'),
    ])
    def test_bad_requests_explain_themselves(self, admin_client, payload, message):
        _kid('Ana')
        resp = admin_client.post(LINK, payload, format='json')
        assert resp.status_code == 400
        assert message in resp.data['detail']

    def test_one_student_alone_is_not_a_family(self, admin_client):
        a = _kid('Ana')
        resp = admin_client.post(LINK, {'student_ids': [a.pk]}, format='json')
        assert resp.status_code == 400 and 'al menos dos' in resp.data['detail']

    def test_cap(self, admin_client):
        kids = [_kid(f'N{i}') for i in range(FAMILY_MAX_STUDENTS + 1)]
        resp = admin_client.post(LINK, {'student_ids': [k.pk for k in kids]}, format='json')
        assert resp.status_code == 400 and str(FAMILY_MAX_STUDENTS) in resp.data['detail']
        assert not Family.objects.exists()

    def test_archived_student_is_refused(self, admin_client):
        from django.utils import timezone
        a, b = _kid('Ana'), _kid('Luis')
        User.objects.filter(pk=b.user_id).update(archived_at=timezone.now())
        resp = admin_client.post(LINK, {'student_ids': [a.pk, b.pk]}, format='json')
        assert resp.status_code == 400 and 'archivado' in resp.data['detail']


class TestRemoveAndDissolve:
    def test_removing_one_of_three_keeps_the_family(self, admin_client):
        a, b, c = _kid('Ana'), _kid('Luis'), _kid('Sofía')
        fam, _ = link_students([a.pk, b.pk, c.pk], notify=False)
        resp = admin_client.delete(reverse('admin-family-student', args=[fam.pk, c.pk]))
        assert resp.status_code == 200 and resp.data == {'dissolved': False}
        assert _family_of(c) is None and fam.students.count() == 2

    def test_removing_the_second_to_last_dissolves(self, admin_client):
        a, b = _kid('Ana'), _kid('Luis')
        fam, _ = link_students([a.pk, b.pk], notify=False)
        resp = admin_client.delete(reverse('admin-family-student', args=[fam.pk, b.pk]))
        assert resp.data == {'dissolved': True}
        assert not Family.objects.exists()
        assert _family_of(a) is None and _family_of(b) is None

    def test_removing_a_student_of_another_family(self, admin_client):
        a, b, c = _kid('Ana'), _kid('Luis'), _kid('Otro')
        fam, _ = link_students([a.pk, b.pk], notify=False)
        resp = admin_client.delete(reverse('admin-family-student', args=[fam.pk, c.pk]))
        assert resp.status_code == 400

    def test_dissolve_keeps_files_and_logins(self, admin_client):
        a, b = _kid('Ana'), _kid('Luis')
        fam, _ = link_students([a.pk, b.pk], notify=False)
        assert admin_client.delete(reverse('admin-family-detail', args=[fam.pk])).status_code == 204
        assert StudentProfile.objects.filter(pk__in=[a.pk, b.pk]).count() == 2
        assert User.objects.filter(pk__in=[a.user_id, b.user_id], is_active=True).count() == 2

    def test_bulk_dissolve(self, admin_client):
        f1, _ = link_students([_kid('A').pk, _kid('B').pk], notify=False)
        f2, _ = link_students([_kid('C').pk, _kid('D').pk], notify=False)
        url = reverse('admin-families-bulk')
        plan = admin_client.post(url, {'action': 'dissolve', 'ids': [f1.pk, f2.pk], 'dry_run': True},
                                 format='json').data
        assert plan['ok'] == 2 and Family.objects.count() == 2
        done = admin_client.post(url, {'action': 'dissolve', 'ids': [f1.pk, f2.pk]}, format='json').data
        assert done['ok'] == 2 and not Family.objects.exists()

    def test_erasing_a_student_dissolves_a_family_of_one(self, admin_client):
        from django.db import transaction

        from apps.accounts.student_delete import remove_student as erase
        a, b = _kid('Ana', loyverse_id=''), _kid('Luis')
        link_students([a.pk, b.pk], notify=False)
        a = StudentProfile.objects.select_related('user').get(pk=a.pk)
        with transaction.atomic():
            assert erase(a)['outcome'] == 'erased'

        assert not Family.objects.exists()
        assert _family_of(b) is None


class TestRenameAndDetail:
    def test_rename_and_notes(self, admin_client):
        fam, _ = link_students([_kid('Ana').pk, _kid('Luis').pk], notify=False)
        url = reverse('admin-family-detail', args=[fam.pk])
        resp = admin_client.patch(url, {'name': '  Familia   Pérez  ', 'notes': 'Recoge la abuela'}, format='json')
        assert resp.status_code == 200
        assert resp.data['name'] == 'Familia Pérez' and resp.data['notes'] == 'Recoge la abuela'
        assert admin_client.patch(url, {'name': ''}, format='json').status_code == 400

    def test_detail_lists_every_login(self, admin_client):
        a, b = _kid('Ana'), _kid('Luis')
        mom = ParentFactory(email='mama@correo.mx')
        a.parents.add(mom)
        fam, _ = link_students([a.pk, b.pk], notify=False)
        body = admin_client.get(reverse('admin-family-detail', args=[fam.pk])).data
        kinds = {r['email']: r['kind'] for r in body['logins']}
        assert kinds == {a.user.email: 'student', b.user.email: 'student', 'mama@correo.mx': 'guardian'}

    def test_student_family_tab(self, admin_client):
        a, b, c = _kid('Ana'), _kid('Luis'), _kid('Sola', last='Ruiz Soto')
        link_students([a.pk, b.pk], notify=False)
        body = admin_client.get(reverse('admin-student-family', args=[a.pk])).data
        assert body['family']['name'] == 'Familia Pérez López'
        assert {s['id'] for s in body['family']['students']} == {a.pk, b.pk}
        alone = admin_client.get(reverse('admin-student-family', args=[c.pk])).data
        assert alone['family'] is None
        assert [r['email'] for r in alone['logins']] == [c.user.email]


class TestListAndExport:
    @pytest.fixture
    def families(self):
        f1, _ = link_students([_kid('Ana', student_id='09001').pk, _kid('Luis').pk],
                              name='Familia Pérez', notify=False)
        f2, _ = link_students([_kid('Eva', last='Zamora Gil').pk, _kid('Iván', last='Zamora Gil').pk,
                               _kid('Olga', last='Zamora Gil').pk], name='Familia Zamora', notify=False)
        return f1, f2

    def test_list_rows_search_size_and_ordering(self, admin_client, families):
        f1, f2 = families
        body = admin_client.get(LIST).data
        assert body['count'] == 2
        row = body['results'][0]
        assert row['name'] == 'Familia Pérez' and row['children_count'] == 2 and row['logins_count'] == 2
        assert [s['first_name'] for s in row['students']] == ['Ana', 'Luis']
        # Search by a child's name or matrícula (Loyverse spelling too), each family once.
        assert [r['id'] for r in admin_client.get(LIST, {'q': 'iván'}).data['results']] == [f2.pk]
        assert [r['id'] for r in admin_client.get(LIST, {'q': 'ci09001'}).data['results']] == [f1.pk]
        assert [r['id'] for r in admin_client.get(LIST, {'q': 'zamora'}).data['results']] == [f2.pk]
        assert [r['id'] for r in admin_client.get(LIST, {'size': '3'}).data['results']] == [f2.pk]
        assert [r['id'] for r in admin_client.get(LIST, {'ordering': '-children'}).data['results']] == [f2.pk, f1.pk]
        assert admin_client.get(LIST, {'size': '9'}).status_code == 400

    def test_list_query_count_does_not_grow_with_families(self, admin_client, families, django_assert_max_num_queries):
        with django_assert_max_num_queries(12):
            admin_client.get(LIST)

    def test_export_csv(self, admin_client, families):
        resp = admin_client.get(reverse('admin-families-export'), {'fmt': 'csv'})
        assert resp.status_code == 200
        text = b''.join(resp.streaming_content).decode('utf-8').lstrip('﻿')
        rows = list(csv.reader(io.StringIO(text)))
        assert rows[0][:3] == ['Familia', 'Alumnos', 'Integrantes']
        by_name = {r[0]: r for r in rows[1:]}
        assert by_name['Familia Zamora'][1] == '3'
        assert 'Iván Zamora Gil (3° Primaria A)' in by_name['Familia Zamora'][2]
        assert AuditLog.objects.filter(object_type='export:families').exists()

    @pytest.mark.parametrize('fmt', ['xlsx', 'pdf'])
    def test_export_other_formats(self, admin_client, families, fmt):
        assert admin_client.get(reverse('admin-families-export'), {'fmt': fmt}).status_code == 200

    def test_students_export_has_family_and_siblings(self, admin_client, families):
        resp = admin_client.get(reverse('export-students'), {'fmt': 'csv'})
        text = b''.join(resp.streaming_content).decode('utf-8').lstrip('﻿')
        rows = list(csv.reader(io.StringIO(text)))
        head = rows[0]
        by_name = {r[0]: dict(zip(head, r, strict=True)) for r in rows[1:]}
        assert by_name['Ana Pérez López']['Familia'] == 'Familia Pérez'
        assert by_name['Ana Pérez López']['Hermanos'] == 'Luis Pérez López (3° Primaria A)'
        assert by_name['Eva Zamora Gil']['Hermanos'].count(';') == 1

    def test_roster_rows_carry_the_family(self, admin_client, families):
        rows = admin_client.get(reverse('students'), {'q': 'Ana'}).data['results']
        assert rows[0]['family']['name'] == 'Familia Pérez'
