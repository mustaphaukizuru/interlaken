"""Admin-managed family password reset.

POST /api/v1/accounts/admin/users/<pk>/set-password/ is the only way an
imported family (student + guardians, all created with an unusable password
and a synthetic email that receives no mail) can be given a working credential.
Because it rewrites someone else's credential, every rail is asserted here:
who may call it, who may never be targeted, that weak passwords bounce, that
the result actually logs in, that old sessions die, and that it is audited.
"""
import pytest
from django.urls import reverse
from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken, OutstandingToken
from rest_framework_simplejwt.tokens import RefreshToken

from apps.accounts.admin_password import generate_temporary_password
from apps.accounts.factories import (
    AdminFactory,
    ParentFactory,
    StudentUserFactory,
    UserFactory,
)
from apps.accounts.models import User
from apps.core.models import AuditLog

pytestmark = pytest.mark.django_db


def _url(user):
    return reverse('admin-set-password', args=[user.pk])


def _login(api_client, email, password):
    """POST the real token endpoint — proves the password works end to end."""
    return api_client.post(
        reverse('token-obtain'), {'email': email, 'password': password}, format='json')


class TestAdminSetPasswordHappyPath:
    def test_admin_sets_explicit_password_and_target_can_log_in(self, api_client):
        admin = AdminFactory()
        family = ParentFactory(email='familia@test.mx')
        family.set_unusable_password()          # as created by the CSV import
        family.save(update_fields=['password'])

        api_client.force_authenticate(user=admin)
        resp = api_client.post(
            _url(family),
            {'password': 'ClaveFamiliar2026', 'reason': 'Mostrador: mamá sin acceso'},
            format='json',
        )
        assert resp.status_code == 200, resp.data
        # An admin-chosen password must never be echoed back.
        assert 'temporary_password' not in resp.data
        assert resp.data['user']['email'] == 'familia@test.mx'

        family.refresh_from_db()
        assert family.has_usable_password()

        api_client.force_authenticate(user=None)
        login = _login(api_client, 'familia@test.mx', 'ClaveFamiliar2026')
        assert login.status_code == 200, login.data
        assert 'access' in login.data

    def test_generated_temporary_password_is_returned_once_and_logs_in(self, api_client):
        admin = AdminFactory()
        student = StudentUserFactory(email='A1234@alumnos.interlaken.edu.mx')
        student.set_unusable_password()
        student.save(update_fields=['password'])

        api_client.force_authenticate(user=admin)
        resp = api_client.post(_url(student), {}, format='json')
        assert resp.status_code == 200, resp.data

        temp = resp.data['temporary_password']
        assert temp
        assert len(temp.replace('-', '')) == 16

        api_client.force_authenticate(user=None)
        login = _login(api_client, student.email, temp)
        assert login.status_code == 200, login.data

    def test_generated_password_uses_no_lookalike_characters(self):
        """Families read this off a slip or hear it over the phone."""
        banned = set('0O1lI5S8B2Zuv')
        for _ in range(50):
            assert not (set(generate_temporary_password()) & banned)

    def test_two_generated_passwords_differ(self):
        assert generate_temporary_password() != generate_temporary_password()


class TestAdminSetPasswordPermissions:
    def test_anonymous_is_401(self, api_client):
        family = ParentFactory()
        assert api_client.post(_url(family), {}, format='json').status_code == 401

    @pytest.mark.parametrize('role', [User.Role.PARENT, User.Role.STUDENT, User.Role.STAFF])
    def test_non_admin_roles_are_403(self, api_client, role):
        caller = UserFactory(role=role)
        target = ParentFactory()
        api_client.force_authenticate(user=caller)
        resp = api_client.post(_url(target), {}, format='json')
        assert resp.status_code == 403
        target.refresh_from_db()
        assert not target.check_password('anything')

    def test_targeting_another_admin_is_refused(self, api_client):
        admin = AdminFactory()
        peer = AdminFactory(email='peer@test.mx')
        api_client.force_authenticate(user=admin)

        resp = api_client.post(_url(peer), {'password': 'TomaDeCuenta2026'}, format='json')
        assert resp.status_code == 403
        assert 'administradora' in resp.data['detail']
        peer.refresh_from_db()
        assert not peer.check_password('TomaDeCuenta2026')

    def test_targeting_a_superuser_is_refused(self, api_client):
        admin = AdminFactory()
        # Non-admin role but superuser — the role check alone would miss this.
        root = UserFactory(email='root@test.mx', role=User.Role.STAFF, is_superuser=True)
        api_client.force_authenticate(user=admin)

        resp = api_client.post(_url(root), {'password': 'TomaDeCuenta2026'}, format='json')
        assert resp.status_code == 403
        root.refresh_from_db()
        assert not root.check_password('TomaDeCuenta2026')

    def test_unknown_user_is_404(self, api_client):
        api_client.force_authenticate(user=AdminFactory())
        assert api_client.post(
            reverse('admin-set-password', args=[999999]), {}, format='json'
        ).status_code == 404


