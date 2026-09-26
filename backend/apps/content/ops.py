"""
content/ops.py — shared pieces of the Data Ops round for the CMS + comunicados
(Phase 8): audited CRUD, audited deletes, tri-state filters and the media
reference scan.

* ``AuditedCrudMixin``: the CMS models are not signal-tracked (a bulk path or an
  import would then write two audit rows per change), so every single-row
  create/update/delete of the console records one ``AuditLog`` explicitly.
* ``delete_keep_pk``: ``Model.delete()`` resets ``pk`` to ``None``; bulk and the
  mixin restore it so the audit row names the deleted id.
* ``referenced_media_ids``: every ``MediaAsset`` id a page (draft or published
  version), a page's SEO image or a comunicado attachment points at. Media
  bulk delete refuses those; the list exposes ``referenced`` and an
  ``unreferenced`` filter.
"""

from __future__ import annotations

import re
from datetime import date, datetime
from decimal import Decimal

import django_filters
from django.core.cache import cache

from apps.core.audit import record

TRUE_VALUES = frozenset({"1", "true", "si", "sí", "yes", "on"})
FALSE_VALUES = frozenset({"0", "false", "no", "off"})
MEDIA_URL_RE = re.compile(r"/content/media/(\d+)/")
MEDIA_ID_KEYS = frozenset({"image", "og_image", "poster", "asset", "background"})

ICS_CACHE_KEY = "content:calendar.ics"
TESTIMONIALS_CACHE_KEY = "content:testimonials"


# ── audit ─────────────────────────────────────────────────
def audit_value(value):
    """A JSON-safe, bounded representation of one field value for ``changes``."""
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, (list, dict)):
        return "(modificado)"
    if hasattr(value, "pk"):
        return value.pk
    if isinstance(value, str) and len(value) > 200:
        return value[:200] + "…"
    return value


def delete_keep_pk(instance):
    """``instance.delete()`` keeping ``instance.pk`` so audit rows name the deleted id."""
    pk = instance.pk
    instance.delete()
    instance.pk = pk
    return instance


class AuditedCrudMixin:
    """``perform_create/update/destroy`` that write one audit row each.

    ``audit_context`` labels the row (``cms.calendar``); ``after_write(instance)``
    runs after every write (cache invalidation).
    """

    audit_context = ""

    def after_write(self, instance):  # pragma: no cover - hook
        return None

    def perform_create(self, serializer):
        instance = serializer.save()
        changes = {
            k: [None, audit_value(getattr(instance, k, None))] for k in serializer.validated_data
        }
        record("create", instance, changes, actor=self.request.user, context=self.audit_context)
        self.after_write(instance)

    def perform_update(self, serializer):
        before = {k: getattr(serializer.instance, k, None) for k in serializer.validated_data}
        instance = serializer.save()
        diff = {}
        for key, old in before.items():
            new = getattr(instance, key, None)
            if old != new:
                diff[key] = [audit_value(old), audit_value(new)]
        if diff:
            record("update", instance, diff, actor=self.request.user, context=self.audit_context)
        self.after_write(instance)

    def perform_destroy(self, instance):
        delete_keep_pk(instance)
        record("delete", instance, {}, actor=self.request.user, context=self.audit_context)
        self.after_write(instance)


# ── filters ───────────────────────────────────────────────
def tri_state(value) -> bool | None:
    text = str(value or "").strip().lower()
    if text in TRUE_VALUES:
        return True
    if text in FALSE_VALUES:
        return False
    return None


def bool_filter(field: str) -> django_filters.CharFilter:
    """``?x=1|0|true|false|si|no``; anything else (``''``, ``todos``) means no filter."""

    def apply(qs, _name, value):
        flag = tri_state(value)
        return qs if flag is None else qs.filter(**{field: flag})

    return django_filters.CharFilter(method=apply)


# ── media references ──────────────────────────────────────
def _walk(value, out: set[int], key: str = "") -> None:
    if isinstance(value, dict):
        for k, v in value.items():
            _walk(v, out, str(k))
    elif isinstance(value, list):
        for v in value:
            _walk(v, out, key)
    elif isinstance(value, bool):
        return
    elif isinstance(value, int):
        if key in MEDIA_ID_KEYS:
            out.add(value)
    elif isinstance(value, str):
        out.update(int(m) for m in MEDIA_URL_RE.findall(value))
        if key in MEDIA_ID_KEYS and value.isdigit():
            out.add(int(value))


def referenced_media_ids() -> set[int]:
    """Asset ids used by page drafts, published versions, SEO images and comunicado attachments."""
    from apps.portal.models import Announcement

    from .pages import Page, PageVersion

    out: set[int] = set()
    for blocks, seo in Page.objects.values_list("draft_blocks", "seo"):
        _walk(blocks, out)
        _walk(seo, out)
    published = Page.objects.exclude(published_version__isnull=True).values_list(
        "published_version_id", flat=True
    )
    for blocks, seo in PageVersion.objects.filter(pk__in=list(published)).values_list(
        "blocks", "seo"
    ):
        _walk(blocks, out)
        _walk(seo, out)
    for attachments in Announcement.objects.exclude(attachments=[]).values_list(
        "attachments", flat=True
    ):
        for item in attachments or []:
            if isinstance(item, dict) and isinstance(item.get("id"), int):
                out.add(item["id"])
    return out


# ── caches ────────────────────────────────────────────────
def invalidate_calendar() -> None:
    cache.delete(ICS_CACHE_KEY)


def invalidate_testimonials() -> None:
    cache.delete(TESTIMONIALS_CACHE_KEY)


# ── bulk action factories ─────────────────────────────────
def flag_action(name, label_es, field, value, *, skip_reason, after=None):
    """Set a boolean ``field`` to ``value``; rows already there are *omitidas*."""
    from apps.core.bulk import BulkAction, BulkSkip

    def plan(instance, payload):
        if getattr(instance, field) == value:
            raise BulkSkip(skip_reason)

    def handler(instance, payload, actor):
        plan(instance, payload)
        setattr(instance, field, value)
        instance.save()
        return {field: [not value, value]}

    return BulkAction(
        name=name,
        label_es=label_es,
        handler=handler,
        plan=plan,
        side_effects="batched" if after else "none",
        after=after,
    )


def delete_action(*, guard=None, after=None, destroy=None, label_es="Eliminar"):
    """Delete rows; ``guard(instance) -> str | None`` skips a row with that reason."""
    from apps.core.bulk import BulkAction, BulkSkip

    def plan(instance, payload):
        reason = guard(instance) if guard else None
        if reason:
            raise BulkSkip(reason)

    def handler(instance, payload, actor):
        plan(instance, payload)
        label = str(instance)[:200]
        if destroy is not None:
            destroy(instance)
        else:
            delete_keep_pk(instance)
        return {"deleted": label}

    return BulkAction(
        name="delete",
        label_es=label_es,
        handler=handler,
        plan=plan,
        side_effects="batched" if after else "none",
        after=after,
        audit_action="delete",
    )
