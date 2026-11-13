"""
Admin API for families (hermanos), area «Alumnos y familias» (2026-11-13).

GET    /accounts/admin/families/                    list (q, size, ordering, page)
GET    /accounts/admin/families/export/?fmt=        CSV / Excel / PDF of the view
POST   /accounts/admin/families/bulk/               {action: dissolve, ids | all_matching}
POST   /accounts/admin/families/link/               {student_ids, family?, name?, notify?, dry_run?}
GET    /accounts/admin/families/<id>/               detail: students + logins
PATCH  /accounts/admin/families/<id>/               {name?, notes?}
DELETE /accounts/admin/families/<id>/               dissolve (files and logins stay)
DELETE /accounts/admin/families/<id>/students/<sid>/  take one student out
GET    /accounts/admin/students/<id>/family/        the student file's Familia tab
GET    /accounts/admin/families/suggestions/        probable siblings (confidence, q, student)
POST   /accounts/admin/families/suggestions/bulk/   {action: accept|dismiss, ids: [keys], dry_run, payload}

Rules live in ``accounts.families`` (writes) and ``accounts.family_suggestions``.
"""
from __future__ import annotations

from django.db.models import Count
from django.shortcuts import get_object_or_404
from rest_framework import generics, serializers, status
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.audit import record
from apps.core.bulk import AdminBulkView, BulkAction
from apps.core.exporting import AdminExportMixin, Col, ExportSpec
from apps.core.listing import AdminListMixin, search_q, split_terms, strip_accents
from apps.core.matricula import search_key
from apps.core.permissions import IsAdmin
from apps.core.throttling import SharedScopedRateThrottle

from . import family_suggestions as fs
from .families import (
    FamilyError,
    dissolve_family,
    families_prefetch,
    family_detail,
    link_students,
    logins_of,
    plan_link,
    remove_student,
    rename_family,
    student_summary,
    with_people,
)
from .models import Family, StudentProfile

FAMILY_SEARCH_FIELDS = (
    'name',
    'students__user__first_name',
    'students__user__last_name',
    'students__student_id',
    'students__user__email',
)
FAMILY_ORDERING = {
    'name': ('name',),
    'children': ('children_count', 'name'),
    'created': ('created_at',),
}
MAX_SUGGESTION_KEYS = 200


def _bool(value, default=True) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() not in ('0', 'false', 'no', 'off', '')


def _error(exc: FamilyError) -> Response:
    return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)


def family_row(family: Family) -> dict:
    members = getattr(family, 'members', None)
    if members is None:
        members = list(with_people(family.students.all()).order_by('user__first_name', 'pk'))
    return {
        'id': family.pk,
        'name': family.name,
        'notes': family.notes,
        'created_at': family.created_at.isoformat() if family.created_at else None,
        'children_count': len(members),
        'students': [student_summary(s) for s in members],
        'logins_count': len(logins_of(members)),
    }


# ── list / export / bulk ───────────────────────────────────
class FamilyListView(AdminListMixin, generics.ListAPIView):
    """Families with their students; ``?size=2|3|4`` (4 = four or more)."""
    admin_area = 'alumnos'
    permission_classes = [IsAdmin]
    search_fields = FAMILY_SEARCH_FIELDS
    normalize_search_term = staticmethod(search_key)
    ordering = FAMILY_ORDERING
    default_ordering = ('name',)

    def get_queryset(self):
        return (Family.objects.annotate(children_count=Count('students', distinct=True))
                .prefetch_related(families_prefetch()))

    def apply_search(self, qs):
        # The student joins would repeat a family once per matching child:
        # match in a subquery and keep each family once.
        q = search_q(self.search_fields, self.get_search_term(), normalize=self.normalize_search_term)
        if q is None:
            return qs
        return qs.filter(pk__in=Family.objects.filter(q).values('pk'))

    def apply_filterset(self, qs):
        size = (self.request.query_params.get('size') or '').strip()
        if size in ('2', '3'):
            return qs.filter(children_count=int(size))
        if size == '4':
            return qs.filter(children_count__gte=4)
        if size:
            raise ValidationError({'size': ['Use 2, 3 o 4.']})
        return qs

    def list(self, request, *args, **kwargs):
        qs = self.filter_queryset(self.get_queryset())
        page = self.paginate_queryset(qs)
        rows = [family_row(f) for f in (page if page is not None else qs)]
        if page is not None:
            return self.get_paginated_response(rows)
        return Response(rows)


