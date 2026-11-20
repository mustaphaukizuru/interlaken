"""
legal/notices.py: the console «Aviso de privacidad» (admin only).

The privacy notice is versioned for consent: every ConsentRecord and every
Registration points at the exact PrivacyNoticeVersion the family accepted.
This API lets Dirección write the next version without Django admin:

  GET    /legal/admin/notices/                 versions + how many consents each holds
  POST   /legal/admin/notices/                 «Nueva versión»: a draft copied from the current one
  GET    /legal/admin/notices/<id>/            one version (with its text)
  PATCH  /legal/admin/notices/<id>/            edit a draft (published versions are read-only)
  DELETE /legal/admin/notices/<id>/            discard a draft
  POST   /legal/admin/notices/<id>/publish/    make the draft the current version

Publishing never touches consent rows (they are immutable and keep pointing
at the version they accepted). It does what the data migrations that
published 2026.1 and 2026.3 did: the new version becomes the only active
one. Re-consent is the existing rule, unchanged: services.needs_acceptance
asks a family to accept again when their latest acceptance is for another
version. Every change writes an AuditLog row (context ``legal.notice``).
"""
from __future__ import annotations

import re

from django.db import IntegrityError, transaction
from django.db.models import Count
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import generics, serializers, status
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.admissions.models import Registration
from apps.core.audit import record
from apps.core.permissions import IsAdmin

from .models import PrivacyNoticeVersion

VERSION_RE = re.compile(r'^[A-Za-z0-9][A-Za-z0-9.\-]{0,29}$')
MAX_BODY = 60_000
EDITABLE = ('version', 'title', 'body', 'integral_notice_url', 'effective_date')


def notice_status(notice: PrivacyNoticeVersion, current_id: int | None) -> str:
    """vigente (the one families accept now), borrador (never public) or anterior."""
    if notice.pk == current_id:
        return 'vigente'
    if notice.is_active or notice.published_at or notice.consent_count or notice.registration_count:
        return 'anterior'
    return 'borrador'


def annotated():
    """Versions with their consent and registration counts (two aggregates, one query)."""
    regs = dict(Registration.objects.exclude(privacy_notice_version=None)
                .values_list('privacy_notice_version').annotate(n=Count('id')).values_list('privacy_notice_version', 'n'))
    rows = list(PrivacyNoticeVersion.objects.annotate(consent_count=Count('consent_records')).order_by('-created_at'))
    for n in rows:
        n.registration_count = regs.get(n.pk, 0)
    return rows


class NoticeSerializer(serializers.ModelSerializer):
    status = serializers.SerializerMethodField()
    consent_count = serializers.SerializerMethodField()
    registration_count = serializers.SerializerMethodField()

    class Meta:
        model = PrivacyNoticeVersion
        fields = ['id', 'version', 'title', 'body', 'integral_notice_url', 'effective_date',
                  'is_active', 'status', 'created_at', 'published_at', 'consent_count', 'registration_count']
        read_only_fields = ['id', 'is_active', 'status', 'created_at', 'published_at', 'consent_count', 'registration_count']

    def _current_id(self):
        cur = self.context.get('current_id', 'unset')
        if cur == 'unset':
            current = PrivacyNoticeVersion.current()
            cur = current.pk if current else None
        return cur

    def get_consent_count(self, obj):
        n = getattr(obj, 'consent_count', None)
        return n if n is not None else obj.consent_records.count()

    def get_registration_count(self, obj):
        n = getattr(obj, 'registration_count', None)
        return n if n is not None else Registration.objects.filter(privacy_notice_version=obj).count()

    def get_status(self, obj):
        obj.consent_count = self.get_consent_count(obj)
        obj.registration_count = self.get_registration_count(obj)
        return notice_status(obj, self._current_id())

    def validate_version(self, value):
        value = (value or '').strip()
        if not VERSION_RE.match(value):
            raise serializers.ValidationError('Use letras, números, puntos o guiones (por ejemplo 2027.1).')
        qs = PrivacyNoticeVersion.objects.filter(version=value)
        if self.instance is not None:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError('Ya existe una versión con ese número.')
        return value

    def validate_title(self, value):
        value = (value or '').strip()
        if not value:
            raise serializers.ValidationError('Escriba el título del aviso.')
        return value

    def validate_body(self, value):
        value = (value or '').replace('\r\n', '\n').strip()
        if len(value) > MAX_BODY:
            raise serializers.ValidationError(f'El texto supera {MAX_BODY:,} caracteres.')
        return value

    def validate_integral_notice_url(self, value):
        value = (value or '').strip()
        if value and not value.startswith('https://'):
            raise serializers.ValidationError('El enlace debe empezar con https://.')
        return value


class NoticeSummarySerializer(NoticeSerializer):
    """The list leaves the text out (each version is several pages long)."""

    class Meta(NoticeSerializer.Meta):
        fields = [f for f in NoticeSerializer.Meta.fields if f != 'body']


