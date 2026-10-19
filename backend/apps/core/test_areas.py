"""Staff console areas: a staff account reaches exactly the console it was given.

``role=admin`` uses the whole console; a ``role=staff`` account with
``staff_areas`` (secretaría, recepción, cafetería...) uses only the endpoints of
those areas (``apps/core/areas.py``). Everything here is enforced by the API;
the SPA merely hides what would be refused.
"""
import inspect
from io import StringIO

import pytest
from django.core.management import CommandError, call_command
from django.urls import get_resolver
from django.urls.resolvers import URLPattern, URLResolver

from apps.accounts.factories import AdminFactory, ParentFactory, StudentProfileFactory, UserFactory
from apps.accounts.models import User
from apps.core.areas import AREAS, PUESTOS, as_tuple, user_areas
from apps.core.models import AuditLog
from apps.core.permissions import IsAdmin

pytestmark = pytest.mark.django_db

# Admin-console endpoints that are deliberately NOT delegable to any area:
# people and their roles, settings, the public site, privacy, the audit trail,
# the new school year, account merges and the emergency broadcast.
ADMIN_ONLY = {
    'apps.accounts.merge.GuardianMergePreviewView',
    'apps.accounts.merge.GuardianMergeView',
    'apps.accounts.school_year.SchoolYearPreviewView',
    'apps.accounts.school_year.SchoolYearRunView',
    'apps.accounts.staff_users.StaffBulkView',
    'apps.accounts.staff_users.StaffDetailView',
    'apps.accounts.staff_users.StaffExportView',
    'apps.accounts.staff_users.StaffImportTemplateView',
    'apps.accounts.staff_users.StaffImportView',
    'apps.accounts.staff_users.StaffListCreateView',
    'apps.accounts.staff_users.StaffResetPasswordView',
    'apps.content.forms.FormBulkView',
    'apps.content.forms.FormExportView',
    'apps.content.navigation.AdminRedirectDetailView',
    'apps.content.navigation.AdminRedirectsBulkView',
    'apps.content.navigation.AdminRedirectsExportView',
    'apps.content.navigation.AdminRedirectsImportTemplateView',
    'apps.content.navigation.AdminRedirectsImportView',
    'apps.content.navigation.AdminRedirectsView',
    'apps.content.pages.PageBulkView',
    'apps.content.pages.PageExportView',
    'apps.content.pages.PagePublishView',
    'apps.content.pages.PageVersionsView',
    'apps.content.views.AdminSiteSettingsView',
    'apps.content.views.AdminTestimonialDetailView',
    'apps.content.views.AdminTestimonialsBulkView',
    'apps.content.views.AdminTestimonialsExportView',
    'apps.content.views.AdminTestimonialsView',
    'apps.core.views.AdminAuditExportView',
    'apps.core.views.AdminAuditLogView',
    'apps.legal.views.AdminArcoBulkView',
    'apps.legal.views.AdminArcoExportView',
    'apps.legal.views.AdminArcoIntakeView',
    'apps.legal.views.AdminArcoListView',
    'apps.legal.views.AdminArcoStatusView',
    'apps.portal.views.EmergencyBroadcastView',
}


def _admin_views():
    """Every routed view that can apply ``IsAdmin``: through ``permission_classes``
    or by returning ``IsAdmin()`` from ``get_permissions`` for some methods."""
    found = {}

    def gated(cls):
        perms = getattr(cls, 'permission_classes', None) or []
        if any(isinstance(x, type) and issubclass(x, IsAdmin) for x in perms):
            return True
        for klass in cls.__mro__:
            method = klass.__dict__.get('get_permissions')
            if method is not None:
                try:
                    return 'IsAdmin()' in inspect.getsource(method)
                except (OSError, TypeError):
                    return False
        return False

    def walk(patterns):
        for p in patterns:
            if isinstance(p, URLResolver):
                walk(p.url_patterns)
            elif isinstance(p, URLPattern):
                cls = getattr(p.callback, 'view_class', None) or getattr(p.callback, 'cls', None)
                if cls is not None and gated(cls):
                    found[f'{cls.__module__}.{cls.__name__}'] = cls

    walk(get_resolver().url_patterns)
    return found


def staff(*areas, title='', **kw):
    return UserFactory(role=User.Role.STAFF, staff_areas=list(areas), staff_title=title, **kw)


def puesto(key):
    title, areas = PUESTOS[key]
    return staff(*areas, title=title)


