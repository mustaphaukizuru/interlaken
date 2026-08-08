"""Admin guardian link/unlink on a student."""

import pytest
from django.urls import reverse

from apps.accounts.factories import (
    AdminFactory,
    ParentFactory,
    StudentProfileFactory,
    StudentUserFactory,
)
from apps.accounts.models import ParentProfile, User


@pytest.fixture
def admin_user(db):
    return AdminFactory()


@pytest.mark.django_db
class TestStudentGuardians:
    def test_list_guardians(self, api_client, admin_user):
        parent = ParentFactory(email='tutor1@test.mx')
        ParentProfile.objects.create(user=parent, phone='555', relationship='Madre')
        student = StudentProfileFactory(parents=[parent])
        api_client.force_authenticate(admin_user)
        resp = api_client.get(reverse('student-guardians', kwargs={'pk': student.pk}))
        assert resp.status_code == 200
        assert resp.data['student']['id'] == student.pk
        assert resp.data['student']['email'] == student.user.email
        assert resp.data['student']['user_id'] == student.user_id
        assert len(resp.data['guardians']) == 1
        assert resp.data['guardians'][0]['email'] == 'tutor1@test.mx'
        assert resp.data['guardians'][0]['relationship'] == 'Madre'
        assert resp.data['guardians'][0]['is_self'] is False

    def test_link_creates_parent_and_profile(self, api_client, admin_user):
        student = StudentProfileFactory()
        api_client.force_authenticate(admin_user)
        resp = api_client.post(
            reverse('student-guardians', kwargs={'pk': student.pk}),
            {
                'email': 'nuevo@familia.mx',
                'full_name': 'Ana García',
                'phone': '5512345678',
                'relationship': 'Madre',
            },
            format='json',
        )
        assert resp.status_code == 201
        assert resp.data['created_user'] is True
        assert resp.data['already_linked'] is False
        parent = User.objects.get(email='nuevo@familia.mx')
        assert parent.role == User.Role.PARENT
        assert not parent.has_usable_password()
        assert parent in student.parents.all()
        assert ParentProfile.objects.filter(user=parent, relationship='Madre').exists()

    def test_link_existing_parent_idempotent(self, api_client, admin_user):
        parent = ParentFactory(email='existe@test.mx')
        student = StudentProfileFactory()
        api_client.force_authenticate(admin_user)
        url = reverse('student-guardians', kwargs={'pk': student.pk})
        first = api_client.post(url, {'email': 'existe@test.mx'}, format='json')
        second = api_client.post(url, {'email': 'existe@test.mx'}, format='json')
        assert first.status_code == 201
        assert first.data['created_user'] is False
        assert second.status_code == 200
        assert second.data['already_linked'] is True
        assert student.parents.filter(pk=parent.pk).count() == 1

    def test_rejects_unrelated_student_email(self, api_client, admin_user):
        other = StudentUserFactory(email='otro-alumno@test.mx')
        student = StudentProfileFactory()
        api_client.force_authenticate(admin_user)
        resp = api_client.post(
            reverse('student-guardians', kwargs={'pk': student.pk}),
            {'email': other.email},
            format='json',
        )
        assert resp.status_code == 400
        assert 'rol' in resp.data['error'].lower()

    def test_rejects_admin_email(self, api_client, admin_user):
        student = StudentProfileFactory()
        api_client.force_authenticate(admin_user)
        resp = api_client.post(
            reverse('student-guardians', kwargs={'pk': student.pk}),
            {'email': admin_user.email},
            format='json',
        )
        assert resp.status_code == 400
        assert 'rol' in resp.data['error'].lower()

    def test_link_student_self_guardian(self, api_client, admin_user):
        """School-email family login: alumno may be linked as self-guardian."""
        student = StudentProfileFactory()
        api_client.force_authenticate(admin_user)
        resp = api_client.post(
            reverse('student-guardians', kwargs={'pk': student.pk}),
            {'email': student.user.email},
            format='json',
        )
        assert resp.status_code == 201
        assert resp.data['created_user'] is False
        assert resp.data['already_linked'] is False
        assert resp.data['guardian']['is_self'] is True
        assert resp.data['guardian']['relationship'] == 'Cuenta familiar'
        assert student.user in student.parents.all()
        assert not ParentProfile.objects.filter(user=student.user).exists()

        # Idempotent re-link
        again = api_client.post(
            reverse('student-guardians', kwargs={'pk': student.pk}),
            {'email': student.user.email},
            format='json',
        )
        assert again.status_code == 200
        assert again.data['already_linked'] is True
        assert again.data['guardian']['is_self'] is True

    def test_list_includes_self_guardian(self, api_client, admin_user):
        student = StudentProfileFactory()
        student.parents.add(student.user)
        api_client.force_authenticate(admin_user)
        resp = api_client.get(reverse('student-guardians', kwargs={'pk': student.pk}))
        assert resp.status_code == 200
        self_g = next(g for g in resp.data['guardians'] if g['is_self'])
        assert self_g['email'] == student.user.email
        assert self_g['relationship'] == 'Cuenta familiar'

    def test_unlink(self, api_client, admin_user):
        parent = ParentFactory()
        student = StudentProfileFactory(parents=[parent])
        api_client.force_authenticate(admin_user)
        resp = api_client.delete(
            reverse(
                'student-guardian-detail',
                kwargs={'pk': student.pk, 'user_id': parent.pk},
            ),
        )
        assert resp.status_code == 204
        assert parent not in student.parents.all()
        assert User.objects.filter(pk=parent.pk).exists()

    def test_parent_cannot_access(self, api_client):
        parent = ParentFactory()
        student = StudentProfileFactory(parents=[parent])
        api_client.force_authenticate(parent)
        resp = api_client.get(reverse('student-guardians', kwargs={'pk': student.pk}))
        assert resp.status_code == 403