def _member_line(s: StudentProfile) -> str:
    grade = f'{s.grade} {s.group}'.strip()
    return f'{s.user.full_name} ({grade})' if grade else s.user.full_name


FAMILIES_EXPORT = ExportSpec(
    filename_prefix='familias',
    title='Familias (hermanos)',
    sheet_title='Familias',
    audit_entity='families',
    columns=[
        Col('name', 'Familia', width=28),
        Col('children', 'Alumnos', lambda f: len(f.members), width=8, fmt='int'),
        Col('members', 'Integrantes', lambda f: '; '.join(_member_line(s) for s in f.members), width=60),
        Col('ids', 'Matrículas', lambda f: ', '.join(s.student_id for s in f.members), width=24, fmt='text'),
        Col('logins', 'Cuentas con acceso', lambda f: ', '.join(r['email'] for r in logins_of(f.members)), width=60),
        Col('notes', 'Notas', width=30),
        Col('created_at', 'Creada', width=17, fmt='datetime'),
    ],
)


class FamilyExportView(AdminExportMixin, FamilyListView):
    """GET /accounts/admin/families/export/?fmt=csv|xlsx|pdf&ids= (audited, throttled)."""
    export_spec = FAMILIES_EXPORT


def _dissolve_handler(family, payload, actor):
    names = [s.user.full_name for s in family.students.select_related('user')]
    dissolve_family(family, actor=actor, context='familia: disolver (masivo)')
    return {'students': names}


FAMILY_ACTIONS = {
    'dissolve': BulkAction(name='dissolve', label_es='Disolver', handler=_dissolve_handler,
                           audit_action='delete'),
}


class FamilyBulkView(AdminBulkView):
    admin_area = 'alumnos'
    entity = 'accounts.family'
    list_view_class = FamilyListView
    actions = FAMILY_ACTIONS


# ── detail / link / remove ─────────────────────────────────
class FamilyDetailView(APIView):
    admin_area = 'alumnos'
    permission_classes = [IsAdmin]

    def get(self, request, pk):
        return Response(family_detail(get_object_or_404(Family, pk=pk)))

    def patch(self, request, pk):
        family = get_object_or_404(Family, pk=pk)
        name = request.data.get('name', family.name)
        notes = request.data.get('notes') if 'notes' in request.data else None
        try:
            rename_family(family, name, notes=notes, actor=request.user)
        except FamilyError as exc:
            return Response({'name': [str(exc)]}, status=status.HTTP_400_BAD_REQUEST)
        return Response(family_detail(family))

    def delete(self, request, pk):
        family = get_object_or_404(Family, pk=pk)
        dissolve_family(family, actor=request.user)
        return Response(status=status.HTTP_204_NO_CONTENT)


class FamilyLinkView(APIView):
    """Create, add to or merge families. ``dry_run`` answers the plan only."""
    admin_area = 'alumnos'
    permission_classes = [IsAdmin]
    throttle_classes = [SharedScopedRateThrottle]
    throttle_scope = 'admin-bulk'

    def post(self, request):
        data = request.data
        ids = data.get('student_ids') or []
        if not isinstance(ids, list):
            return Response({'detail': 'student_ids debe ser una lista.'}, status=status.HTTP_400_BAD_REQUEST)
        family_id = data.get('family')
        name = data.get('name') or ''
        try:
            if _bool(data.get('dry_run'), default=False):
                return Response({'dry_run': True, **plan_link(ids, family_id=family_id, name=name).as_dict()})
            family, plan = link_students(ids, family_id=family_id, name=name, actor=request.user,
                                         notify=_bool(data.get('notify'), default=True))
        except FamilyError as exc:
            return _error(exc)
        return Response({
            'dry_run': False,
            **plan.as_dict(),
            'result': family_detail(family) if family is not None and family.pk else None,
        })


class FamilyStudentDetailView(APIView):
    admin_area = 'alumnos'
    permission_classes = [IsAdmin]

    def delete(self, request, pk, student_id):
        family = get_object_or_404(Family, pk=pk)
        student = get_object_or_404(StudentProfile, pk=student_id)
        try:
            result = remove_student(family, student, actor=request.user)
        except FamilyError as exc:
            return _error(exc)
        return Response(result)


class StudentFamilyView(APIView):
    """The Familia tab of a student's file."""
    admin_area = 'alumnos'
    permission_classes = [IsAdmin]

    def get(self, request, pk):
        student = get_object_or_404(with_people(StudentProfile.objects.all()), pk=pk)
        if student.family_id:
            family = family_detail(student.family)
            logins = family['logins']
        else:
            family = None
            logins = logins_of([student])
        return Response({
            'student': student_summary(student),
            'family': family,
            'logins': logins,
            'suggestions': fs.build_suggestions(student_id=student.pk),
        })