# ── every console endpoint is a decision ─────────────────────────────────────
def test_every_admin_endpoint_names_its_area_or_is_admin_only():
    undecided, bogus, both = [], [], []
    for path, cls in _admin_views().items():
        declared = as_tuple(getattr(cls, 'admin_area', None)) + as_tuple(getattr(cls, 'admin_area_read', None))
        if not declared and path not in ADMIN_ONLY:
            undecided.append(path)
        if declared and path in ADMIN_ONLY:
            both.append(path)
        bogus += [f'{path}: {a}' for a in declared if a not in AREAS]
    assert not undecided, f'Give these an admin_area or list them in ADMIN_ONLY: {undecided}'
    assert not bogus and not both, (bogus, both)
    assert ADMIN_ONLY <= set(_admin_views()), 'ADMIN_ONLY names an endpoint that no longer exists'


def test_effective_areas():
    assert user_areas(AdminFactory()) == frozenset(AREAS)
    assert user_areas(staff('cafeteria', 'bogus')) == {'cafeteria'}
    assert user_areas(staff()) == frozenset()                       # a teacher
    assert user_areas(staff('cafeteria', is_active=False)) == frozenset()
    parent = ParentFactory()
    parent.staff_areas = ['cafeteria']                               # never for a family
    assert user_areas(parent) == frozenset()


# ── who gets in where ────────────────────────────────────────────────────────
SECRETARIA_OK = ['/api/v1/admissions/pre-register/', '/api/v1/bookings/admin/bookings/',
                 '/api/v1/accounts/admin/password-requests/', '/api/v1/core/admin/contact-messages/',
                 '/api/v1/portal/admin/announcements/', '/api/v1/content/admin/calendar/']
CAFETERIA_OK = ['/api/v1/cafeteria/admin/topups/', '/api/v1/cafeteria/admin/balances/',
                '/api/v1/payments/admin/']
ADMIN_ONLY_URLS = ['/api/v1/accounts/admin/staff/', '/api/v1/content/admin/settings/',
                   '/api/v1/core/admin/audit/', '/api/v1/legal/admin/arco/']


@pytest.mark.parametrize('url', SECRETARIA_OK)
def test_secretaria_reaches_its_areas(api_client, url):
    api_client.force_authenticate(user=puesto('secretaria'))
    assert api_client.get(url).status_code == 200


@pytest.mark.parametrize('url', CAFETERIA_OK + ADMIN_ONLY_URLS)
def test_secretaria_is_kept_out_of_money_and_admin(api_client, url):
    api_client.force_authenticate(user=puesto('secretaria'))
    assert api_client.get(url).status_code == 403


@pytest.mark.parametrize('url', CAFETERIA_OK)
def test_cafeteria_reaches_its_area(api_client, url):
    api_client.force_authenticate(user=puesto('cafeteria'))
    assert api_client.get(url).status_code == 200


@pytest.mark.parametrize('url', SECRETARIA_OK + ADMIN_ONLY_URLS)
def test_cafeteria_is_kept_out_of_the_rest(api_client, url):
    api_client.force_authenticate(user=puesto('cafeteria'))
    assert api_client.get(url).status_code == 403


def test_recepcion_reads_forms_but_cannot_edit_them(api_client):
    api_client.force_authenticate(user=puesto('recepcion'))
    assert api_client.get('/api/v1/bookings/admin/bookings/').status_code == 200
    assert api_client.get('/api/v1/content/admin/forms/').status_code == 200
    assert api_client.post('/api/v1/content/admin/forms/', {'title': 'x'}, format='json').status_code == 403
    assert api_client.get('/api/v1/portal/admin/announcements/').status_code == 403


@pytest.mark.parametrize('url', SECRETARIA_OK + CAFETERIA_OK)
def test_a_teacher_has_no_console(api_client, url):
    api_client.force_authenticate(user=staff())
    assert api_client.get(url).status_code == 403


def test_admin_keeps_everything(api_client):
    api_client.force_authenticate(user=AdminFactory())
    for url in SECRETARIA_OK + CAFETERIA_OK + ADMIN_ONLY_URLS:
        assert api_client.get(url).status_code == 200, url


def test_roster_and_student_file_follow_the_alumnos_area(api_client):
    StudentProfileFactory()
    api_client.force_authenticate(user=puesto('secretaria'))
    assert api_client.get('/api/v1/accounts/students/').data['count'] == 1
    api_client.force_authenticate(user=puesto('cafeteria'))
    assert api_client.get('/api/v1/accounts/students/').data['count'] == 0


