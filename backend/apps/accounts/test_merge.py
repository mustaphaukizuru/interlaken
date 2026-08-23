import pytest
from django.urls import reverse

from apps.accounts.factories import ParentFactory, StudentProfileFactory
from apps.accounts.models import ParentProfile, StudentProfile, User
from apps.core.models import AuditLog
from apps.portal.models import Announcement, AnnouncementRead, Notification


@pytest.mark.django_db
def test_merge_moves_children_and_references(admin_client, admin_user):
    keep = ParentFactory(email='mama@gmail.com')
    drop = ParentFactory(email='mama@hotmail.com')
    ParentProfile.objects.get_or_create(user=keep, defaults={'phone': ''})
    ParentProfile.objects.get_or_create(user=drop, defaults={'phone': '5511111111'})
    child = StudentProfileFactory()
    child.parents.set([drop])
    Notification.objects.create(user=drop, notif_type='info', title='t', message='m')
    ann = Announcement.objects.create(title='a', body='b', created_by=admin_user)
    AnnouncementRead.objects.create(announcement=ann, user=keep)
    AnnouncementRead.objects.create(announcement=ann, user=drop)  # would collide → skipped

    pv = admin_client.get(reverse('guardian-merge-preview') + f'?keep={keep.pk}&drop={drop.pk}')
    assert pv.status_code == 200 and pv.data['drop']['children'][0]['id'] == child.pk
    assert pv.data['references']['portal.Notification.user'] == 1

    assert admin_client.post(reverse('guardian-merge'), {'keep': keep.pk, 'drop': drop.pk, 'confirm': 'no'}, format='json').status_code == 400
    assert admin_client.post(reverse('guardian-merge'), {'keep': keep.pk, 'drop': keep.pk, 'confirm': 'FUSIONAR'}, format='json').status_code == 400
    r = admin_client.post(reverse('guardian-merge'), {'keep': keep.pk, 'drop': drop.pk, 'confirm': 'FUSIONAR'}, format='json')
    assert r.status_code == 200, r.data
    assert r.data['moved']['children'] == 1 and r.data['moved']['portal.Notification.user'] == 1
    assert r.data['skipped'].get('portal.AnnouncementRead.user') == 1

    assert list(StudentProfile.objects.get(pk=child.pk).parents.values_list('pk', flat=True)) == [keep.pk]
    assert Notification.objects.get().user_id == keep.pk
    assert ParentProfile.objects.get(user=keep).phone == '5511111111'
    drop.refresh_from_db()
    assert drop.is_active is False and User.objects.filter(pk=drop.pk).exists()
    assert AuditLog.objects.filter(context='guardian.merge').exists()


@pytest.mark.django_db
def test_merge_rejects_non_parents(admin_client, admin_user):
    p = ParentFactory()
    r = admin_client.post(reverse('guardian-merge'), {'keep': p.pk, 'drop': admin_user.pk, 'confirm': 'FUSIONAR'}, format='json')
    assert r.status_code == 400