# ── suggestions ────────────────────────────────────────────
def _filter_suggestions(rows: list[dict], params) -> list[dict]:
    confidence = (params.get('confidence') or '').strip()
    if confidence in ('alta', 'media'):
        rows = [r for r in rows if r['confidence'] == confidence]
    terms = [strip_accents(t).lower() for t in split_terms(params.get('q') or '')]
    if terms:
        def hay(r):
            parts = [s['name'] for s in r['students']] + [s['student_id'] for s in r['students']]
            parts += [x['value'] for x in r['reasons']] + [f['name'] for f in r['families']]
            return strip_accents(' '.join(parts)).lower()
        rows = [r for r in rows if all(t in hay(r) for t in terms)]
    return rows


class FamilySuggestionsView(APIView):
    """``{count, results}``; ``?confidence=alta|media``, ``?q=``, ``?student=``."""
    admin_area = 'alumnos'
    permission_classes = [IsAdmin]

    def get(self, request):
        sid = request.query_params.get('student')
        rows = fs.build_suggestions(student_id=int(sid) if sid and sid.isdigit() else None)
        rows = _filter_suggestions(rows, request.query_params)
        return Response({
            'count': len(rows),
            'counts': {
                'alta': sum(1 for r in rows if r['confidence'] == 'alta'),
                'media': sum(1 for r in rows if r['confidence'] == 'media'),
            },
            'results': rows,
        })


class _SuggestionBulkSerializer(serializers.Serializer):
    action = serializers.ChoiceField(choices=('accept', 'dismiss'),
                                     error_messages={'invalid_choice': 'Acción no válida.'})
    ids = serializers.ListField(child=serializers.CharField(max_length=200), allow_empty=False,
                                max_length=MAX_SUGGESTION_KEYS,
                                error_messages={'empty': 'Elija al menos una sugerencia.'})
    payload = serializers.DictField(required=False, default=dict)
    dry_run = serializers.BooleanField(required=False, default=False)


class FamilySuggestionsBulkView(APIView):
    """Accept (link) or dismiss suggestions; same response contract as every bulk."""
    admin_area = 'alumnos'
    permission_classes = [IsAdmin]
    throttle_classes = [SharedScopedRateThrottle]
    throttle_scope = 'admin-bulk'

    def post(self, request):
        ser = _SuggestionBulkSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        data = ser.validated_data
        action = data['action']
        keys = data['ids']
        dry_run = data['dry_run']
        notify = _bool((data.get('payload') or {}).get('notify'), default=True)
        current = {r['key']: r for r in fs.build_suggestions()}
        result = {'action': action, 'requested': len(keys), 'ok': 0, 'failed': [], 'skipped': [],
                  'dry_run': dry_run, 'warnings': []}
        for key in dict.fromkeys(str(k) for k in keys):
            try:
                ids = fs.parse_key(key)
            except ValueError as exc:
                result['failed'].append({'id': key, 'error': str(exc)})
                continue
            row = current.get(key)
            if action == 'accept':
                if row is None:
                    result['skipped'].append({'id': key, 'reason': 'ya no es una sugerencia'})
                    continue
                if dry_run:
                    if len(row['families']) > 1:
                        result['warnings'].append({'id': key, 'message': (
                            'Se unirán ' + ' y '.join(f['name'] for f in row['families']) + '.')})
                    result['ok'] += 1
                    continue
                try:
                    link_students(ids, actor=request.user, notify=notify,
                                  context='familia: sugerencia aceptada')
                except FamilyError as exc:
                    result['failed'].append({'id': key, 'error': str(exc)})
                    continue
                result['ok'] += 1
            else:
                if row is None:
                    result['skipped'].append({'id': key, 'reason': 'ya no es una sugerencia'})
                    continue
                if not dry_run:
                    fs.dismiss(actor=request.user, pairs=fs.pairs_to_dismiss(row))
                result['ok'] += 1
        if not dry_run:
            record('update', object_type='bulk:accounts.family_suggestion', object_id=action,
                   changes={'requested': result['requested'], 'ok': result['ok'],
                            'failed': len(result['failed']), 'skipped': len(result['skipped']),
                            'keys': list(dict.fromkeys(str(k) for k in keys))[:50]},
                   actor=request.user, context=f'familia: sugerencias ({action})')
        if not result['warnings']:
            result.pop('warnings')
        return Response(result)

