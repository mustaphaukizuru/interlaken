"""Every registered ModelAdmin opens for a superuser and refuses anyone else.

Phase 8 (docs/UIUX-REFINEMENT-PROMPT.md §13): a smoke test over the whole
``admin.site`` registry, so an admin option that breaks a changelist (a bad
``list_display`` name, a filter on a removed field, an unfold upgrade) fails
here instead of in production. The models the console owns stay read-only.
"""
from decimal import Decimal

import pytest
from django.contrib import admin
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import Client, RequestFactory
from django.urls import reverse
from django.utils import timezone

from apps.accounts.factories import ParentFactory, StudentProfileFactory

pytestmark = pytest.mark.django_db

REGISTRY = sorted(admin.site._registry.items(), key=lambda kv: kv[0]._meta.label)
IDS = [model._meta.label for model, _ in REGISTRY]


def _url(model, view, *args):
    opts = model._meta
    return reverse(f'admin:{opts.app_label}_{opts.model_name}_{view}', args=args)


@pytest.fixture
def superuser(db):
    from apps.accounts.models import User
    return User.objects.create_superuser(email='root@test.mx', password='root-pass-1234')


@pytest.fixture
def root(superuser):
    client = Client()
    client.force_login(superuser)
    return client


@pytest.fixture
def seeded(db, settings, tmp_path):
    """One fake row in the models whose change form is worth opening."""
    from apps.admissions.models import Registration, RegistrationDocument
    from apps.bookings.models import AvailabilitySlot, Booking
    from apps.cafeteria.models import CafeteriaBalance, CafeteriaTransaction
    from apps.payments.factories import PaymentFactory
    from apps.portal.models import Announcement, Notification

    settings.MEDIA_ROOT = str(tmp_path)
    parent = ParentFactory(email='mama@test.mx')
    student = StudentProfileFactory(parents=[parent])
    Notification.objects.create(user=parent, notif_type='info', title='Aviso', message='Texto')
    Announcement.objects.create(title='Comunicado', body='Texto', audience='all', is_active=True)
    slot = AvailabilitySlot.objects.create(date=timezone.localdate(), start_time='09:00',
                                           end_time='10:00', capacity=5)
    Booking.objects.create(slot=slot, parent_name='Mamá Prueba', parent_email='visita@test.mx',
                           parent_phone='5555555555', num_attendees=1)
    reg = Registration.objects.create(
        child_first_name='Ana', child_last_name='Prueba', child_dob='2018-01-01', level='primaria',
        grade_applying='1', parent1_name='M', parent1_email='m@test.mx', parent1_phone='55')
    RegistrationDocument.objects.create(registration=reg, doc_type=RegistrationDocument.DocType.choices[0][0],
                                        file=SimpleUploadedFile('acta.pdf', b'%PDF-1.4 fake'),
                                        filename='acta.pdf', file_size=13)
    CafeteriaBalance.objects.update_or_create(student=student, defaults={'balance': Decimal('50.00')})
    CafeteriaTransaction.objects.create(student=student, transaction_type='purchase', amount=Decimal('5.00'),
                                        description='Torta', balance_after=Decimal('45.00'),
                                        loyverse_receipt_id='smoke-1')
    PaymentFactory(user=parent)
    _seed_more(parent, student)
    return parent


def _seed_more(parent, student):
    """Cheap rows for more change forms (fake data only)."""
    from django.contrib.auth.models import Group

    from apps.accounts.models import ParentProfile
    from apps.admissions.models import PreRegistration
    from apps.cafeteria.models import BalanceAdjustment, LoyverseProfile, TopUpRequest
    from apps.content.models import SiteSettings
    from apps.content.navigation import Redirect
    from apps.content.pages import Page
    from apps.core.models import ContactMessage
    from apps.legal.models import ArcoRequest
    from apps.portal.models import Announcement, AnnouncementComment

    Group.objects.create(name='Prueba')
    ParentProfile.objects.get_or_create(user=parent)
    PreRegistration.objects.create(child_first_name='Leo', child_last_name='Prueba', level='primaria',
                                   grade_applying='2', parent_name='Papá Prueba', parent_phone='5555555555',
                                   parent_email='pre@test.mx')
    ContactMessage.objects.create(name='Visitante', email='v@test.mx', subject='Informes', message='Hola')
    ArcoRequest.objects.create(requester_email='arco@test.mx', request_type=ArcoRequest._meta.get_field(
        'request_type').choices[0][0], statutory_deadline=timezone.localdate())
    TopUpRequest.objects.create(student=student, amount=Decimal('100.00'))
    BalanceAdjustment.objects.create(student=student, amount=Decimal('1.00'), reason='Prueba',
                                     balance_after=Decimal('51.00'))
    LoyverseProfile.objects.create(loyverse_id='lv-smoke', student=student, name='Alumno Prueba')
    AnnouncementComment.objects.create(announcement=Announcement.objects.first(), author=parent, body='Gracias')
    Page.objects.create(slug='prueba', title='Prueba')
    Redirect.objects.create(from_path='/viejo', to_path='/nuevo')
    SiteSettings.load()


