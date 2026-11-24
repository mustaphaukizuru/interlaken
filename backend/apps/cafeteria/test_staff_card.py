"""P1-A9: an admin can fetch one student's credencial card; families cannot use ?student=."""
import pytest
from django.urls import reverse

from apps.accounts.factories import AdminFactory, ParentFactory, StudentProfileFactory

pytestmark = pytest.mark.django_db


def test_admin_gets_one_students_card(api_client):
    a, b = StudentProfileFactory(), StudentProfileFactory()
    api_client.force_authenticate(user=AdminFactory())
    resp = api_client.get(reverse('cafeteria-cards'), {'student': b.pk})
    assert resp.status_code == 200
    assert [c['student']['id'] for c in resp.data] == [b.pk]
    assert resp.data[0]['code'] == b.student_id or resp.data[0]['code']
    assert a.pk not in [c['student']['id'] for c in resp.data]


def test_parent_cannot_peek_with_student_param(api_client):
    parent = ParentFactory()
    mine = StudentProfileFactory(parents=[parent])
    other = StudentProfileFactory()
    api_client.force_authenticate(user=parent)
    resp = api_client.get(reverse('cafeteria-cards'), {'student': other.pk})
    assert [c['student']['id'] for c in resp.data] == [mine.pk]


# A staff member's own cafetería account never reads «Alumno» (2026-11-19):
# the card carries tipo/puesto so the credential shows the puesto instead.
STAFF = {'tipo': 'personal', 'grade': '', 'group': ''}


@pytest.mark.parametrize('kw, expected', [
    ({}, ('alumno', '', '')),
    ({**STAFF, 'puesto': 'docente'}, ('personal', 'docente', 'Docente')),
    ({**STAFF, 'puesto': 'sin_asignar'}, ('personal', 'sin_asignar', 'Sin asignar')),
], ids=['alumno', 'personal-con-puesto', 'personal-sin-asignar'])
def test_card_says_whether_it_is_a_pupil_or_staff(api_client, kw, expected):
    parent = ParentFactory()
    account = StudentProfileFactory(parents=[parent], **kw)
    api_client.force_authenticate(user=parent)
    [card] = api_client.get(reverse('cafeteria-cards')).data
    student = card['student']
    assert student['id'] == account.pk
    assert (student['tipo'], student['puesto'], student['puesto_label']) == expected


# The credential looks like the printed card (2026-11-22): it carries the
# account's photo, the uploaded one first, else the Google picture, else ''.
def test_card_carries_the_accounts_photo(api_client):
    parent = ParentFactory()
    google = StudentProfileFactory(parents=[parent], user__avatar='https://lh3.googleusercontent.com/a/abc=s96-c')
    none = StudentProfileFactory(parents=[parent], user__avatar='')
    api_client.force_authenticate(user=parent)
    photos = {c['student']['id']: c['student']['photo'] for c in api_client.get(reverse('cafeteria-cards')).data}
    assert photos == {google.pk: 'https://lh3.googleusercontent.com/a/abc=s96-c', none.pk: ''}


def test_an_uploaded_photo_wins_over_google(api_client, settings, tmp_path):
    from django.core.files.base import ContentFile

    settings.MEDIA_ROOT = tmp_path
    parent = ParentFactory()
    account = StudentProfileFactory(parents=[parent], user__avatar='https://lh3.googleusercontent.com/a/abc=s96-c')
    account.user.avatar_file.save('avatars/x.webp', ContentFile(b'RIFF'), save=True)
    api_client.force_authenticate(user=parent)
    [card] = api_client.get(reverse('cafeteria-cards')).data
    assert card['student']['photo'].startswith(f'/api/v1/accounts/avatar/{account.user.pk}/')


# «Subir foto» (owner, 2026-11-22): a school switch, off by default; when on, a
# parent sets or removes their own child's photo, never anyone else's.
def _png() -> bytes:
    import io

    from PIL import Image
    buf = io.BytesIO()
    Image.new('RGB', (40, 60), (200, 30, 60)).save(buf, format='PNG')
    return buf.getvalue()


def _upload(api_client, pk):
    from django.core.files.uploadedfile import SimpleUploadedFile
    f = SimpleUploadedFile('foto.png', _png(), content_type='image/png')
    return api_client.post(reverse('cafeteria-card-photo', args=[pk]), {'file': f}, format='multipart')


def _switch(on: bool):
    from apps.content.models import SiteSettings
    s = SiteSettings.load()
    s.families_upload_photos = on
    s.save()


def test_photo_upload_is_off_by_default(api_client, settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path
    parent = ParentFactory()
    child = StudentProfileFactory(parents=[parent])
    api_client.force_authenticate(user=parent)
    [card] = api_client.get(reverse('cafeteria-cards')).data
    assert card['can_upload_photo'] is False
    assert _upload(api_client, child.pk).status_code == 403


def test_parent_uploads_and_removes_their_childs_photo(api_client, settings, tmp_path):
    from apps.core.models import AuditLog
    settings.MEDIA_ROOT = tmp_path
    _switch(True)
    parent = ParentFactory()
    child = StudentProfileFactory(parents=[parent], user__avatar='')
    api_client.force_authenticate(user=parent)
    [card] = api_client.get(reverse('cafeteria-cards')).data
    assert card['can_upload_photo'] is True
    res = _upload(api_client, child.pk)
    assert res.status_code == 200 and res.data['photo'].startswith(f'/api/v1/accounts/avatar/{child.user.pk}/')
    assert AuditLog.objects.filter(context='Credencial: foto subida por la familia').exists()
    gone = api_client.delete(reverse('cafeteria-card-photo', args=[child.pk]))
    assert gone.status_code == 200 and gone.data['photo'] == ''


def test_never_another_familys_child_or_a_staff_account(api_client, settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path
    _switch(True)
    parent = ParentFactory()
    StudentProfileFactory(parents=[parent])
    other = StudentProfileFactory()
    staff_account = StudentProfileFactory(parents=[parent], tipo='personal', grade='', group='')
    api_client.force_authenticate(user=parent)
    assert _upload(api_client, other.pk).status_code == 404
    assert _upload(api_client, staff_account.pk).status_code == 404
    # An admin looking at a card from the console gets no upload button.
    api_client.force_authenticate(user=AdminFactory())
    [card] = api_client.get(reverse('cafeteria-cards'), {'student': other.pk}).data
    assert card['can_upload_photo'] is False
    assert _upload(api_client, other.pk).status_code == 403


def test_card_photo_refuses_a_pixel_bomb(api_client, settings, tmp_path):
    # QA sweep 2026-11-24: same pixel cap as the profile photo (store_avatar).
    from django.core.files.uploadedfile import SimpleUploadedFile

    from apps.accounts.test_avatar import _png_claiming
    settings.MEDIA_ROOT = tmp_path
    _switch(True)
    parent = ParentFactory()
    child = StudentProfileFactory(parents=[parent], user__avatar='')
    api_client.force_authenticate(user=parent)
    bomb = _png_claiming(9400, 9400)
    assert isinstance(bomb, SimpleUploadedFile)
    res = api_client.post(reverse('cafeteria-card-photo', args=[child.pk]), {'file': bomb},
                          format='multipart')
    assert res.status_code == 400
    assert 'demasiado grande' in str(res.data)
