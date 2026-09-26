"""Data Ops Phase 8: comunicados on the list contract, bulk, exports, guards, audit."""

from datetime import timedelta

import pytest
from django.urls import reverse
from django.utils import timezone

from apps.accounts.factories import AdminFactory, ParentFactory
from apps.core.models import AuditLog
from apps.portal.models import Announcement, AnnouncementRead, Notification

pytestmark = pytest.mark.django_db

LIST = reverse("admin-announcements")
BULK = reverse("admin-announcements-bulk")


@pytest.fixture
def admin(api_client):
    user = AdminFactory()
    api_client.force_authenticate(user)
    return user


def _ids(resp):
    return [row["id"] for row in resp.data["results"]]


def _body(resp) -> str:
    raw = b"".join(resp.streaming_content) if resp.streaming else resp.content
    return raw.decode("utf-8-sig")


def test_search_filters_and_ordering(api_client, admin):
    reader = ParentFactory()
    a = Announcement.objects.create(
        title="Suspensión de clases", body="viernes", audience="parents"
    )
    b = Announcement.objects.create(
        title="Junta",
        body="Salón de usos múltiples",
        audience="staff",
        is_active=False,
        requires_ack=True,
        publish_at=timezone.now() + timedelta(days=2),
    )
    AnnouncementRead.objects.create(announcement=b, user=reader)
    assert _ids(api_client.get(LIST + "?q=usos")) == [b.pk]
    assert _ids(api_client.get(LIST + "?audience=parents")) == [a.pk]
    assert _ids(api_client.get(LIST + "?active=0")) == [b.pk]
    assert _ids(api_client.get(LIST + "?scheduled=1")) == [b.pk]
    assert _ids(api_client.get(LIST + "?requires_ack=1")) == [b.pk]
    assert _ids(api_client.get(LIST + "?ordering=-reads")) == [b.pk, a.pk]
    assert _ids(api_client.get(LIST + "?ordering=title")) == [b.pk, a.pk]
    today = timezone.localdate().isoformat()
    assert api_client.get(LIST + f"?from={today}&to={today}").data["count"] == 2


def test_create_update_delete_are_audited_and_delete_is_guarded(api_client, admin):
    r = api_client.post(LIST, {"title": "Borrador", "body": "x", "is_active": False}, format="json")
    pk = r.data["id"]
    url = reverse("admin-announcement-detail", args=[pk])
    api_client.patch(url, {"title": "Borrador 2"}, format="json")
    assert api_client.delete(url).status_code == 204
    actions = list(
        AuditLog.objects.filter(object_type="portal.announcement", object_id=str(pk))
        .order_by("pk")
        .values_list("action", flat=True)
    )
    assert actions == ["create", "update", "delete"]

    sent = Announcement.objects.create(title="Enviado", body="x", fanout_at=timezone.now())
    resp = api_client.delete(reverse("admin-announcement-detail", args=[sent.pk]))
    assert resp.status_code == 400 and "desactívelo" in resp.data["detail"]
    assert Announcement.objects.filter(pk=sent.pk).exists()


def test_patch_activation_follows_transition_table(api_client, admin):
    parent = ParentFactory()
    draft = Announcement.objects.create(title="D", body="x", audience="parents", is_active=False)
    url = reverse("admin-announcement-detail", args=[draft.pk])
    assert api_client.patch(url, {"is_active": True}, format="json").status_code == 200
    assert Notification.objects.filter(user=parent).count() == 1
    assert api_client.patch(url, {"is_active": False}, format="json").status_code == 200
    draft.refresh_from_db()
    assert draft.fanout_at is not None and draft.is_active is False


def test_bulk_activate_deactivate_duplicate_delete(api_client, admin):
    parent = ParentFactory()
    draft = Announcement.objects.create(
        title="Nuevo", body="x", audience="parents", is_active=False
    )
    live = Announcement.objects.create(
        title="Vivo", body="y", audience="parents", fanout_at=timezone.now()
    )

    plan = api_client.post(
        BULK, {"action": "activate", "ids": [draft.pk, live.pk], "dry_run": True}, format="json"
    )
    assert plan.data["ok"] == 1 and plan.data["skipped"][0]["id"] == live.pk
    assert Notification.objects.count() == 0

    api_client.post(BULK, {"action": "activate", "ids": [draft.pk]}, format="json")
    draft.refresh_from_db()
    assert draft.is_active and draft.fanout_at is not None
    assert Notification.objects.filter(user=parent).count() == 1

    off = api_client.post(BULK, {"action": "deactivate", "ids": [draft.pk, live.pk]}, format="json")
    assert off.data["ok"] == 2
    again = api_client.post(BULK, {"action": "activate", "ids": [draft.pk]}, format="json")
    assert again.data["ok"] == 1
    assert Notification.objects.filter(user=parent).count() == 1  # never re-notified

    dup = api_client.post(BULK, {"action": "duplicate", "ids": [live.pk]}, format="json")
    assert dup.data["ok"] == 1
    copy = Announcement.objects.get(title="Copia de Vivo")
    assert copy.is_active is False and copy.fanout_at is None and copy.created_by == admin

    delete = api_client.post(BULK, {"action": "delete", "ids": [copy.pk, live.pk]}, format="json")
    assert delete.data["ok"] == 1 and delete.data["skipped"][0]["id"] == live.pk
    assert not Announcement.objects.filter(pk=copy.pk).exists()
    assert AuditLog.objects.filter(object_type="bulk:portal.announcement").count() == 5


def test_list_and_delivery_exports(api_client, admin):
    parent = ParentFactory(first_name="Paula", last_name="Pérez")
    a = Announcement.objects.create(title="Aviso", body="x", audience="parents", requires_ack=True)
    Announcement.objects.create(title="Otro", body="y", audience="staff")
    Notification.objects.create(
        user=parent, title="Aviso", message="x", announcement=a, is_read=True
    )
    AnnouncementRead.objects.create(announcement=a, user=parent, acknowledged_at=timezone.now())

    csv = _body(api_client.get(reverse("admin-announcements-export") + "?fmt=csv&audience=parents"))
    assert "Aviso" in csv and "Otro" not in csv
    assert api_client.get(reverse("admin-announcements-export") + "?fmt=pdf").status_code == 400

    delivery = api_client.get(
        reverse("admin-announcement-delivery-export", args=[a.pk]) + "?fmt=csv"
    )
    text = _body(delivery)
    assert "Paula" in text and "Sí" in text
    x = api_client.get(reverse("admin-announcement-delivery-export", args=[a.pk]) + "?fmt=xlsx")
    assert x.content[:2] == b"PK"
    assert AuditLog.objects.filter(object_type="export:portal.announcement.delivery").count() == 2
