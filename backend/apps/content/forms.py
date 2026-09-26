"""
CMS forms builder (CMS-PLAN phase 5, BACKLOG P3-6).

FormDefinition  slug, title, fields JSON, consent text, notify_to mailbox,
                success message. Fields:
                  {key, label, type, required?, options?[], placeholder?,
                   help?, show_if?: {field, equals}}
                types: text, email, phone, textarea, select, radio, checkbox,
                       date, number
FormSubmission  data JSON, page slug, client meta; listed in the portal inbox.

Public:  GET  /content/forms/<slug>/          definition (published only)
         POST /content/forms/<slug>/submit/   validated server-side, honeypot
Admin:   CRUD /content/admin/forms/ (+ export/, bulk/), GET /content/admin/forms/<id>/submissions/
         (paginated, q/handled/from/to; export/ sibling), PATCH /content/admin/form-submissions/<id>/
         {is_handled}, POST /content/admin/form-submissions/bulk/
"""
from __future__ import annotations

import re

import django_filters
from django.conf import settings
from django.db import models
from django.http import Http404
from django.utils.decorators import method_decorator
from rest_framework import generics, permissions, serializers, status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.bulk import AdminBulkView, BulkAction, BulkSkip
from apps.core.exporting import AdminExportMixin, Col, ExportSpec
from apps.core.listing import AdminListMixin, apply_date_range
from apps.core.permissions import IsAdmin
from apps.core.ratelimit import ratelimit

from .ops import AuditedCrudMixin, bool_filter, delete_action

FIELD_TYPES = ('text', 'email', 'phone', 'textarea', 'select', 'radio', 'checkbox', 'date', 'number')
KEY_RE = re.compile(r'^[a-z][a-z0-9_]{0,39}$')
PHONE_RE = re.compile(r'^\+?[0-9 ()-]{8,20}$')
MAX_FIELDS = 40
MAX_VALUE_LEN = 4000


def validate_fields(fields) -> list[dict]:
    if not isinstance(fields, list) or not fields:
        raise serializers.ValidationError({'fields': 'Agregue al menos un campo.'})
    if len(fields) > MAX_FIELDS:
        raise serializers.ValidationError({'fields': f'Máximo {MAX_FIELDS} campos.'})
    keys: set[str] = set()
    out = []
    for i, f in enumerate(fields):
        n = i + 1
        if not isinstance(f, dict):
            raise serializers.ValidationError({'fields': f'Campo #{n} inválido.'})
        key, label, ftype = f.get('key'), f.get('label'), f.get('type')
        if not isinstance(key, str) or not KEY_RE.match(key):
            raise serializers.ValidationError({'fields': f'Campo #{n}: clave inválida (minúsculas, números y _).'})
        if key in keys:
            raise serializers.ValidationError({'fields': f'Campo #{n}: clave "{key}" repetida.'})
        if not isinstance(label, str) or not label.strip():
            raise serializers.ValidationError({'fields': f'Campo #{n}: falta la etiqueta.'})
        if ftype not in FIELD_TYPES:
            raise serializers.ValidationError({'fields': f'Campo #{n}: tipo desconocido "{ftype}".'})
        if ftype in ('select', 'radio'):
            opts = f.get('options')
            if not isinstance(opts, list) or not opts or not all(isinstance(o, str) and o.strip() for o in opts):
                raise serializers.ValidationError({'fields': f'Campo #{n}: las opciones deben ser una lista de textos.'})
        show_if = f.get('show_if')
        if show_if is not None:
            if not isinstance(show_if, dict) or not isinstance(show_if.get('field'), str) or 'equals' not in show_if:
                raise serializers.ValidationError({'fields': f'Campo #{n}: show_if debe ser {{field, equals}}.'})
            if show_if['field'] not in keys:
                raise serializers.ValidationError({'fields': f'Campo #{n}: show_if se refiere a un campo anterior inexistente.'})
        keys.add(key)
        out.append({
            'key': key, 'label': label.strip()[:120], 'type': ftype, 'required': bool(f.get('required')),
            'options': [o.strip()[:120] for o in f.get('options', [])] if ftype in ('select', 'radio') else [],
            'placeholder': str(f.get('placeholder') or '')[:120], 'help': str(f.get('help') or '')[:300],
            'show_if': show_if,
        })
    return out


def _visible(field: dict, data: dict) -> bool:
    cond = field.get('show_if')
    if not cond:
        return True
    return str(data.get(cond['field'], '')) == str(cond['equals'])


