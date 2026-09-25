"""
Postgres extensions for accent-insensitive search and trigram indexes
(Data Ops Phase 1). Guarded: runs only when the connection is PostgreSQL, so
the SQLite test suite and a developer laptop migrate unchanged. Reversal is a
no-op on purpose: dropping an extension other objects may depend on is an
operator decision, not a migration's.

``unaccent`` backs ``apps.core.listing.search_lookup`` (``field__unaccent__icontains``);
``pg_trgm`` backs the GIN indexes on ``AuditLog.context`` / ``actor_label``
created in ``0005_data_ops_indexes``.
"""
from django.db import migrations

EXTENSIONS = ('unaccent', 'pg_trgm')


def create_extensions(apps, schema_editor):
    if schema_editor.connection.vendor != 'postgresql':
        return
    with schema_editor.connection.cursor() as cursor:
        for name in EXTENSIONS:
            cursor.execute(f'CREATE EXTENSION IF NOT EXISTS {name}')


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0003_opsstatus'),
    ]

    operations = [
        migrations.RunPython(create_extensions, migrations.RunPython.noop),
    ]