def next_version(base: str) -> str:
    """A free version number after `base` ('2026.3' → '2026.4', else '<year>.1')."""
    taken = set(PrivacyNoticeVersion.objects.values_list('version', flat=True))
    m = re.match(r'^(\d{4})\.(\d+)$', base or '')
    year = timezone.localdate().year
    if m and int(m.group(1)) == year:
        n = int(m.group(2)) + 1
    else:
        n = 1
    while f'{year}.{n}' in taken:
        n += 1
    return f'{year}.{n}'


def _audit(action, notice, changes, request, context):
    record(action, notice, changes, actor=request.user, context=context)


class AdminNoticeListView(generics.GenericAPIView):
    permission_classes = [IsAdmin]
    serializer_class = NoticeSerializer

    def get(self, request):
        rows = annotated()
        current = PrivacyNoticeVersion.current()
        data = NoticeSummarySerializer(rows, many=True, context={'current_id': current.pk if current else None}).data
        return Response({'results': data, 'current_id': current.pk if current else None})

    def post(self, request):
        """«Nueva versión»: a draft copied from the current version (or `from`)."""
        source_id = request.data.get('from')
        source = (get_object_or_404(PrivacyNoticeVersion, pk=source_id) if source_id
                  else PrivacyNoticeVersion.current())
        if source is None:
            source = PrivacyNoticeVersion.objects.order_by('-created_at').first()
        with transaction.atomic():
            draft = PrivacyNoticeVersion.objects.create(
                version=next_version(source.version if source else ''),
                title=source.title if source else 'Aviso de Privacidad',
                body=source.body if source else '',
                integral_notice_url=source.integral_notice_url if source else '',
                effective_date=timezone.localdate(),
                is_active=False,
            )
            _audit('create', draft, {'version': [None, draft.version], 'copied_from': source.version if source else None},
                   request, 'legal.notice.draft')
        draft.consent_count = 0
        draft.registration_count = 0
        return Response(NoticeSerializer(draft).data, status=status.HTTP_201_CREATED)


class AdminNoticeDetailView(generics.GenericAPIView):
    permission_classes = [IsAdmin]
    serializer_class = NoticeSerializer

    def get(self, request, pk):
        return Response(NoticeSerializer(get_object_or_404(PrivacyNoticeVersion, pk=pk)).data)

    def patch(self, request, pk):
        with transaction.atomic():
            notice = get_object_or_404(PrivacyNoticeVersion.objects.select_for_update(), pk=pk)
            if notice.was_published:
                raise ValidationError({'detail': 'Esta versión ya se publicó: su texto es el que aceptaron las familias y no se puede cambiar. Cree una versión nueva.'})
            ser = NoticeSerializer(notice, data={k: v for k, v in request.data.items() if k in EDITABLE}, partial=True)
            ser.is_valid(raise_exception=True)
            before = {f: getattr(notice, f) for f in EDITABLE}
            notice = ser.save()
            changes = {}
            for f in EDITABLE:
                old, new = before[f], getattr(notice, f)
                if old != new:
                    # The text itself can be long: the audit keeps its size, not a copy.
                    changes[f] = ([len(old), len(new)] if f == 'body' else [str(old), str(new)])
            if changes:
                _audit('update', notice, changes, request, 'legal.notice.draft')
        return Response(NoticeSerializer(notice).data)

    def delete(self, request, pk):
        with transaction.atomic():
            notice = get_object_or_404(PrivacyNoticeVersion.objects.select_for_update(), pk=pk)
            if notice.was_published:
                raise ValidationError({'detail': 'Una versión publicada no se puede borrar: es evidencia de lo que aceptaron las familias.'})
            _audit('delete', notice, {'version': [notice.version, None]}, request, 'legal.notice.draft')
            notice.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class AdminNoticePublishView(APIView):
    """Make a draft the current version. Consent rows are never modified."""
    permission_classes = [IsAdmin]

    def post(self, request, pk):
        with transaction.atomic():
            notice = get_object_or_404(PrivacyNoticeVersion.objects.select_for_update(), pk=pk)
            if notice.was_published:
                raise ValidationError({'detail': 'Esta versión ya se publicó.'})
            if not notice.body.strip():
                raise ValidationError({'body': ['El aviso no tiene texto.']})
            previous = list(PrivacyNoticeVersion.objects.select_for_update().filter(is_active=True))
            now = timezone.now()
            # Retire the versions in force: their text stays, frozen, with their consents.
            for old in previous:
                old.is_active = False
                old.save(update_fields=['is_active'])
                _audit('update', old, {'is_active': [True, False], 'replaced_by': notice.version}, request, 'legal.notice.publish')
            notice.is_active = True
            notice.published_at = now
            try:
                notice.save(update_fields=['is_active', 'published_at'])
            except IntegrityError as exc:  # pragma: no cover - unique version is validated on edit
                raise ValidationError({'detail': 'No se pudo publicar la versión.'}) from exc
            _audit('update', notice, {'is_active': [False, True], 'published_at': [None, now.isoformat()],
                                      'replaces': [o.version for o in previous]}, request, 'legal.notice.publish')
        notice.consent_count = 0
        notice.registration_count = 0
        return Response(NoticeSerializer(notice).data)