def test_medical_data_stays_masked_for_staff(api_client):
    student = StudentProfileFactory()
    api_client.force_authenticate(user=puesto('secretaria'))
    r = api_client.get(f'/api/v1/accounts/students/{student.pk}/')
    assert r.status_code == 200 and r.data['medical_masked'] == 'role'


def test_badges_only_count_the_areas_held(api_client):
    api_client.force_authenticate(user=puesto('cafeteria'))
    keys = set(api_client.get('/api/v1/core/badges/').data)
    assert keys == {'notificaciones', 'cafeteria'}


def test_me_reports_the_effective_areas(api_client):
    api_client.force_authenticate(user=puesto('recepcion'))
    me = api_client.get('/api/v1/accounts/me/').data
    assert me['staff_areas'] == ['visitas', 'mensajes'] and me['staff_title'] == 'Recepción'
    api_client.force_authenticate(user=AdminFactory())
    assert api_client.get('/api/v1/accounts/me/').data['staff_areas'] == list(AREAS)


# ── Personal: admins give the areas ──────────────────────────────────────────
STAFF_URL = '/api/v1/accounts/admin/staff/'


def test_admin_creates_a_secretary_from_the_puesto(admin_client):
    r = admin_client.post(STAFF_URL, {'email': 'secre@test.mx', 'first_name': 'Sara',
                                      'role': 'staff', 'puesto': 'secretaria'}, format='json')
    assert r.status_code == 201, r.data
    assert r.data['staff_title'] == 'Secretaría'
    assert r.data['staff_areas'] == list(PUESTOS['secretaria'][1])
    assert 'temporary_password' in r.data


def test_admin_edits_areas_and_unknown_ones_are_refused(admin_client):
    target = staff('visitas', title='Recepción')
    url = f'{STAFF_URL}{target.pk}/'
    r = admin_client.patch(url, {'staff_areas': ['visitas', 'cafeteria'], 'staff_title': 'Caja y recepción'},
                           format='json')
    assert r.status_code == 200 and r.data['staff_areas'] == ['visitas', 'cafeteria']
    assert admin_client.patch(url, {'staff_areas': ['root']}, format='json').status_code == 400
    assert admin_client.patch(url, {'staff_areas': 'cafeteria'}, format='json').status_code == 400
    log = AuditLog.objects.filter(object_id=str(target.pk), context='portal: edición de personal').latest('pk')
    assert log.changes['staff_areas']['to'] == ['visitas', 'cafeteria']


def test_promotion_to_admin_clears_the_stored_areas(admin_client):
    target = staff('cafeteria', title='Cafetería')
    r = admin_client.patch(f'{STAFF_URL}{target.pk}/', {'role': 'admin'}, format='json')
    assert r.status_code == 200
    target.refresh_from_db()
    assert target.role == User.Role.ADMIN and target.staff_areas == []


def test_staff_cannot_grant_themselves_areas(api_client):
    me = puesto('cafeteria')
    api_client.force_authenticate(user=me)
    assert api_client.patch(f'{STAFF_URL}{me.pk}/', {'staff_areas': list(AREAS)}, format='json').status_code == 403
    api_client.patch('/api/v1/accounts/me/', {'staff_areas': list(AREAS), 'role': 'admin'}, format='json')
    me.refresh_from_db()
    assert me.staff_areas == ['cafeteria'] and me.role == User.Role.STAFF


# ── the super administrator ──────────────────────────────────────────────────
def test_grant_superadmin_is_idempotent_audited_and_never_sets_a_password():
    out = StringIO()
    with pytest.raises(CommandError, match='--create'):
        call_command('grant_superadmin', 'jefe@test.mx', stdout=out)
    call_command('grant_superadmin', 'jefe@test.mx', '--create', '--first-name', 'Rene', stdout=out)
    user = User.objects.get(email='jefe@test.mx')
    assert (user.role, user.is_staff, user.is_superuser, user.is_active) == ('admin', True, True, True)
    assert not user.has_usable_password()
    assert AuditLog.objects.filter(context='ops.grant_superadmin', object_id=str(user.pk)).count() == 1

    call_command('grant_superadmin', 'JEFE@test.mx', stdout=out)
    assert 'sin cambios' in out.getvalue()
    assert AuditLog.objects.filter(context='ops.grant_superadmin', object_id=str(user.pk)).count() == 1
