import pytest
from django.core import mail
from django.urls import reverse

from apps.content.forms import FormDefinition, FormSubmission

FIELDS = [
    {'key': 'nombre', 'label': 'Nombre', 'type': 'text', 'required': True},
    {'key': 'correo', 'label': 'Correo', 'type': 'email', 'required': True},
    {'key': 'nivel', 'label': 'Nivel', 'type': 'select', 'options': ['Preescolar', 'Primaria'], 'required': True},
    {'key': 'grado', 'label': 'Grado', 'type': 'text', 'required': True, 'show_if': {'field': 'nivel', 'equals': 'Primaria'}},
    {'key': 'mensaje', 'label': 'Mensaje', 'type': 'textarea'},
]


@pytest.fixture
def form(db):
    return FormDefinition.objects.create(slug='informes', title='Informes', fields=FIELDS, notify_to='admisiones@interlaken.com.mx')


@pytest.mark.django_db
class TestPublicForm:
    def test_definition_only_when_published(self, client, form):
        assert client.get(reverse('cms-form', args=['informes'])).status_code == 200
        form.is_published = False
        form.save()
        assert client.get(reverse('cms-form', args=['informes'])).status_code == 404

    def test_submit_validates_conditional_and_notifies(self, client, form, settings):
        settings.EMAIL_BACKEND = 'django.core.mail.backends.locmem.EmailBackend'
        url = reverse('cms-form-submit', args=['informes'])
        r = client.post(url, {'nombre': 'Ana', 'correo': 'no-es-correo', 'nivel': 'Primaria', 'consent': True}, content_type='application/json')
        assert r.status_code == 400
        assert set(r.data) == {'correo', 'grado'}
        # grado hidden when nivel != Primaria: not required
        r = client.post(url, {'nombre': 'Ana', 'correo': 'ana@x.mx', 'nivel': 'Preescolar', 'consent': True, '_page': '/admisiones'}, content_type='application/json')
        assert r.status_code == 201, r.data
        sub = FormSubmission.objects.get()
        assert sub.data == {'nombre': 'Ana', 'correo': 'ana@x.mx', 'nivel': 'Preescolar', 'mensaje': ''} and sub.page == '/admisiones'
        assert sub.reply_to == 'ana@x.mx'
        assert mail.outbox[-1].to == ['admisiones@interlaken.com.mx'] and 'Ana' in mail.outbox[-1].body

    def test_consent_required_and_honeypot(self, client, form):
        url = reverse('cms-form-submit', args=['informes'])
        r = client.post(url, {'nombre': 'Ana', 'correo': 'ana@x.mx', 'nivel': 'Preescolar'}, content_type='application/json')
        assert r.status_code == 400 and 'consent' in r.data
        r = client.post(url, {'nombre': 'Bot', 'website': 'http://spam'}, content_type='application/json')
        assert r.status_code == 200 and FormSubmission.objects.count() == 0


@pytest.mark.django_db
class TestAdminForms:
    def test_crud_validates_fields(self, admin_client):
        url = reverse('admin-forms')
        bad = admin_client.post(url, {'slug': 'x', 'title': 'X', 'fields': [{'key': 'Bad Key', 'label': 'a', 'type': 'text'}]}, format='json')
        assert bad.status_code == 400 and 'fields' in bad.data
        bad = admin_client.post(url, {'slug': 'x', 'title': 'X', 'fields': [{'key': 'b', 'label': 'B', 'type': 'text', 'show_if': {'field': 'nope', 'equals': 1}}]}, format='json')
        assert bad.status_code == 400
        ok = admin_client.post(url, {'slug': 'x', 'title': 'X', 'fields': FIELDS}, format='json')
        assert ok.status_code == 201 and ok.data['submissions_count'] == 0

    def test_submissions_list_csv_and_handle(self, admin_client, form):
        FormSubmission.objects.create(form=form, data={'nombre': 'Ana', 'correo': 'a@x.mx', 'nivel': 'Primaria', 'grado': '2'})
        r = admin_client.get(reverse('admin-form-submissions', args=[form.pk]))
        assert r.status_code == 200 and r.data[0]['reply_to'] == 'a@x.mx'
        csv = admin_client.get(reverse('admin-form-submissions', args=[form.pk]) + '?export=csv')
        assert csv['Content-Type'].startswith('text/csv') and 'Ana' in csv.content.decode('utf-8-sig')
        sid = r.data[0]['id']
        assert admin_client.patch(reverse('admin-form-submission-detail', args=[sid]), {'is_handled': True}, format='json').status_code == 200
        assert admin_client.get(reverse('admin-form-submissions', args=[form.pk]) + '?handled=0').data == []

    def test_parent_cannot_access(self, auth_client, form):
        assert auth_client.get(reverse('admin-forms')).status_code == 403
