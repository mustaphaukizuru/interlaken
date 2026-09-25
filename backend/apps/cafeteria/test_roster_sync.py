"""Phase 0 (fix/loyverse-roster-sync): the roster follows Loyverse, safely.

Client report of 2026-09-24: the office edits the roster in Loyverse (grade
code as a name suffix, ``ci`` on the customer code) and nothing showed up in
the app, because the daily ``sync_roster`` had never run and the manual
import could clobber console corrections and showed no per-student preview.
These tests pin the new contract:

* ``services.sync_roster`` is the one body behind the cron and the button,
  stamps ``last_roster_sync_at`` and audits a summary;
* the endpoint runs a 500-customer store with no Loyverse call beyond the
  one fetch it is handed;
* a name is rewritten only when Loyverse's name changed since the sync last
  applied it (console corrections survive), and every rewrite is audited;
* grade follows the code, group only when the code carries a letter;
* skipped customers carry an es-MX reason, the preview lists every diff, and
  a linked customer without a grade code is a "posible baja", never a status
  change;
* searches accept ``ci09932`` and ``09932`` as one key.
"""
from decimal import Decimal
from unittest.mock import patch

import pytest
from django.core.cache import cache
from django.urls import reverse

from apps.accounts.factories import AdminFactory, ParentFactory, StudentProfileFactory
from apps.accounts.models import StudentProfile
from apps.cafeteria import services as S
from apps.cafeteria.loyverse_profile import refresh_all_profiles
from apps.cafeteria.models import CafeteriaBalance, LoyverseProfile, LoyverseSyncState
from apps.cafeteria.views import AdminSyncHealthView, AdminSyncRosterView
from apps.core.models import AuditLog

pytestmark = pytest.mark.django_db


def cust(code, name, *, uuid=None, address='', points=0, email=None):
    """A Loyverse customer as the live store writes it: ``ci09932`` code,
    ``Apellidos Nombre-4PRI`` name, ``4PRI`` address, ``ci09932@`` mailbox."""
    digits = S._matricula(code)
    return {
        'id': uuid or f'uuid-{digits}', 'customer_code': code, 'name': name,
        'email': email if email is not None else f'ci{digits}@interlaken.com.mx',
        'address': address, 'total_points': points,
    }


def student(code='09932', first='Juan Antonio', last='Chavez Lopez', *, applied=None, **kw):
    """An existing pupil, linked, optionally with the Loyverse name the sync
    last applied (``applied``) recorded on its snapshot."""
    kw.setdefault('loyverse_id', f'uuid-{code}')
    s = StudentProfileFactory(student_id=code, **kw)
    s.user.first_name, s.user.last_name = first, last
    s.user.save(update_fields=['first_name', 'last_name'])
    if applied is not None:
        LoyverseProfile.objects.create(
            student=s, loyverse_id=s.loyverse_id, kind='student',
            customer_code=f'ci{code}', name=f'{applied}-4PRI', address_code='4PRI',
            applied_name=applied)
    return s


# ── Name refresh semantics (decision C3.2) ───────────────────────────────────


