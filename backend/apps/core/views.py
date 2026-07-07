"""
Core API views: public contact form.
"""
from django.conf import settings
from django.core.mail import send_mail
from django.utils.decorators import method_decorator
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.ratelimit import ratelimit
from .serializers import ContactMessageSerializer


@method_decorator(ratelimit('contact', '5/m', method='POST'), name='dispatch')
class ContactCreateView(APIView):
    """POST /api/v1/contact/ — Save a public contact message and notify the school."""
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        serializer = ContactMessageSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        message = serializer.save()

        recipient = getattr(settings, 'CONTACT_EMAIL', '') or settings.DEFAULT_FROM_EMAIL
        send_mail(
            subject=f'[Contacto web] {message.subject}',
            message=(
                f'Nombre: {message.name}\n'
                f'Correo: {message.email}\n\n'
                f'{message.message}'
            ),
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[recipient],
            fail_silently=True,
        )

        return Response(serializer.data, status=status.HTTP_201_CREATED)