def _request(user):
    req = RequestFactory().get('/django-admin/')
    req.user = user
    return req


@pytest.mark.parametrize(('model', 'model_admin'), REGISTRY, ids=IDS)
def test_changelist_and_add_view_open_for_a_superuser(model, model_admin, root, superuser, seeded):
    resp = root.get(_url(model, 'changelist'))
    assert resp.status_code == 200, (model._meta.label, resp.status_code)
    add = root.get(_url(model, 'add'))
    expected = 200 if model_admin.has_add_permission(_request(superuser)) else 403
    assert add.status_code == expected, (model._meta.label, add.status_code)


@pytest.mark.parametrize(('model', 'model_admin'), REGISTRY, ids=IDS)
def test_change_form_opens_for_a_superuser(model, model_admin, root, seeded):
    obj = model._default_manager.order_by('pk').first()
    if obj is None:
        pytest.skip(f'no seeded row for {model._meta.label}')
    resp = root.get(_url(model, 'change', obj.pk))
    assert resp.status_code == 200, (model._meta.label, resp.status_code)


@pytest.mark.parametrize(('model', 'model_admin'), REGISTRY, ids=IDS)
def test_anyone_else_is_sent_to_the_admin_login(model, model_admin, db):
    login = reverse('admin:login')
    anonymous = Client().get(_url(model, 'changelist'))
    assert anonymous.status_code == 302 and anonymous['Location'].startswith(login)
    family = Client()
    family.force_login(ParentFactory())
    resp = family.get(_url(model, 'changelist'))
    assert resp.status_code == 302 and resp['Location'].startswith(login)


def test_the_admin_index_renders_the_kpis(root, seeded):
    resp = root.get(reverse('admin:index'))
    assert resp.status_code == 200
    assert 'Documentos en revisión' in resp.content.decode()


class TestConsoleOwnedModelsAreReadOnly:
    """Rows the console or the services create, never the Django admin."""

    @pytest.mark.parametrize('label', ['portal.Notification', 'payments.Payment'])
    def test_no_add_change_or_delete(self, label, superuser, seeded):
        from django.apps import apps as django_apps
        model = django_apps.get_model(label)
        model_admin = admin.site._registry[model]
        req = _request(superuser)
        obj = model._default_manager.first()
        assert model_admin.has_add_permission(req) is False
        assert model_admin.has_change_permission(req, obj) is False
        assert model_admin.has_delete_permission(req, obj) is False

    def test_a_notification_added_here_could_reach_a_family(self, root, seeded):
        """The dispatcher emails rows with ``delivered_at=NULL``: the admin may not create one."""
        from apps.portal.models import Notification
        before = Notification.objects.count()
        resp = root.post(_url(Notification, 'add'), {
            'user': seeded.pk, 'notif_type': 'info', 'title': 'x', 'message': 'y'})
        assert resp.status_code == 403 and Notification.objects.count() == before

    def test_document_review_happens_in_the_console(self, superuser):
        from apps.admissions.models import RegistrationDocument
        model_admin = admin.site._registry[RegistrationDocument]
        assert not model_admin.list_editable
        assert {'is_verified', 'status', 'review_note'} <= set(model_admin.get_readonly_fields(_request(superuser)))

    def test_comunicados_are_not_activated_here(self, superuser):
        from apps.portal.models import Announcement
        model_admin = admin.site._registry[Announcement]
        assert 'is_active' not in (model_admin.list_editable or ())
        assert 'is_active' in model_admin.get_readonly_fields(_request(superuser))

    def test_a_booking_slot_is_not_moved_here(self, superuser):
        from apps.bookings.models import Booking
        model_admin = admin.site._registry[Booking]
        assert 'slot' in model_admin.get_readonly_fields(_request(superuser))

    def test_guardian_inline_uses_the_unfold_skin(self):
        from unfold.admin import StackedInline

        from apps.admissions.admin import RegistrationGuardianInline
        assert issubclass(RegistrationGuardianInline, StackedInline)


def test_dashboard_counts_pending_documents_only(superuser, seeded):
    from apps.admissions.models import RegistrationDocument
    from apps.core.dashboard import dashboard_callback

    doc = RegistrationDocument.objects.get()
    rejected = RegistrationDocument.objects.create(
        registration=doc.registration, doc_type=doc.doc_type, file=doc.file, filename='otro.pdf',
        status=RegistrationDocument.Review.REJECTED)
    assert rejected.is_verified is False
    kpis = {k['title']: k for k in dashboard_callback(_request(superuser), {})['kpis']}
    card = kpis['Documentos en revisión']
    assert card['value'] == 1 and card['link'].endswith('?status__exact=pending')


def test_unfold_uses_the_control_radius_and_an_aa_caption_colour(settings):
    assert settings.UNFOLD['BORDER_RADIUS'] == '8px'
    assert settings.UNFOLD['COLORS']['font']['subtle-light'].lower() == '#6b6482'