class TestAdminSetPasswordValidation:
    @pytest.mark.parametrize('weak', ['1234', 'password', '12345678901234'])
    def test_weak_password_is_rejected_with_a_message(self, api_client, weak):
        admin = AdminFactory()
        family = ParentFactory(email='debil@test.mx')
        api_client.force_authenticate(user=admin)

        resp = api_client.post(_url(family), {'password': weak}, format='json')
        assert resp.status_code == 400, resp.data
        assert resp.data['password']          # at least one validator message
        assert isinstance(resp.data['password'][0], str)

        family.refresh_from_db()
        assert not family.check_password(weak)

    def test_password_similar_to_the_account_email_is_rejected(self, api_client):
        admin = AdminFactory()
        family = ParentFactory(email='rodriguezfamilia@test.mx')
        api_client.force_authenticate(user=admin)

        resp = api_client.post(
            _url(family), {'password': 'rodriguezfamilia'}, format='json')
        assert resp.status_code == 400, resp.data


class TestAdminSetPasswordRevokesSessions:
    def test_outstanding_refresh_tokens_are_blacklisted(self, api_client):
        admin = AdminFactory()
        family = ParentFactory(email='sesiones@test.mx')
        # Two live sessions, as issued by cookies.issue_session / the token view.
        old_tokens = [RefreshToken.for_user(family) for _ in range(2)]
        assert OutstandingToken.objects.filter(user=family).count() == 2
        assert BlacklistedToken.objects.filter(token__user=family).count() == 0

        api_client.force_authenticate(user=admin)
        resp = api_client.post(_url(family), {}, format='json')
        assert resp.status_code == 200, resp.data
        assert resp.data['sessions_revoked'] == 2

        assert BlacklistedToken.objects.filter(token__user=family).count() == 2
        # And the stolen refresh token is now dead at the API surface.
        from rest_framework_simplejwt.exceptions import TokenError
        for raw in old_tokens:
            with pytest.raises(TokenError):
                RefreshToken(str(raw)).check_blacklist()

    def test_other_users_sessions_are_untouched(self, api_client):
        admin = AdminFactory()
        family = ParentFactory(email='objetivo@test.mx')
        bystander = ParentFactory(email='vecino@test.mx')
        RefreshToken.for_user(family)
        RefreshToken.for_user(bystander)

        api_client.force_authenticate(user=admin)
        assert api_client.post(_url(family), {}, format='json').status_code == 200

        assert BlacklistedToken.objects.filter(token__user=bystander).count() == 0


class TestAdminSetPasswordAudit:
    def test_audit_row_records_actor_target_and_reason(self, api_client):
        admin = AdminFactory(email='directora@test.mx')
        family = ParentFactory(email='auditada@test.mx')
        api_client.force_authenticate(user=admin)

        resp = api_client.post(
            _url(family),
            {'password': 'ClaveFamiliar2026', 'reason': 'Solicitud en recepción'},
            format='json',
        )
        assert resp.status_code == 200, resp.data

        entry = AuditLog.objects.filter(
            context='accounts.set_password',
            object_type='accounts.user',
            object_id=str(family.pk),
        ).first()
        assert entry is not None
        assert entry.actor_id == admin.pk
        assert entry.actor_label == 'directora@test.mx'
        assert entry.changes['reason'] == 'Solicitud en recepción'
        assert entry.changes['source'] == 'admin-supplied'
        assert entry.changes['target_email'] == 'auditada@test.mx'

    def test_audit_never_stores_the_password(self, api_client):
        admin = AdminFactory()
        family = ParentFactory(email='secreta@test.mx')
        api_client.force_authenticate(user=admin)

        resp = api_client.post(_url(family), {}, format='json')
        temp = resp.data['temporary_password']

        for entry in AuditLog.objects.filter(object_id=str(family.pk)):
            assert temp not in str(entry.changes)
        entry = AuditLog.objects.get(context='accounts.set_password',
                                     object_id=str(family.pk))
        assert entry.changes['source'] == 'generated'
        assert entry.changes['password'] == ['[redacted]', '[redacted]']

    def test_audit_failure_does_not_break_the_reset(self, api_client, monkeypatch):
        """Fail-open: the credential change is the important half."""
        admin = AdminFactory()
        family = ParentFactory(email='sinauditoria@test.mx')

        import apps.core.audit as audit_module

        def _boom(*args, **kwargs):
            raise RuntimeError('audit backend down')

        monkeypatch.setattr(audit_module, 'record', _boom)
        api_client.force_authenticate(user=admin)

        resp = api_client.post(_url(family), {}, format='json')
        assert resp.status_code == 200, resp.data
        family.refresh_from_db()
        assert family.check_password(resp.data['temporary_password'])


class TestAdminSetPasswordThrottle:
    def test_scope_caps_a_single_admin_at_20_per_minute(self, api_client, settings):
        """One compromised admin session must not be able to rewrite the whole
        school's credentials in a loop."""
        from django.core.cache import cache

        # Fast hasher: this test issues 21 resets and PBKDF2 would dominate it.
        settings.PASSWORD_HASHERS = ['django.contrib.auth.hashers.MD5PasswordHasher']
        settings.RATELIMIT_ENABLE = True
        cache.clear()

        admin = AdminFactory()
        family = ParentFactory(email='rafagas@test.mx')
        api_client.force_authenticate(user=admin)

        codes = [
            api_client.post(_url(family), {}, format='json').status_code
            for _ in range(21)
        ]
        assert codes[:20] == [200] * 20
        assert codes[20] == 429
