"""A family adds another child itself, with a code sent to that child's mailbox (2026-11-13)."""
import re
from datetime import timedelta

import pytest
from django.urls import reverse
from django.utils import timezone

from apps.accounts.factories import (
    AdminFactory,
    ParentFactory,
    StudentProfileFactory,
    StudentUserFactory,
)
from apps.accounts.families import link_students
from apps.accounts.family import family_students
from apps.accounts.models import FamilyLinkCode, StudentProfile
from apps.core.models import AuditLog
from apps.portal.models import Notification

pytestmark = pytest.mark.django_db

ADD = reverse('my-family-add')
CONFIRM = reverse('my-family-confirm')
MINE = reverse('my-family')
REMOVE = reverse('my-family-remove')


def _kid(email, first, student_id, **kw):
    login = StudentUserFactory(email=email, first_name=first, last_name='Alvarado Felix')
    profile = StudentProfileFactory(user=login, student_id=student_id, **kw)
    profile.parents.add(login)
    return profile


@pytest.fixture
def kids():
    olivia = _kid('ci10073@interlaken.com.mx', 'Olivia', '10073')
    alejandro = _kid('ci09628@interlaken.com.mx', 'Alejandro', '09628', grade='1° Secundaria')
    return olivia, alejandro


def _code_from(mailoutbox, to):
    mail = next(m for m in reversed(mailoutbox) if to in m.to)
    body = mail.body + ''.join(str(a[0]) for a in getattr(mail, 'alternatives', []))
    found = re.search(r'(\d{3}) (\d{3})', body)
    assert found, body[:400]
    return found.group(1) + found.group(2)


class TestMyFamily:
    def test_lists_the_children_this_login_sees(self, api_client, kids):
        olivia, _ = kids
        api_client.force_authenticate(olivia.user)
        body = api_client.get(MINE).data
        assert [c['id'] for c in body['children']] == [olivia.pk] and body['can_add'] is True

    def test_admins_and_staff_cannot_use_it(self, api_client):
        api_client.force_authenticate(AdminFactory())
        assert api_client.get(MINE).status_code == 403
        assert api_client.post(ADD, {'student': 'x'}, format='json').status_code == 403