def validate_submission(form: FormDefinition, payload: dict) -> dict:
    """Coerce and validate a public payload against the definition. Returns clean data."""
    errors: dict[str, str] = {}
    clean: dict = {}
    for f in form.fields:
        key, ftype = f['key'], f['type']
        raw = payload.get(key)
        if not _visible(f, payload):
            continue
        if ftype == 'checkbox':
            clean[key] = bool(raw) and str(raw).lower() not in ('false', '0', '')
            if f.get('required') and not clean[key]:
                errors[key] = 'Debe marcar esta casilla.'
            continue
        val = '' if raw is None else str(raw).strip()
        if len(val) > MAX_VALUE_LEN:
            errors[key] = 'Demasiado largo.'
            continue
        if not val:
            if f.get('required'):
                errors[key] = 'Este campo es obligatorio.'
            clean[key] = ''
            continue
        if ftype == 'email':
            try:
                serializers.EmailField().run_validation(val)
            except serializers.ValidationError:
                errors[key] = 'Correo no válido.'
        elif ftype == 'phone' and not PHONE_RE.match(val):
            errors[key] = 'Teléfono no válido.'
        elif ftype in ('select', 'radio') and val not in f.get('options', []):
            errors[key] = 'Elija una opción válida.'
        elif ftype == 'number':
            try:
                float(val)
            except ValueError:
                errors[key] = 'Debe ser un número.'
        elif ftype == 'date' and not re.match(r'^\d{4}-\d{2}-\d{2}$', val):
            errors[key] = 'Fecha no válida.'
        clean[key] = val
    if form.consent_text and payload.get('consent') not in (True, 'true', 'on', '1', 1):
        errors['consent'] = 'Debe aceptar el aviso de privacidad.'
    if errors:
        raise serializers.ValidationError(errors)
    return clean


SEARCH_TEXT_MAX = 10_000


def build_search_text(data, page: str = '') -> str:
    """Answers (strings and numbers, not checkbox booleans) + page, space-joined."""
    parts = [str(page or '')]
    for value in (data or {}).values():
        if isinstance(value, bool) or value in (None, ''):
            continue
        parts.append(str(value))
    return ' '.join(p for p in parts if p)[:SEARCH_TEXT_MAX]


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------
class FormDefinition(models.Model):
    slug = models.SlugField(max_length=60, unique=True)
    title = models.CharField(max_length=120)
    description = models.CharField(max_length=300, blank=True)
    fields = models.JSONField(default=list)
    consent_text = models.CharField(max_length=300, blank=True, default='He leído el Aviso de Privacidad y acepto el tratamiento de mis datos.')
    notify_to = models.EmailField(blank=True, help_text='Buzón que recibe cada envío (vacío = CONTACT_EMAIL).')
    success_message = models.CharField(max_length=300, default='Gracias. Le responderemos en menos de 2 días hábiles.')
    submit_label = models.CharField(max_length=40, default='Enviar')
    is_published = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['title']
        verbose_name = 'Formulario'
        verbose_name_plural = 'Formularios'

    def __str__(self):
        return self.title

    @property
    def recipient(self) -> str:
        return self.notify_to or settings.CONTACT_EMAIL or settings.DEFAULT_FROM_EMAIL


