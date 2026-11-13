"""Probable siblings for the Familias table (2026-11-13)."""
import pytest
from django.urls import reverse
from django.utils import timezone

from apps.accounts.factories import ParentFactory, StudentProfileFactory, StudentUserFactory
from apps.accounts.families import link_students
from apps.accounts.family_suggestions import build_suggestions, dismiss, suggestion_key
from apps.accounts.models import Family, FamilySuggestionDismissal, StudentProfile, User

pytestmark = pytest.mark.django_db

URL = reverse('admin-family-suggestions')
BULK = reverse('admin-family-suggestions-bulk')


def _kid(first, last='Pérez López', **kw):
    user_kw = {k[6:]: kw.pop(k) for k in list(kw) if k.startswith('login_')}
    login = StudentUserFactory(first_name=first, last_name=last, **user_kw)
    profile = StudentProfileFactory(user=login, **kw)
    profile.parents.add(login)
    return profile


def _keys(rows):
    return {r['key']: r for r in rows}


class TestSignals:
    def test_shared_guardian_is_high_confidence(self):
        mom = ParentFactory(email='mama@correo.mx')
        a, b = _kid('Ana', last='Ruiz'), _kid('Luis', last='Soto')
        a.parents.add(mom)
        b.parents.add(mom)
        rows = _keys(build_suggestions())
        row = rows[suggestion_key([a.pk, b.pk])]
        assert row['confidence'] == 'alta'
        assert row['reasons'] == [{'kind': 'guardian', 'label': 'Mismo tutor', 'value': 'mama@correo.mx'}]

    def test_confirmed_personal_email_counts_unconfirmed_does_not(self):
        now = timezone.now()
        a = _kid('Ana', last='Ruiz', login_notify_email='Papa@Correo.mx', login_notify_email_verified_at=now)
        b = _kid('Luis', last='Soto', login_notify_email='papa@correo.mx', login_notify_email_verified_at=now)
        c = _kid('Eva', last='Gil', login_notify_email='papa@correo.mx')
        rows = _keys(build_suggestions())
        assert suggestion_key([a.pk, b.pk]) in rows
        assert not any(c.pk in [s['id'] for s in r['students']] for r in rows.values())

    def test_same_phone_across_sources(self):
        a = _kid('Ana', last='Ruiz', emergency_phone='+52 (55) 1234-5678')
        b = _kid('Luis', last='Soto', login_whatsapp='5512345678')
        row = _keys(build_suggestions())[suggestion_key([a.pk, b.pk])]
        assert row['confidence'] == 'alta'
        assert row['reasons'][0] == {'kind': 'phone', 'label': 'Mismo teléfono', 'value': '55 1234 5678'}

    def test_both_surnames_alone_are_medium_one_surname_is_nothing(self):
        a, b = _kid('Ana', last='García  López'), _kid('Luis', last='garcia lopez')
        c, d = _kid('Eva', last='Martínez'), _kid('Iván', last='Martínez')
        rows = _keys(build_suggestions())
        assert rows[suggestion_key([a.pk, b.pk])]['confidence'] == 'media'
        assert suggestion_key([c.pk, d.pk]) not in rows

    def test_strong_signal_upgrades_a_surname_match(self):
        a = _kid('Ana', emergency_phone='5511112222')
        b = _kid('Luis', emergency_phone='5511112222')
        row = _keys(build_suggestions())[suggestion_key([a.pk, b.pk])]
        assert row['confidence'] == 'alta'
        assert [r['kind'] for r in row['reasons']] == ['phone', 'surname']

    def test_a_value_shared_by_many_is_ignored(self):
        kids = [_kid(f'N{i}', last=f'Apellido{i} X{i}', emergency_phone='5599998888') for i in range(7)]
        assert not any(set(r['key'].split('-')) & {str(k.pk) for k in kids} for r in build_suggestions())

    def test_placeholder_phone_is_ignored(self):
        _kid('Ana', last='Ruiz', emergency_phone='0000000000')
        _kid('Luis', last='Soto', emergency_phone='0000000000')
        assert build_suggestions() == []