class TestNameRefresh:
    def test_a_console_correction_survives_a_sync_that_reads_the_same_loyverse_name(self):
        s = student(first='Juan Antonio', last='Chávez López',      # corrected accents
                    grade='4° Primaria', applied='Chavez Lopez Juan Antonio')

        report = S.import_students_from_loyverse(
            [cust('ci09932', 'Chavez Lopez Juan Antonio-4PRI', address='4PRI')], commit=True)

        s.user.refresh_from_db()
        assert (s.user.first_name, s.user.last_name) == ('Juan Antonio', 'Chávez López')
        assert report['renamed'] == 0 and report['unchanged'] == 1
        assert report['changes'] == []
        assert not AuditLog.objects.filter(object_type='accounts.user', action='update').exists()

    def test_a_rename_in_loyverse_is_applied_and_audited(self):
        s = student(applied='Chavez Lopez Juan Antonio')

        preview = S.import_students_from_loyverse(
            [cust('ci09932', 'Chavez Lopez Juan Pablo-4PRI', address='4PRI')])
        assert [c for c in preview['changes'] if c['field'] == 'nombre'] == [{
            'matricula': '09932', 'name': 'Juan Antonio Chavez Lopez', 'field': 'nombre',
            'before': 'Juan Antonio Chavez Lopez', 'after': 'Juan Pablo Chavez Lopez',
            'action': 'actualizar'}]
        assert preview['renamed'] == 1

        report = S.import_students_from_loyverse(
            [cust('ci09932', 'Chavez Lopez Juan Pablo-4PRI', address='4PRI')], commit=True)

        s.user.refresh_from_db()
        assert (s.user.first_name, s.user.last_name) == ('Juan Pablo', 'Chavez Lopez')
        assert report['renamed'] == 1 and report['updated'] == 1
        entry = AuditLog.objects.get(object_type='accounts.user', object_id=str(s.user.pk),
                                     action='update')
        assert entry.context == 'import:loyverse'
        assert entry.changes == {'first_name': ['Juan Antonio', 'Juan Pablo'],
                                 'last_name': ['Chavez Lopez', 'Chavez Lopez']}
        # The marker moves with it, so the next run is a no-op again.
        assert LoyverseProfile.objects.get(student=s).applied_name == 'Chavez Lopez Juan Pablo'
        again = S.import_students_from_loyverse(
            [cust('ci09932', 'Chavez Lopez Juan Pablo-4PRI', address='4PRI')], commit=True)
        assert again['unchanged'] == 1 and again['changes'] == []

    def test_first_run_records_the_baseline_without_touching_the_console_name(self):
        """No marker yet (first run after this shipped): the console keeps its
        name, the marker is stamped, and only a later rename is applied."""
        s = student(first='Juan Antonio', last='Chávez López')

        S.import_students_from_loyverse(
            [cust('ci09932', 'Chavez Lopez Juan Antonio-4PRI', address='4PRI')], commit=True)
        s.user.refresh_from_db()
        assert s.user.last_name == 'Chávez López'
        assert LoyverseProfile.objects.get(student=s).applied_name == 'Chavez Lopez Juan Antonio'

        S.import_students_from_loyverse(
            [cust('ci09932', 'Chavez Lopez Juan Antonio Jose-4PRI', address='4PRI')], commit=True)
        s.user.refresh_from_db()
        assert s.user.first_name == 'Juan Antonio Jose'

    def test_a_two_word_name_is_split_apellido_then_nombre(self):
        assert S._split_loyverse_name('Alvarado Alejandro-1SEC') == ('Alejandro', 'Alvarado')
        S.import_students_from_loyverse(
            [cust('ci09950', 'Alvarado Alejandro-1SEC')], commit=True)
        u = StudentProfile.objects.get(student_id='09950').user
        assert (u.first_name, u.last_name) == ('Alejandro', 'Alvarado')


# ── Grade and group from the Loyverse code (decision C3.3) ───────────────────


