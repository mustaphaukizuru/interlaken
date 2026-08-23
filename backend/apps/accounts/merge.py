"""
Guardian merge tool (BACKLOG P4-6).

Families sometimes end up with two parent accounts (a Gmail sign-in and an
invited address). Merging keeps one ("keep"), moves every reference from the
other ("drop") onto it, then deactivates "drop" (never deleted: audit and
ledgers keep pointing at a real row).

GET  /accounts/admin/guardians/merge/preview/?keep=<id|email>&drop=<id|email>
POST /accounts/admin/guardians/merge/   {"keep": id, "drop": id, "confirm": "FUSIONAR"}

Rules: both must be parents (role parent), distinct, not the caller. Every FK
and M2M that points at User is repointed generically; rows that would violate
a unique constraint on (user, …) (e.g. an announcement read by both) are left
on "drop" and counted as skipped. Passwords, email and OAuth stay with "keep".
"""
from __future__ import annotations

from django.apps import apps as django_apps
from django.db import IntegrityError, models, transaction
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.permissions import IsAdmin

from .models import ParentProfile, StudentProfile, User

SKIP_MODELS = {('accounts', 'ParentProfile'), ('accounts', 'NotificationPreference'), ('accounts', 'StudentProfile')}


def _user_relations():
    """Yield (model, field) for every FK/M2M on any model that targets User."""
    for model in django_apps.get_models():
        if (model._meta.app_label, model.__name__) in SKIP_MODELS:
            continue
        for f in model._meta.get_fields():
            if isinstance(f, (models.ForeignKey, models.OneToOneField)) and f.related_model is User:
                yield model, f
            elif isinstance(f, models.ManyToManyField) and f.related_model is User:
                yield model, f


def _validate(keep_id, drop_id, actor) -> tuple[User, User] | Response:
    def _find(v):
        v = str(v or '').strip()
        if '@' in v:
            return User.objects.filter(email__iexact=v).first()
        return User.objects.filter(pk=int(v)).first() if v.isdigit() else None
    keep, drop = _find(keep_id), _find(drop_id)
    if keep is None or drop is None:
        return Response({'detail': 'Cuentas no encontradas. Use el correo exacto o el id.'}, status=status.HTTP_400_BAD_REQUEST)
    if keep.pk == drop.pk:
        return Response({'detail': 'Elija dos cuentas distintas.'}, status=status.HTTP_400_BAD_REQUEST)
    if keep.role != User.Role.PARENT or drop.role != User.Role.PARENT:
        return Response({'detail': 'Solo se fusionan cuentas de padres/tutores.'}, status=status.HTTP_400_BAD_REQUEST)
    if actor and drop.pk == actor.pk:
        return Response({'detail': 'No puede fusionar su propia cuenta.'}, status=status.HTTP_400_BAD_REQUEST)
    return keep, drop


def _summary(u: User) -> dict:
    return {
        'id': u.pk, 'email': u.email, 'full_name': u.full_name, 'is_active': u.is_active,
        'last_login': u.last_login.isoformat() if u.last_login else None,
        'has_password': u.has_usable_password(), 'google': bool(u.avatar),
        'children': [{'id': s.pk, 'name': s.user.full_name, 'grade': s.grade} for s in StudentProfile.objects.filter(parents=u).select_related('user')],
        'phone': getattr(getattr(u, 'parent_profile', None), 'phone', ''),
    }


def build_preview(keep: User, drop: User) -> dict:
    counts = {}
    for model, f in _user_relations():
        if isinstance(f, models.ManyToManyField):
            n = model.objects.filter(**{f.name: drop}).count()
        else:
            n = model.objects.filter(**{f.name: drop}).count()
        if n:
            counts[f'{model._meta.app_label}.{model.__name__}.{f.name}'] = n
    return {'keep': _summary(keep), 'drop': _summary(drop), 'references': counts}


def merge_users(keep: User, drop: User, actor=None) -> dict:
    moved: dict[str, int] = {}
    skipped: dict[str, int] = {}
    with transaction.atomic():
        # children: union of both
        for sp in StudentProfile.objects.filter(parents=drop):
            sp.parents.add(keep)
            sp.parents.remove(drop)
            moved['children'] = moved.get('children', 0) + 1
        # phone fallback
        kp = ParentProfile.objects.filter(user=keep).first()
        dp = ParentProfile.objects.filter(user=drop).first()
        if kp and dp and not kp.phone and dp.phone:
            kp.phone = dp.phone
            kp.save(update_fields=['phone'])
        for model, f in _user_relations():
            key = f'{model._meta.app_label}.{model.__name__}.{f.name}'
            if isinstance(f, models.ManyToManyField):
                for obj in model.objects.filter(**{f.name: drop}):
                    getattr(obj, f.name).add(keep)
                    getattr(obj, f.name).remove(drop)
                    moved[key] = moved.get(key, 0) + 1
                continue
            for obj in model.objects.filter(**{f.name: drop}):
                try:
                    with transaction.atomic():
                        setattr(obj, f.name, keep)
                        obj.save(update_fields=[f.name])
                    moved[key] = moved.get(key, 0) + 1
                except IntegrityError:
                    skipped[key] = skipped.get(key, 0) + 1
        drop.is_active = False
        drop.save(update_fields=['is_active'])
        try:
            from apps.core.audit import record
            record('update', keep, {'merged_from': drop.pk, 'merged_email': drop.email, 'moved': moved, 'skipped': skipped},
                   actor=actor, context='guardian.merge')
        except Exception:  # noqa: BLE001
            pass
    return {'moved': moved, 'skipped': skipped, 'keep': keep.pk, 'drop': drop.pk}


class GuardianMergePreviewView(APIView):
    permission_classes = [IsAdmin]

    def get(self, request):
        res = _validate(request.query_params.get('keep'), request.query_params.get('drop'), request.user)
        if isinstance(res, Response):
            return res
        return Response(build_preview(*res))


class GuardianMergeView(APIView):
    permission_classes = [IsAdmin]

    def post(self, request):
        if request.data.get('confirm') != 'FUSIONAR':
            return Response({'confirm': ['Escriba FUSIONAR para confirmar.']}, status=status.HTTP_400_BAD_REQUEST)
        res = _validate(request.data.get('keep'), request.data.get('drop'), request.user)
        if isinstance(res, Response):
            return res
        return Response(merge_users(*res, actor=request.user))