class TestAddAndConfirm:
    def test_full_flow_by_school_email(self, api_client, kids, mailoutbox, django_capture_on_commit_callbacks):
        olivia, alejandro = kids
        api_client.force_authenticate(olivia.user)
        resp = api_client.post(ADD, {'student': 'CI09628@interlaken.com.mx'}, format='json')
        assert resp.status_code == 200, resp.data
        assert resp.data['sent_to'] == ['ci…@interlaken.com.mx']
        assert resp.data['student']['name'] == 'Alejandro Alvarado Felix'
        assert 'code' not in resp.data
        row = FamilyLinkCode.objects.get()
        code = _code_from(mailoutbox, 'ci09628@interlaken.com.mx')
        assert code not in row.code_hash  # only a hash is stored

        with django_capture_on_commit_callbacks(execute=True):
            done = api_client.post(CONFIRM, {'student': 'ci09628@interlaken.com.mx', 'code': f'{code[:3]} {code[3:]}'},
                                   format='json')
        assert done.status_code == 200, done.data
        assert sorted(c['id'] for c in done.data['children']) == sorted([olivia.pk, alejandro.pk])
        # Both logins now see both children.
        for login in (olivia.user, alejandro.user):
            assert set(family_students(login).values_list('pk', flat=True)) == {olivia.pk, alejandro.pk}
        # The child's account is told, with the «if it was not you» line.
        notice = Notification.objects.get(user=alejandro.user, title='Sus hijos, juntos en el portal')
        assert 'Si usted no hizo este cambio' in notice.message
        assert AuditLog.objects.filter(context='familia: vinculada por la familia').exists()
        row.refresh_from_db()
        assert row.used_at is not None

    def test_by_matricula_in_the_loyverse_spelling(self, api_client, kids, mailoutbox):
        olivia, _ = kids
        api_client.force_authenticate(olivia.user)
        assert api_client.post(ADD, {'student': 'ci09628'}, format='json').status_code == 200

    def test_wrong_code_counts_down_then_locks(self, api_client, kids, mailoutbox):
        olivia, _ = kids
        api_client.force_authenticate(olivia.user)
        api_client.post(ADD, {'student': '09628'}, format='json')
        right = _code_from(mailoutbox, 'ci09628@interlaken.com.mx')
        wrong = '000000' if right != '000000' else '111111'
        first = api_client.post(CONFIRM, {'student': '09628', 'code': wrong}, format='json')
        assert first.status_code == 400 and 'quedan 4' in first.data['detail']
        for _ in range(3):
            api_client.post(CONFIRM, {'student': '09628', 'code': wrong}, format='json')
        locked = api_client.post(CONFIRM, {'student': '09628', 'code': wrong}, format='json')
        assert 'Demasiados intentos' in locked.data['detail']
        # The right code no longer works: a new one is needed.
        late = api_client.post(CONFIRM, {'student': '09628', 'code': right}, format='json')
        assert late.status_code == 400 and 'venció' in late.data['detail']

    def test_expired_code(self, api_client, kids, mailoutbox):
        olivia, _ = kids
        api_client.force_authenticate(olivia.user)
        api_client.post(ADD, {'student': '09628'}, format='json')
        code = _code_from(mailoutbox, 'ci09628@interlaken.com.mx')
        FamilyLinkCode.objects.update(expires_at=timezone.now() - timedelta(seconds=1))
        resp = api_client.post(CONFIRM, {'student': '09628', 'code': code}, format='json')
        assert resp.status_code == 400 and 'venció' in resp.data['detail']

    def test_a_new_code_replaces_the_old_one(self, api_client, kids, mailoutbox):
        olivia, _ = kids
        api_client.force_authenticate(olivia.user)
        api_client.post(ADD, {'student': '09628'}, format='json')
        old = _code_from(mailoutbox, 'ci09628@interlaken.com.mx')
        api_client.post(ADD, {'student': '09628'}, format='json')
        new = _code_from(mailoutbox, 'ci09628@interlaken.com.mx')
        if old != new:
            assert api_client.post(CONFIRM, {'student': '09628', 'code': old}, format='json').status_code == 400
        assert api_client.post(CONFIRM, {'student': '09628', 'code': new}, format='json').status_code == 200

    def test_a_parent_account_adds_a_child_to_its_children(self, api_client, kids, mailoutbox):
        olivia, alejandro = kids
        mom = ParentFactory(email='mama@correo.mx')
        olivia.parents.add(mom)
        api_client.force_authenticate(mom)
        api_client.post(ADD, {'student': '09628'}, format='json')
        code = _code_from(mailoutbox, 'ci09628@interlaken.com.mx')
        assert api_client.post(CONFIRM, {'student': '09628', 'code': code}, format='json').status_code == 200
        assert set(family_students(mom).values_list('pk', flat=True)) == {olivia.pk, alejandro.pk}


class TestRefusals:
    @pytest.mark.parametrize('term, message', [
        ('nadie@interlaken.com.mx', 'No encontramos'),
        ('99999', 'No encontramos'),
        ('', 'Escriba el correo escolar'),
    ])
    def test_unknown_child(self, api_client, kids, term, message):
        api_client.force_authenticate(kids[0].user)
        resp = api_client.post(ADD, {'student': term}, format='json')
        assert resp.status_code == 400
        assert message in str(resp.data)

    def test_already_in_the_account(self, api_client, kids):
        olivia, _ = kids
        api_client.force_authenticate(olivia.user)
        resp = api_client.post(ADD, {'student': '10073'}, format='json')
        assert resp.status_code == 400 and 'ya aparece' in resp.data['detail']

    def test_inactive_child(self, api_client, kids):
        olivia, alejandro = kids
        StudentProfile.objects.filter(pk=alejandro.pk).update(status=StudentProfile.Status.WITHDRAWN, is_active=False)
        api_client.force_authenticate(olivia.user)
        resp = api_client.post(ADD, {'student': '09628'}, format='json')
        assert resp.status_code == 400 and 'no está activo' in resp.data['detail']

    def test_child_without_a_real_mailbox(self, api_client, kids):
        olivia, _ = kids
        _kid('77777@alumnos.interlaken.edu.mx', 'Sin', '77777')
        api_client.force_authenticate(olivia.user)
        resp = api_client.post(ADD, {'student': '77777'}, format='json')
        assert resp.status_code == 400 and 'no tiene un correo' in resp.data['detail']

    def test_a_child_receives_at_most_three_codes_an_hour(self, api_client, kids, mailoutbox):
        olivia, _ = kids
        api_client.force_authenticate(olivia.user)
        for _ in range(3):
            assert api_client.post(ADD, {'student': '09628'}, format='json').status_code == 200
        assert api_client.post(ADD, {'student': '09628'}, format='json').status_code == 429

    def test_code_format(self, api_client, kids):
        api_client.force_authenticate(kids[0].user)
        resp = api_client.post(CONFIRM, {'student': '09628', 'code': '12ab'}, format='json')
        assert resp.status_code == 400 and '6 números' in str(resp.data)