class TestGradeAndGroup:
    def test_bare_code_updates_grade_and_keeps_the_group(self):
        s = student(grade='3° Primaria', group='B', applied='Chavez Lopez Juan Antonio')
        report = S.import_students_from_loyverse(
            [cust('ci09932', 'Chavez Lopez Juan Antonio-4PRI', address='4PRI')], commit=True)
        s.refresh_from_db()
        assert (s.grade, s.group) == ('4° Primaria', 'B')
        assert [(c['field'], c['before'], c['after']) for c in report['changes']] == [
            ('grado', '3° Primaria', '4° Primaria')]

    def test_lettered_code_sets_the_group(self):
        s = student(grade='4° Primaria', group='B', applied='Chavez Lopez Juan Antonio')
        S.import_students_from_loyverse(
            [cust('ci09932', 'Chavez Lopez Juan Antonio', address='4APRI')], commit=True)
        s.refresh_from_db()
        assert (s.grade, s.group) == ('4° Primaria', 'A')

    def test_name_suffix_is_the_fallback_when_address_is_blank(self):
        s = student(grade='N/D', group='', applied='Chavez Lopez Juan Antonio')
        S.import_students_from_loyverse(
            [cust('ci09932', 'Chavez Lopez Juan Antonio-2BSEC')], commit=True)
        s.refresh_from_db()
        assert (s.grade, s.group) == ('2° Secundaria', 'B')

    def test_no_code_at_all_keeps_the_grade_and_nd_only_on_create(self):
        s = student(grade='5° Primaria', group='A', applied='Chavez Lopez Juan Antonio')
        S.import_students_from_loyverse(
            [cust('ci09932', 'Chavez Lopez Juan Antonio'), cust('ci09960', 'Nuevo Alumno')],
            commit=True)
        s.refresh_from_db()
        assert (s.grade, s.group) == ('5° Primaria', 'A')
        assert StudentProfile.objects.get(student_id='09960').grade == 'N/D'


# ── Skip reasons and the preview ─────────────────────────────────────────────


class TestSkipReasonsAndPreview:
    def test_every_skipped_customer_says_why_in_spanish(self):
        report = S.import_students_from_loyverse([
            cust('177', 'ZP-Jessica Soto', email='jsoto@interlaken.com.mx'),
            cust('ci-abc', 'Tarjeta rara', email='ci1@interlaken.com.mx'),
            cust('ci09932', 'Chavez Lopez Juan Antonio-4PRI', uuid='u-a'),
            cust('ci09932', 'Chavez Lopez Juan Antonio-4PRI', uuid='u-b'),
        ])
        assert report['skipped_non_student'] == 2 and report['skipped_duplicate'] == 1
        assert report['candidates'] == 1
        assert report['skipped'] == [
            {'customer_code': '177', 'name': 'ZP-Jessica Soto',
             'reason': 'correo no tiene la forma ci…@interlaken.com.mx'},
            {'customer_code': 'ci-abc', 'name': 'Tarjeta rara', 'reason': 'código no numérico'},
            {'customer_code': 'ci09932', 'name': 'Chavez Lopez Juan Antonio-4PRI',
             'reason': 'matrícula duplicada en Loyverse'},
        ]

    def test_skipped_list_is_capped_at_200_but_counts_everyone(self):
        staff = [cust(str(1000 + i), f'ZP-{i}', email=f'p{i}@interlaken.com.mx') for i in range(205)]
        report = S.import_students_from_loyverse(staff)
        assert report['skipped_non_student'] == 205 and len(report['skipped']) == 200

    def test_dry_run_lists_exactly_what_the_commit_changes(self):
        s = student(grade='3° Primaria', group='', loyverse_id='')
        customers = [cust('ci09932', 'Chavez Lopez Juan Antonio-4APRI', address='4APRI',
                          uuid='uuid-new')]

        preview = S.import_students_from_loyverse(customers)
        assert preview['commit'] is False and preview['updated'] == 1
        assert {(c['field'], c['before'], c['after']) for c in preview['changes']} == {
            ('grado', '3° Primaria', '4° Primaria'), ('grupo', '', 'A'),
            ('codigo', '09932', 'ci09932'), ('vinculo', '', 'uuid-new')}
        s.refresh_from_db()
        assert s.grade == '3° Primaria' and s.loyverse_id == ''

        applied = S.import_students_from_loyverse(customers, commit=True)
        assert [(c['field'], c['before'], c['after']) for c in applied['changes']] == \
            [(c['field'], c['before'], c['after']) for c in preview['changes']]
        s.refresh_from_db()
        assert (s.grade, s.group, s.loyverse_id) == ('4° Primaria', 'A', 'uuid-new')
        # The snapshot now exists, so "Código Loyverse" reads ci09932 at once.
        assert LoyverseProfile.objects.get(student=s).customer_code == 'ci09932'
        assert S.import_students_from_loyverse(customers, commit=True)['changes'] == []

    def test_a_new_pupil_previews_as_a_create_with_its_fields(self):
        preview = S.import_students_from_loyverse(
            [cust('ci09970', 'Ruiz Soto Ana-2PRI', address='2PRI')])
        assert preview['created'] == 1
        assert [(c['field'], c['after'], c['action']) for c in preview['changes']] == [
            ('nombre', 'Ana Ruiz Soto', 'crear'), ('grado', '2° Primaria', 'crear'),
            ('codigo', 'ci09970', 'crear'), ('vinculo', 'uuid-09970', 'crear')]

    def test_changes_are_capped_at_500_rows(self):
        many = [cust(f'ci{20000 + i}', f'Apellido Nombre{i}-1PRI') for i in range(150)]
        preview = S.import_students_from_loyverse(many)     # 4 rows each → 600
        assert preview['created'] == 150 and len(preview['changes']) == 500