class TestFiltering:
    def test_students_already_together_are_not_suggested(self):
        a, b = _kid('Ana'), _kid('Luis')
        link_students([a.pk, b.pk], notify=False)
        assert build_suggestions() == []

    def test_a_new_sibling_of_a_family_is_suggested_with_the_family(self):
        a, b, c = _kid('Ana'), _kid('Luis'), _kid('Sofía')
        fam, _ = link_students([a.pk, b.pk], notify=False)
        row = build_suggestions()[0]
        assert {s['id'] for s in row['students']} == {a.pk, b.pk, c.pk}
        assert row['families'] == [{'id': fam.pk, 'name': fam.name}]

    def test_inactive_and_archived_students_are_left_out(self):
        _kid('Ana')
        b = _kid('Luis', status=StudentProfile.Status.WITHDRAWN, is_active=False)
        c = _kid('Eva')
        User.objects.filter(pk=c.user_id).update(archived_at=timezone.now())
        assert build_suggestions() == []
        assert b.pk  # kept only to name the case

    def test_dismissed_pairs_never_come_back(self):
        a, b = _kid('Ana'), _kid('Luis')
        assert dismiss([b.pk, a.pk]) == 1
        assert dismiss([a.pk, b.pk]) == 0
        assert build_suggestions() == []
        pair = FamilySuggestionDismissal.objects.get()
        assert (pair.student_a_id, pair.student_b_id) == (min(a.pk, b.pk), max(a.pk, b.pk))

    def test_student_filter(self):
        a, b = _kid('Ana'), _kid('Luis')
        c, d = _kid('Eva', last='Gil Mora'), _kid('Iván', last='Gil Mora')
        assert [r['key'] for r in build_suggestions(student_id=c.pk)] == [suggestion_key([c.pk, d.pk])]
        assert a.pk and b.pk


class TestApi:
    def test_list_counts_and_filters(self, admin_client):
        mom = ParentFactory()
        a, b = _kid('Ana', last='Ruiz'), _kid('Luis', last='Soto')
        a.parents.add(mom)
        b.parents.add(mom)
        _kid('Eva', last='Gil Mora'), _kid('Iván', last='Gil Mora')
        body = admin_client.get(URL).data
        assert body['count'] == 2 and body['counts'] == {'alta': 1, 'media': 1}
        assert body['results'][0]['confidence'] == 'alta'
        assert admin_client.get(URL, {'confidence': 'media'}).data['count'] == 1
        assert admin_client.get(URL, {'q': 'ivan'}).data['count'] == 1
        assert admin_client.get(URL, {'student': a.pk}).data['count'] == 1

    def test_accept_dry_run_then_commit(self, admin_client):
        a, b = _kid('Ana'), _kid('Luis')
        key = suggestion_key([a.pk, b.pk])
        plan = admin_client.post(BULK, {'action': 'accept', 'ids': [key], 'dry_run': True}, format='json').data
        assert plan['ok'] == 1 and plan['dry_run'] is True and not Family.objects.exists()
        done = admin_client.post(BULK, {'action': 'accept', 'ids': [key], 'payload': {'notify': False}},
                                 format='json').data
        assert done['ok'] == 1
        a.refresh_from_db()
        b.refresh_from_db()
        assert a.family_id and a.family_id == b.family_id

    def test_stale_key_is_skipped_and_garbage_fails(self, admin_client):
        a, b = _kid('Ana', last='Ruiz'), _kid('Luis', last='Soto')
        body = admin_client.post(BULK, {'action': 'accept', 'ids': [suggestion_key([a.pk, b.pk]), 'nope']},
                                 format='json').data
        assert body['ok'] == 0
        assert body['skipped'] == [{'id': suggestion_key([a.pk, b.pk]), 'reason': 'ya no es una sugerencia'}]
        assert body['failed'][0]['id'] == 'nope'

    def test_merge_warning_in_the_dry_run(self, admin_client):
        a, b = _kid('Ana'), _kid('Luis')
        c, d = _kid('Eva'), _kid('Iván')
        link_students([a.pk, b.pk], name='Familia Uno', notify=False)
        link_students([c.pk, d.pk], name='Familia Dos', notify=False)
        key = build_suggestions()[0]['key']
        plan = admin_client.post(BULK, {'action': 'accept', 'ids': [key], 'dry_run': True}, format='json').data
        assert plan['warnings'][0]['message'].startswith('Se unirán')

    def test_dismiss(self, admin_client):
        a, b = _kid('Ana'), _kid('Luis')
        key = suggestion_key([a.pk, b.pk])
        assert admin_client.post(BULK, {'action': 'dismiss', 'ids': [key]}, format='json').data['ok'] == 1
        assert admin_client.get(URL).data['count'] == 0

    def test_validation(self, admin_client):
        assert admin_client.post(BULK, {'action': 'explode', 'ids': ['1-2']}, format='json').status_code == 400
        assert admin_client.post(BULK, {'action': 'accept', 'ids': []}, format='json').status_code == 400