def _pks(user):
    return set(family_students(user).values_list('pk', flat=True))


class TestRemoveSibling:
    """A family takes a sibling out itself, e.g. the one who finished school."""

    def test_the_list_says_which_child_can_be_removed(self, api_client, kids):
        olivia, alejandro = kids
        link_students([olivia.pk, alejandro.pk], actor=AdminFactory(), notify=False)
        api_client.force_authenticate(olivia.user)
        rows = {c['id']: c for c in api_client.get(MINE).data['children']}
        assert (rows[olivia.pk]['own'], rows[olivia.pk]['removable']) == (True, False)
        assert (rows[alejandro.pk]['own'], rows[alejandro.pk]['removable']) == (False, True)

    def test_a_graduate_leaves_and_the_sibling_keeps_its_own_account(self, api_client, kids):
        olivia, alejandro = kids
        link_students([olivia.pk, alejandro.pk], actor=AdminFactory(), notify=False)
        StudentProfile.objects.filter(pk=alejandro.pk).update(status=StudentProfile.Status.GRADUATED)
        api_client.force_authenticate(olivia.user)
        resp = api_client.post(REMOVE, {'student': alejandro.pk}, format='json')
        assert resp.status_code == 200, resp.data
        assert resp.data['removed'] == alejandro.user.full_name and resp.data['dissolved'] is True
        assert [c['id'] for c in resp.data['children']] == [olivia.pk]
        # Both sides lose each other; nobody loses their own child.
        assert _pks(olivia.user) == {olivia.pk}
        assert _pks(alejandro.user) == {alejandro.pk}
        olivia.refresh_from_db()
        alejandro.refresh_from_db()
        assert olivia.family_id is None and alejandro.family_id is None
        assert AuditLog.objects.filter(context='familia: quitado por la familia').exists()

    def test_three_children_the_other_two_stay_together(self, api_client, kids):
        olivia, alejandro = kids
        third = _kid('ci09999@interlaken.com.mx', 'Mateo', '09999')
        link_students([olivia.pk, alejandro.pk, third.pk], actor=AdminFactory(), notify=False)
        api_client.force_authenticate(olivia.user)
        resp = api_client.post(REMOVE, {'student': alejandro.pk}, format='json')
        assert resp.status_code == 200 and resp.data['dissolved'] is False
        assert _pks(olivia.user) == {olivia.pk, third.pk}
        assert _pks(alejandro.user) == {alejandro.pk}

    def test_a_parent_removes_a_sibling_added_through_the_family(self, api_client, kids):
        olivia, alejandro = kids
        mom = ParentFactory(email='mama@correo.mx')
        olivia.parents.add(mom)
        link_students([olivia.pk, alejandro.pk], actor=AdminFactory(), notify=False)
        api_client.force_authenticate(mom)
        assert api_client.post(REMOVE, {'student': alejandro.pk}, format='json').status_code == 200
        assert _pks(mom) == {olivia.pk}

    def test_the_accounts_own_child_cannot_be_removed(self, api_client, kids):
        olivia, alejandro = kids
        link_students([olivia.pk, alejandro.pk], actor=AdminFactory(), notify=False)
        api_client.force_authenticate(olivia.user)
        resp = api_client.post(REMOVE, {'student': olivia.pk}, format='json')
        assert resp.status_code == 400 and resp.data['code'] == 'own_child'
        assert _pks(olivia.user) == {olivia.pk, alejandro.pk}

    def test_a_guardian_linked_by_the_school_is_not_removable(self, api_client, kids):
        olivia, alejandro = kids
        mom = ParentFactory(email='mama@correo.mx')
        olivia.parents.add(mom)
        alejandro.parents.add(mom)
        api_client.force_authenticate(mom)
        rows = api_client.get(MINE).data['children']
        assert [c['removable'] for c in rows] == [False, False]
        resp = api_client.post(REMOVE, {'student': alejandro.pk}, format='json')
        assert resp.status_code == 400 and resp.data['code'] == 'own_child'

    def test_a_child_outside_the_account(self, api_client, kids):
        olivia, alejandro = kids
        api_client.force_authenticate(olivia.user)
        resp = api_client.post(REMOVE, {'student': alejandro.pk}, format='json')
        assert resp.status_code == 404
        assert api_client.post(REMOVE, {'student': 'x'}, format='json').status_code == 400

    def test_admins_cannot_use_it(self, api_client, kids):
        api_client.force_authenticate(AdminFactory())
        assert api_client.post(REMOVE, {'student': kids[0].pk}, format='json').status_code == 403