# ── Link report: loyverse_code, vinculo rows, posible baja (decision C3.4) ───


class TestLinkReport:
    def test_possible_leavers_are_linked_customers_without_a_grade_code(self):
        gone = student('09901', applied=None)
        CafeteriaBalance.objects.create(student=gone, balance=Decimal('12.50'))
        still = student('09902', applied=None)
        suffix_only = student('09903', applied=None)

        report = S.link_students_to_loyverse([
            cust('ci09901', 'Duran Castillo Sara', uuid='uuid-09901'),               # no code at all
            cust('ci09902', 'Bravo Vazquez Mayoli-3SEC', address='3SEC', uuid='uuid-09902'),
            cust('ci09903', 'Perez Lopez Ana-1PRI', uuid='uuid-09903'),              # suffix only
        ])

        assert report['possible_leavers'] == [{
            'id': gone.id, 'matricula': '09901', 'loyverse_code': 'ci09901',
            'name': gone.user.full_name, 'grade': gone.grade, 'status': 'active',
            'balance': '12.50'}]
        assert {still.id, suffix_only.id}.isdisjoint({r['id'] for r in report['possible_leavers']})
        gone.refresh_from_db()
        assert gone.status == 'active' and gone.is_active     # flagged, never changed

    def test_unmatched_rows_and_vinculo_changes_carry_the_loyverse_code(self):
        unlinked = StudentProfileFactory(student_id='09910', loyverse_id='')
        missing = StudentProfileFactory(student_id='09911', loyverse_id='')

        report = S.link_students_to_loyverse(
            [cust('ci09910', 'Calles Lopez Sebastian-1PRI', address='1PRI', uuid='u-910')])

        assert report['changes'] == [{
            'matricula': '09910', 'loyverse_code': 'ci09910', 'name': unlinked.user.full_name,
            'loyverse_id': 'u-910', 'matched_by': 'código', 'was': None,
            'field': 'vinculo', 'before': '', 'after': 'u-910', 'action': 'actualizar'}]
        assert [r['loyverse_code'] for r in report['unmatched_students']] == ['09911']
        assert report['unmatched_students'][0]['id'] == missing.id


# ── services.sync_roster: one body for the cron and the button ───────────────


