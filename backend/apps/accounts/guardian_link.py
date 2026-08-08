"""
Admin endpoints to list / link / unlink parent-guardians on a student.

GET    /api/v1/accounts/admin/students/<pk>/guardians/
POST   /api/v1/accounts/admin/students/<pk>/guardians/
DELETE /api/v1/accounts/admin/students/<pk>/guardians/<user_id>/

Linking by email is idempotent (M2M add). If the email is new, a parent User
is created with an unusable password (Google OAuth or password-reset once
SMTP is live). ParentProfile is get_or_create'd so relationship/phone stick.
"""
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from .import_students import IsAdmin, _split_name
from .models import ParentProfile, StudentProfile, User


def _serialize_guardian(user: User) -> dict:
    try:
        profile = user.parent_profile
    except ParentProfile.DoesNotExist:
        profile = None
    return {
        'id': user.id,
        'email': user.email,
        'full_name': user.full_name,
        'first_name': user.first_name,
        'last_name': user.last_name,
        'whatsapp': user.whatsapp,
        'phone': profile.phone if profile else '',
        'relationship': profile.relationship if profile else 'Padre/Madre',
    }


class StudentGuardiansView(APIView):
    """List linked guardians or link a guardian by email (admin only)."""
    permission_classes = [IsAdmin]

    def get(self, request, pk):
        student = get_object_or_404(
            StudentProfile.objects.select_related('user').prefetch_related(
                'parents__parent_profile'),
            pk=pk,
        )
        guardians = [_serialize_guardian(p) for p in student.parents.all()]
        return Response({
            'student': {
                'id': student.id,
                'name': student.user.full_name,
                'student_id': student.student_id,
                'grade': student.grade,
            },
            'guardians': guardians,
        })

    def post(self, request, pk):
        student = get_object_or_404(StudentProfile.objects.select_related('user'), pk=pk)
        email = (request.data.get('email') or '').strip().lower()
        if not email or '@' not in email:
            return Response(
                {'error': 'Proporcione un correo válido del padre/tutor.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        first_name = (request.data.get('first_name') or '').strip()
        last_name = (request.data.get('last_name') or '').strip()
        full_name = (request.data.get('full_name') or '').strip()
        phone = (request.data.get('phone') or '').strip()
        relationship = (request.data.get('relationship') or 'Padre/Madre').strip() or 'Padre/Madre'

        if not first_name and not last_name and full_name:
            first_name, last_name = _split_name(full_name)

        created = False
        parent = User.objects.filter(email=email).first()
        if parent is None:
            parent = User.objects.create_user(
                email=email,
                password=None,
                first_name=first_name or 'Padre/Tutor',
                last_name=last_name or '',
                role=User.Role.PARENT,
            )
            parent.set_unusable_password()
            if phone:
                parent.whatsapp = phone
            parent.save()
            created = True
        else:
            if parent.role != User.Role.PARENT:
                return Response(
                    {'error': f'El correo {email} pertenece a un usuario con rol '
                              f'«{parent.get_role_display()}», no a un padre/tutor.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            # Refresh name/phone when the admin supplies them.
            dirty = []
            if first_name and parent.first_name != first_name:
                parent.first_name = first_name
                dirty.append('first_name')
            if last_name and parent.last_name != last_name:
                parent.last_name = last_name
                dirty.append('last_name')
            if phone and parent.whatsapp != phone:
                parent.whatsapp = phone
                dirty.append('whatsapp')
            if dirty:
                parent.save(update_fields=dirty)

        profile, _ = ParentProfile.objects.get_or_create(user=parent)
        profile_dirty = []
        if phone and profile.phone != phone:
            profile.phone = phone
            profile_dirty.append('phone')
        if relationship and profile.relationship != relationship:
            profile.relationship = relationship
            profile_dirty.append('relationship')
        if profile_dirty:
            profile.save(update_fields=profile_dirty)

        already = student.parents.filter(pk=parent.pk).exists()
        if not already:
            student.parents.add(parent)

        return Response(
            {
                'created_user': created,
                'already_linked': already,
                'guardian': _serialize_guardian(parent),
            },
            status=status.HTTP_201_CREATED if created or not already else status.HTTP_200_OK,
        )


class StudentGuardianDetailView(APIView):
    """Unlink a guardian from a student (admin only). Does not delete the user."""
    permission_classes = [IsAdmin]

    def delete(self, request, pk, user_id):
        student = get_object_or_404(StudentProfile, pk=pk)
        parent = get_object_or_404(User, pk=user_id)
        if not student.parents.filter(pk=parent.pk).exists():
            return Response(
                {'error': 'Ese tutor no está vinculado a este alumno.'},
                status=status.HTTP_404_NOT_FOUND,
            )
        student.parents.remove(parent)
        return Response(status=status.HTTP_204_NO_CONTENT)
