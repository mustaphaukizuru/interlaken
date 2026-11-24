"""
Profile photo upload (BACKLOG P1-F2).

POST   /accounts/me/avatar/   multipart {file}: the client crops square; the
                              server re-encodes to 256x256 WebP (strips EXIF,
                              caps size) and stores it on the default storage
                              (local disk in dev; Supabase/S3 when the bucket
                              env vars are set, see settings STORAGES).
DELETE /accounts/me/avatar/   removes the photo (falls back to Google picture).
GET    /accounts/avatar/<user_id>/<token>/  serves the file through Django so
                              the bucket stays private; token = short hash so
                              URLs are unguessable and cache-busted per change.
"""
from __future__ import annotations

import hashlib
import io
import uuid

from django.conf import settings
from django.http import FileResponse, Http404
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import User
from .serializers import UserSerializer

MAX_UPLOAD = 5 * 1024 * 1024
SIZE = 256
ALLOWED = ('image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic')


def avatar_token(user: User) -> str:
    name = user.avatar_file.name if user.avatar_file else ''
    return hashlib.sha256(f'{settings.SECRET_KEY}:{user.pk}:{name}'.encode()).hexdigest()[:12]


def avatar_url(user: User) -> str:
    """Uploaded photo (proxied) or the Google picture URL, or ''."""
    if user.avatar_file:
        return f'/api/v1/accounts/avatar/{user.pk}/{avatar_token(user)}/'
    return user.avatar or ''


# Pixels decoded at full size (PNG, WebP, GIF...). The 5 MB file cap does not
# bound memory: a 9400x9400 PNG under 5 MB decoded to ~380 MB. A JPEG (every
# phone photo) is decoded already scaled down (``draft``), so a 24 or 48 MP
# camera photo still works and costs a few MB.
MAX_DECODE_PIXELS = 4096 * 4096


class ImageTooLarge(ValueError):
    """The picture has more pixels than ``MAX_DECODE_PIXELS`` after any draft."""


def _square_webp(data: bytes) -> bytes:
    from PIL import Image, ImageOps
    img = Image.open(io.BytesIO(data))  # reads the header only
    # JPEG only: let the decoder scale by 1/2..1/8 to just above what we keep.
    img.draft(img.mode, (SIZE * 2, SIZE * 2))
    width, height = img.size
    if width * height > MAX_DECODE_PIXELS:
        raise ImageTooLarge(f'{width}x{height}')
    img = ImageOps.exif_transpose(img)
    if img.mode not in ('RGB', 'RGBA'):
        img = img.convert('RGB')
    img = ImageOps.fit(img, (SIZE, SIZE), Image.LANCZOS, centering=(0.5, 0.5))
    out = io.BytesIO()
    img.save(out, format='WEBP', quality=85, method=4)
    return out.getvalue()


def store_avatar(user: User, f) -> Response | None:
    """Validate, square-crop and save ``f`` as ``user``'s photo. A 400 Response on bad input, else None.

    Shared by «me» (this module) and the family upload of a child's card photo
    (cafeteria.views.StudentPhotoView)."""
    if not f:
        return Response({'file': ['Seleccione una imagen.']}, status=status.HTTP_400_BAD_REQUEST)
    if f.size > MAX_UPLOAD:
        return Response({'file': ['La imagen supera 5 MB.']}, status=status.HTTP_400_BAD_REQUEST)
    if (f.content_type or '') not in ALLOWED:
        return Response({'file': ['Use una imagen JPG, PNG o WebP.']}, status=status.HTTP_400_BAD_REQUEST)
    try:
        data = _square_webp(f.read())
    except ImageTooLarge:
        return Response({'file': ['La imagen es demasiado grande (máximo 4096 × 4096 píxeles). '
                                  'Use una foto más pequeña.']},
                        status=status.HTTP_400_BAD_REQUEST)
    except Exception:  # noqa: BLE001 - Pillow raises many types for corrupt input
        return Response({'file': ['No se pudo leer la imagen.']}, status=status.HTTP_400_BAD_REQUEST)
    old = user.avatar_file.name if user.avatar_file else ''
    from django.core.files.base import ContentFile
    user.avatar_file.save(f'avatars/{uuid.uuid4().hex}.webp', ContentFile(data), save=False)
    user.save(update_fields=['avatar_file'])
    if old:
        try:
            user.avatar_file.storage.delete(old)
        except Exception:  # noqa: BLE001
            pass
    return None


def remove_avatar(user: User) -> None:
    """Drop the uploaded photo (the Google picture, if any, shows again)."""
    if user.avatar_file:
        name = user.avatar_file.name
        user.avatar_file = None
        user.save(update_fields=['avatar_file'])
        try:
            user.avatar_file.storage.delete(name)
        except Exception:  # noqa: BLE001
            pass


class MyAvatarView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        from .profile_lock import locked_response, profile_locked

        if profile_locked(request.user):
            return locked_response()
        error = store_avatar(request.user, request.FILES.get('file'))
        if error is not None:
            return error
        return Response(UserSerializer(request.user, context={'request': request}).data)

    def delete(self, request):
        from .profile_lock import locked_response, profile_locked

        if profile_locked(request.user):
            return locked_response()
        remove_avatar(request.user)
        return Response(UserSerializer(request.user, context={'request': request}).data)


class AvatarServeView(APIView):
    """Public by token: the token is unguessable, the content is a profile photo
    the user chose to show to the school community."""
    permission_classes = [permissions.AllowAny]

    def get(self, request, user_id, token):
        user = User.objects.filter(pk=user_id).first()
        if user is None or not user.avatar_file or token != avatar_token(user):
            raise Http404
        resp = FileResponse(user.avatar_file.open('rb'), content_type='image/webp')
        resp['Cache-Control'] = 'public, max-age=31536000, immutable'
        return resp