class TestSyncRosterService:
    def test_written_run_stamps_the_state_and_audits_a_summary(self):
        existing = student(applied='Chavez Lopez Juan Antonio')
        CafeteriaBalance.objects.create(student=existing, balance=Decimal('10'))
        customers = [
            cust('ci09932', 'Chavez Lopez Juan Antonio-4PRI', address='4PRI', points=10),
            cust('ci10777', 'Ruiz Soto Ana-2PRI', address='2PRI', points=40),
            cust('170', 'ZP-Nadia', email='nrivera@interlaken.com.mx'),
        ]
        with patch('apps.cafeteria.services.get_all_customers', return_value=customers):
            report = S.sync_roster(customers, commit=True)

        assert report['commit'] is True and report['synced_at'] is not None
        assert LoyverseSyncState.load().last_roster_sync_at == report['synced_at']
        assert report['summary']['created'] == 1 and report['summary']['skipped'] == 1
        entry = AuditLog.objects.get(object_type='cafeteria.loyversesyncstate')
        assert entry.context == 'system:sync_roster'
        assert entry.changes['created'] == 1 and entry.changes['last_roster_sync_at']
        assert S.roster_sync_line(report).startswith('sync_roster (written): ')
        assert '1 created' in S.roster_sync_line(report)

    def test_dry_run_writes_nothing_and_does_not_stamp(self):
        customers = [cust('ci10777', 'Ruiz Soto Ana-2PRI', address='2PRI', points=40)]
        report = S.sync_roster(customers, commit=False)
        assert report['synced_at'] is None
        assert LoyverseSyncState.load().last_roster_sync_at is None
        assert not StudentProfile.objects.filter(student_id='10777').exists()
        assert not AuditLog.objects.exists()
        assert S.roster_sync_line(report).startswith('sync_roster (DRY RUN): ')

    def test_sync_health_exposes_the_stamp(self):
        state = LoyverseSyncState.load()
        with patch('apps.cafeteria.services.loyverse_reachable', return_value=(True, '')):
            assert S.sync_health()['last_roster_sync_at'] is None
            with patch('apps.cafeteria.services.get_all_customers', return_value=[]):
                S.sync_roster([], commit=True)
            state.refresh_from_db()
            assert S.sync_health()['last_roster_sync_at'] == state.last_roster_sync_at


# ── POST /cafeteria/admin/sync-roster/ ───────────────────────────────────────


URL = reverse('admin-sync-roster')


class TestSyncRosterEndpoint:
    def test_parent_forbidden_and_anonymous_unauthorised(self, api_client):
        assert api_client.post(URL, {}, format='json').status_code == 401
        api_client.force_authenticate(ParentFactory())
        assert api_client.post(URL, {}, format='json').status_code == 403

    def test_throttled_on_the_admin_bulk_scope(self, settings):
        assert AdminSyncRosterView.throttle_scope == 'admin-bulk'
        assert settings.REST_FRAMEWORK['DEFAULT_THROTTLE_RATES']['admin-bulk'] == '30/min'

    def test_dry_run_previews_without_writing(self, api_client):
        api_client.force_authenticate(AdminFactory())
        customers = [cust('ci10777', 'Ruiz Soto Ana-2PRI', address='2PRI')]
        with patch('apps.cafeteria.views.get_all_customers', return_value=customers):
            resp = api_client.post(URL, {'dry_run': True}, format='json')
        assert resp.status_code == 200
        body = resp.json()
        assert body['commit'] is False and body['import']['created'] == 1
        assert body['detail'].startswith('sync_roster (DRY RUN)')
        assert not StudentProfile.objects.filter(student_id='10777').exists()

    def test_a_500_customer_store_syncs_with_no_loyverse_call_beyond_the_fetch(self, api_client):
        """The 60 s gunicorn budget: one ``get_all_customers`` (handed in by the
        view, mocked here) and row work only. Any other HTTP call fails the
        test (``_get`` is the only way out to Loyverse)."""
        existing = student(applied='Chavez Lopez Juan Antonio')
        customers = [cust('ci09932', 'Chavez Lopez Juan Antonio-4PRI', address='4PRI')] + [
            cust(f'ci{30000 + i}', f'Apellido Uno Nombre{i}-1PRI', address='1PRI', points=i % 7)
            for i in range(499)]
        cache.set(AdminSyncHealthView.CACHE_KEY, {'stale': 'payload'}, 60)
        api_client.force_authenticate(AdminFactory())

        def no_http(*a, **kw):
            raise AssertionError(f'unexpected Loyverse call {a}')

        with patch('apps.cafeteria.views.get_all_customers', return_value=customers), \
                patch('apps.cafeteria.services.get_all_customers', return_value=customers), \
                patch('apps.cafeteria.services._get', side_effect=no_http):
            resp = api_client.post(URL, {'dry_run': False}, format='json')

        assert resp.status_code == 200, resp.content
        body = resp.json()
        assert body['commit'] is True and body['import']['created'] == 499
        assert body['import']['unchanged'] + body['import']['updated'] == 1
        assert StudentProfile.objects.count() == 500
        assert LoyverseSyncState.load().last_roster_sync_at is not None
        assert body['synced_at'] and body['detail'].startswith('sync_roster (written)')
        # The health panel's minute-long cache was dropped so the light turns green now.
        assert cache.get(AdminSyncHealthView.CACHE_KEY) is None
        existing.refresh_from_db()
        assert existing.grade == '4° Primaria'
        # The button attributes the audit trail to the admin, not to "system".
        summary = AuditLog.objects.get(object_type='cafeteria.loyversesyncstate')
        assert summary.actor is not None and summary.context == 'system:sync_roster'

    def test_loyverse_down_is_a_502_with_detail(self, api_client):
        api_client.force_authenticate(AdminFactory())
        with patch('apps.cafeteria.views.get_all_customers',
                   side_effect=S.LoyverseError('401 Unauthorized')):
            resp = api_client.post(URL, {}, format='json')
        assert resp.status_code == 502
        assert 'Loyverse' in resp.json()['detail']

    def test_sync_health_view_returns_the_stamp_as_iso(self, api_client):
        with patch('apps.cafeteria.services.get_all_customers', return_value=[]):
            S.sync_roster([], commit=True)
        api_client.force_authenticate(AdminFactory())
        with patch('apps.cafeteria.services.loyverse_reachable', return_value=(True, '')):
            data = api_client.get(reverse('admin-sync-health')).json()
        assert data['last_roster_sync_at'] == LoyverseSyncState.load().last_roster_sync_at.isoformat()


