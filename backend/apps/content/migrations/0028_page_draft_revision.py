# Draft conflicts (docs/cms/safe-publish.md, contract C2): every draft save
# bumps draft_revision and stamps who and when, so a save based on an older
# revision can be refused instead of silently overwriting someone else's work.

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


def backfill_draft_updated_at(apps, schema_editor):
    """Existing pages: the last change we know of is updated_at (revision stays 0)."""
    Page = apps.get_model('content', 'Page')
    Page.objects.filter(draft_updated_at__isnull=True).update(draft_updated_at=models.F('updated_at'))


class Migration(migrations.Migration):

    dependencies = [
        ('content', '0027_sitesettings_chrome'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name='page',
            name='draft_revision',
            field=models.PositiveIntegerField(default=0),
        ),
        migrations.AddField(
            model_name='page',
            name='draft_updated_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='page',
            name='draft_updated_by',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='+', to=settings.AUTH_USER_MODEL),
        ),
        migrations.RunPython(backfill_draft_updated_at, migrations.RunPython.noop),
    ]
