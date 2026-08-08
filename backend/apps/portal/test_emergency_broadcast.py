"""Emergency broadcast (Phase D4): urgent school-wide aviso."""
import pytest
from django.urls import reverse

from apps.accounts.factories import AdminFactory, ParentFactory, StudentUserFactory
from apps.portal.models import Announcement, Notification
from apps.portal.services import emergency_broadcast

pytestmark = pytest.mark.django_db


def test_emergency_broadcast_creates_warning_and_dispatches():
    parent = ParentFactory(email='fam@test.mx')
    ParentFactory(email='otro@test.mx')  # also in audience
    staffish = StudentUserFactory(email='alumno@test.mx')  # family role path
    result = emergency_broadcast(
        title='Suspensión de clases',
        message='Por contingencia ambiental no habrá clases mañana.',
        audience=Announcement.Audience.PARENTS,
        dispatch_limit=50,
    )
    assert result['notified'] >= 2
    assert result['announcement_id']
    ann = Announcement.objects.get(pk=result['announcement_id'])
    assert ann.is_active and ann.title.startswith('Suspensión')
    warnings = Notification.objects.filter(notif_type=Notification.NotifType.WARNING)
    assert warnings.filter(user=parent).exists()
    # Immediate dispatch stamps some/all delivered_at
    assert result['dispatched'] >= 1
    assert warnings.filter(delivered_at__isnull=False).exists()
    # student-role family accounts also get PARENTS audience fan-out
    assert warnings.filter(user=staffish).exists()


def test_emergency_broadcast_rejects_empty():
    with pytest.raises(ValueError):
        emergency_broadcast(title='', message='x', audience='parents')


def test_admin_endpoint(api_client):
    admin = AdminFactory()
    ParentFactory()
    api_client.force_authenticate(admin)
    resp = api_client.post(
        reverse('admin-broadcast'),
        {
            'title': 'Simulacro',
            'message': 'Evacuación a las 10:00.',
            'audience': 'all',
            'whatsapp': False,
        },
        format='json',
    )
    assert resp.status_code == 201
    assert resp.data['notified'] >= 1
    assert Announcement.objects.filter(title='Simulacro').exists()


def test_non_admin_forbidden(api_client):
    parent = ParentFactory()
    api_client.force_authenticate(parent)
    resp = api_client.post(
        reverse('admin-broadcast'),
        {'title': 'X', 'message': 'Y', 'audience': 'parents'},
        format='json',
    )
    assert resp.status_code == 403