# ── Both spellings in the cafetería searches (decision C3.1) ─────────────────


class TestSearchesAcceptBothSpellings:
    def test_balances_q_matches_matricula_loyverse_code_and_name(self, api_client):
        juan = student('09932', 'Juan Antonio', 'Chavez Lopez', applied='Chavez Lopez Juan Antonio')
        ana = student('09933', 'Ana', 'Ruiz Soto', applied='Ruiz Soto Ana')
        for s in (juan, ana):
            CafeteriaBalance.objects.create(student=s, balance=Decimal('5'))
        api_client.force_authenticate(AdminFactory())
        url = reverse('admin-balances')

        def ids(q):
            return [r['student']['id'] for r in api_client.get(url, {'q': q}).json()['results']]

        assert ids('ci09932') == [juan.id]
        assert ids('09932') == [juan.id]
        assert ids('CI09933') == [ana.id]
        assert ids('ruiz') == [ana.id]
        assert ids('') == [juan.id, ana.id]                     # ordered by last name
        row = api_client.get(url, {'q': '09932'}).json()['results'][0]
        assert row['student']['loyverse_code'] == 'ci09932'

    def test_customers_q_matches_either_spelling_against_either_store(self, api_client):
        prefixed = student('09932', applied='Chavez Lopez Juan Antonio')      # card says ci09932
        bare = StudentProfileFactory(student_id='09940', loyverse_id='uuid-bare')
        refresh_all_profiles([cust('09940', 'Soto Ruiz Ana-1PRI', uuid='uuid-bare',
                                   email='ci09940@interlaken.com.mx')])
        api_client.force_authenticate(AdminFactory())
        url = reverse('admin-customers')

        def ids(q):
            return {r['loyverse_id'] for r in api_client.get(url, {'q': q}).json()['results']}

        assert ids('09932') == {prefixed.loyverse_id}
        assert ids('ci09932') == {prefixed.loyverse_id}
        assert ids('ci09940') == {'uuid-bare'}                  # bare card, prefixed search
        assert ids('09940') == {'uuid-bare'}
        assert bare.loyverse_id == 'uuid-bare'
