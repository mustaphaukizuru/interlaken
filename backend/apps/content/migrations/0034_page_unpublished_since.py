"""Page.unpublished_since («Revisión antes de publicar», 2026-11-21).

Since when a page's draft differs from its published version; None while they
match. Page.save() keeps it from now on. The editor shows «Este borrador tiene
cambios sin publicar desde …» once it is three days old, and «Contenido» lists
it next to each page.

Backfill, per page whose draft differs from what is published:
* published before: the first draft save after that publication, from the
  audit trail (``cms.page`` updates of ``draft_blocks`` or ``seo``); without
  one, the last draft save (``draft_updated_at``), else ``updated_at``;
* never published: when the page was created.

Backwards drops the column (nothing else depends on it).
"""
import json

from django.db import migrations, models


def _same(a, b) -> bool:
    return json.dumps(a, sort_keys=True) == json.dumps(b, sort_keys=True)


def backfill(apps, schema_editor):
    Page = apps.get_model('content', 'Page')
    AuditLog = apps.get_model('core', 'AuditLog')
    for page in Page.objects.select_related('published_version'):
        live = page.published_version
        if live is not None and _same(page.draft_blocks, live.blocks) and _same(page.seo, live.seo):
            continue
        if live is None:
            since = page.created_at
        else:
            since = None
            rows = (AuditLog.objects
                    .filter(object_type='content.page', object_id=str(page.pk), action='update',
                            context='cms.page', created_at__gt=live.created_at)
                    .order_by('created_at').values_list('created_at', 'changes')[:500])
            for at, changes in rows:
                if isinstance(changes, dict) and ({'draft_blocks', 'seo'} & set(changes)):
                    since = at
                    break
            since = since or page.draft_updated_at or page.updated_at
        Page.objects.filter(pk=page.pk).update(unpublished_since=since)


class Migration(migrations.Migration):

    dependencies = [
        ('content', '0033_ficha_privada_links'),
        ('core', '0006_audit_search_unaccent_trgm'),
    ]

    operations = [
        migrations.AddField(
            model_name='page',
            name='unpublished_since',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.RunPython(backfill, migrations.RunPython.noop),
    ]
