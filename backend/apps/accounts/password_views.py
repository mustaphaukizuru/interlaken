"""Notification preference endpoints.

School policy (2026-08-22): there is NO self-service password reset or change.
Families request a new password by WhatsApp or email and an admin sets it via
``AdminSetPasswordView`` (apps.accounts.admin_password). The former
``password-reset/``, ``password-reset/confirm/`` and ``set-password/``
endpoints were removed on purpose; do not reintroduce them.
"""
from rest_framework import permissions
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import NotificationPreference
from .serializers import NotificationPreferenceSerializer


class NotificationPreferenceView(APIView):
    """GET/PATCH /api/v1/accounts/notification-preferences/"""
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        prefs = NotificationPreference.for_user(request.user)
        return Response(NotificationPreferenceSerializer(prefs).data)

    def patch(self, request):
        prefs = NotificationPreference.for_user(request.user)
        ser = NotificationPreferenceSerializer(prefs, data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        ser.save()
        return Response(ser.data)