class FormSubmission(models.Model):
    form = models.ForeignKey(FormDefinition, on_delete=models.CASCADE, related_name='submissions')
    data = models.JSONField(default=dict)
    page = models.CharField(max_length=120, blank=True, help_text='Ruta desde la que se envió')
    is_handled = models.BooleanField(default=False)
    # Every answer flattened into one column so the inbox ``q`` can search the
    # JSON payload with a plain ``icontains`` (Data Ops Phase 8). Kept in sync
    # by ``save()``; backfilled by migration 0026.
    search_text = models.TextField(blank=True, default='', editable=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        verbose_name = 'Envío de formulario'
        verbose_name_plural = 'Envíos de formularios'
        indexes = [
            # Submissions of one form filtered by handled, newest first (Data Ops Phase 1).
            models.Index(fields=['form', 'is_handled', '-created_at'], name='content_formsub_handled'),
        ]

    def save(self, *args, **kwargs):
        self.search_text = build_search_text(self.data, self.page)
        update_fields = kwargs.get('update_fields')
        if update_fields is not None and 'data' in update_fields:
            kwargs['update_fields'] = {*update_fields, 'search_text'}
        super().save(*args, **kwargs)

    @property
    def reply_to(self) -> str:
        for f in self.form.fields:
            if f['type'] == 'email' and self.data.get(f['key']):
                return self.data[f['key']]
        return ''

    def summary(self) -> str:
        return '\n'.join(f"{f['label']}: {self.data.get(f['key'], '')}" for f in self.form.fields if f['key'] in self.data)


# ---------------------------------------------------------------------------
# Serializers
# ---------------------------------------------------------------------------
class FormDefinitionSerializer(serializers.ModelSerializer):
    submissions_count = serializers.IntegerField(read_only=True, default=0)
    pending_count = serializers.IntegerField(read_only=True, default=0)

    class Meta:
        model = FormDefinition
        fields = ['id', 'slug', 'title', 'description', 'fields', 'consent_text', 'notify_to', 'success_message',
                  'submit_label', 'is_published', 'submissions_count', 'pending_count', 'updated_at']

    def validate_fields(self, value):
        return validate_fields(value)


class FormPublicSerializer(serializers.ModelSerializer):
    class Meta:
        model = FormDefinition
        fields = ['slug', 'title', 'description', 'fields', 'consent_text', 'success_message', 'submit_label']


class FormSubmissionSerializer(serializers.ModelSerializer):
    form_title = serializers.CharField(source='form.title', read_only=True)
    reply_to = serializers.CharField(read_only=True)

    class Meta:
        model = FormSubmission
        fields = ['id', 'form', 'form_title', 'data', 'page', 'is_handled', 'reply_to', 'created_at']
        read_only_fields = ['form', 'data', 'page', 'created_at']


# ---------------------------------------------------------------------------
# Views
# ---------------------------------------------------------------------------
def _get_published(slug: str) -> FormDefinition:
    form = FormDefinition.objects.filter(slug=slug, is_published=True).first()
    if form is None:
        raise Http404
    return form


class PublicFormView(APIView):
    permission_classes = [permissions.AllowAny]

    def get(self, request, slug):
        return Response(FormPublicSerializer(_get_published(slug)).data)


@method_decorator(ratelimit('cms-form', '5/m', method='POST'), name='dispatch')
class PublicFormSubmitView(APIView):
    permission_classes = [permissions.AllowAny]

    def post(self, request, slug):
        form = _get_published(slug)
        payload = request.data if isinstance(request.data, dict) else {}
        if payload.get('website'):  # honeypot: bots fill every input
            return Response({'ok': True, 'message': form.success_message})
        clean = validate_submission(form, payload)
        sub = FormSubmission.objects.create(form=form, data=clean, page=str(payload.get('_page') or '')[:120])
        from apps.portal.services import send_email  # lazy: portal imports core at load
        send_email(f'[{form.title}] Nuevo envío desde el sitio', sub.summary() + f'\n\nPágina: {sub.page or "-"}',
                   [form.recipient], reply_to=sub.reply_to or None)
        return Response({'ok': True, 'message': form.success_message}, status=status.HTTP_201_CREATED)


def _annotated():
    return FormDefinition.objects.annotate(
        submissions_count=models.Count('submissions'),
        pending_count=models.Count('submissions', filter=models.Q(submissions__is_handled=False)),
    )


class FormFilterSet(django_filters.FilterSet):
    published = bool_filter('is_published')

    class Meta:
        model = FormDefinition
        fields: list[str] = []


FORM_ORDERING = {
    'title': 'title',
    'slug': 'slug',
    'updated': 'updated_at',
    'submissions': 'submissions_count',
    'pending': 'pending_count',
    'published': 'is_published',
}


class FormListCreateView(AuditedCrudMixin, AdminListMixin, generics.ListCreateAPIView):
    """GET/POST /content/admin/forms/ — Data Ops list contract (``q`` title/slug,
    ``published``, ordering keys in ``FORM_ORDERING``)."""
    serializer_class = FormDefinitionSerializer
    search_fields = ('title', 'slug')
    ordering = FORM_ORDERING
    default_ordering = 'title'
    filterset_class = FormFilterSet
    audit_context = 'cms.form'

    def get_queryset(self):
        return _annotated()


class FormDetailView(AuditedCrudMixin, generics.RetrieveUpdateDestroyAPIView):
    permission_classes = [IsAdmin]
    serializer_class = FormDefinitionSerializer
    audit_context = 'cms.form'

    def get_queryset(self):
        return _annotated()


FORM_EXPORT = ExportSpec(
    filename_prefix='formularios',
    title='Formularios',
    audit_entity='content.formdefinition',
    columns=[
        Col('title', 'Título', width=32),
        Col('slug', 'Clave', width=20),
        Col('fields', 'Campos', getter=lambda f: len(f.fields or []), fmt='int', width=8),
        Col('recipient', 'Buzón', width=28),
        Col('is_published', 'Publicado', fmt='bool', width=10),
        Col('submissions_count', 'Envíos', fmt='int', width=8),
        Col('pending_count', 'Pendientes', fmt='int', width=10),
        Col('updated_at', 'Actualizado', fmt='datetime', width=18),
    ],
)


class FormExportView(AdminExportMixin, FormListCreateView):
    """GET /content/admin/forms/export/?fmt=csv|xlsx|pdf"""
    http_method_names = ['get', 'head', 'options']
    export_spec = FORM_EXPORT


def _form_delete_guard(form) -> str | None:
    count = getattr(form, 'submissions_count', None)
    if count is None:
        count = form.submissions.count()
    return f'tiene {count} envío(s); elimínelo desde su ficha' if count else None


class FormBulkView(AdminBulkView):
    """POST /content/admin/forms/bulk/ — ``delete`` (forms without submissions only)."""
    entity = 'content.formdefinition'
    list_view_class = FormListCreateView
    actions = {'delete': delete_action(guard=_form_delete_guard)}

    def get_queryset(self):
        return _annotated()


# ── submissions ───────────────────────────────────────────
class SubmissionFilterSet(django_filters.FilterSet):
    handled = bool_filter('is_handled')

    class Meta:
        model = FormSubmission
        fields: list[str] = []

    @property
    def qs(self):
        params = self.data or {}
        return apply_date_range(super().qs, 'created_at', params.get('from'), params.get('to'))


SUBMISSION_ORDERING = {
    'date': 'created_at',
    'handled': 'is_handled',
    'page': 'page',
}


class FormSubmissionsView(AdminListMixin, generics.ListAPIView):
    """GET /content/admin/forms/<pk>/submissions/ — paginated inbox of one form.

    ``q`` searches every answer (``search_text``), ``handled=0|1``, ``from``/``to``,
    ordering ``date|handled|page``. ``?form=<id>`` works too (bulk all_matching).
    """
    serializer_class = FormSubmissionSerializer
    search_fields = ('search_text',)
    ordering = SUBMISSION_ORDERING
    default_ordering = '-created_at'
    filterset_class = SubmissionFilterSet

    def get_form(self) -> FormDefinition:
        if not hasattr(self, '_form'):
            raw = self.kwargs.get('pk') or self.request.query_params.get('form')
            form = FormDefinition.objects.filter(pk=raw).first() if str(raw or '').isdigit() else None
            if form is None:
                raise Http404
            self._form = form
        return self._form

    def get_queryset(self):
        form = self.get_form()
        # form.title + reply_to touch the FK per row: join it once.
        return FormSubmission.objects.filter(form=form).select_related('form')


def _submission_value(key):
    def get(sub):
        value = (sub.data or {}).get(key, '')
        if isinstance(value, bool):
            return 'Sí' if value else 'No'
        return '' if value is None else str(value)
    return get


class FormSubmissionsExportView(AdminExportMixin, FormSubmissionsView):
    """GET /content/admin/forms/<pk>/submissions/export/?fmt=csv|xlsx|pdf — one
    column per form field, same filters as the inbox (replaces ``?export=csv``)."""
    http_method_names = ['get', 'head', 'options']

    def get_export_spec(self):
        form = self.get_form()
        columns = [
            Col('created_at', 'Fecha', fmt='datetime', width=18),
            Col('is_handled', 'Atendido', fmt='bool', width=10),
            Col('page', 'Página', width=20),
        ]
        columns += [Col(f'data:{f["key"]}', f['label'], getter=_submission_value(f['key']), width=24)
                    for f in form.fields]
        return ExportSpec(filename_prefix=f'formulario-{form.slug}', title=f'Envíos: {form.title}',
                          audit_entity='content.formsubmission', columns=columns)


def _handled_action(name, label_es, value, skip_reason):
    def plan(sub, payload):
        if sub.is_handled == value:
            raise BulkSkip(skip_reason)

    def handler(sub, payload, actor):
        plan(sub, payload)
        sub.is_handled = value
        sub.save(update_fields=['is_handled'])
        return {'is_handled': [not value, value]}

    return BulkAction(name=name, label_es=label_es, handler=handler, plan=plan, side_effects='none')


class FormSubmissionBulkView(AdminBulkView):
    """POST /content/admin/form-submissions/bulk/ — ``mark_handled``, ``reopen``,
    ``delete``. For ``all_matching`` the filters carry ``form``."""
    entity = 'content.formsubmission'
    list_view_class = FormSubmissionsView
    actions = {
        a.name: a for a in (
            _handled_action('mark_handled', 'Marcar atendido', True, 'ya estaba atendido'),
            _handled_action('reopen', 'Reabrir', False, 'ya estaba pendiente'),
            delete_action(),
        )
    }


class FormSubmissionDetailView(AuditedCrudMixin, generics.RetrieveUpdateDestroyAPIView):
    permission_classes = [IsAdmin]
    serializer_class = FormSubmissionSerializer
    audit_context = 'cms.form-submission'

    def get_queryset(self):
        return FormSubmission.objects.select_related('form')
