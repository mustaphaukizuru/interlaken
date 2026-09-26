"""
Make the accent-insensitive search indexable (Data Ops Phase 10).

Phase 1 indexed ``UPPER(context)`` / ``UPPER(actor_label)`` with GIN trigrams,
but ``apps.core.listing.search_lookup`` compiles to
``UPPER(UNACCENT(col)) LIKE ...`` on Postgres, which never matches that
expression, so the Auditoría search seq-scanned the largest table (plans in
docs/PERFORMANCE.md). ``unaccent()`` itself is only STABLE and cannot appear
in an index, hence:

1. ``public.immutable_unaccent(text)``: an IMMUTABLE wrapper that calls the
   extension's ``unaccent`` with its dictionary schema-qualified (so it does
   not depend on ``search_path``). If the extension is missing the wrapper is
   the identity, so the search keeps working without accent folding.
2. GIN trigram indexes on ``UPPER(immutable_unaccent(col))`` for every field
   the audit search ORs together (``actor_label``, ``context``, ``object_id``;
   one unindexed OR branch forces a scan on its own), replacing the two Phase 1
   indexes that no query could use.

``apps.core.listing.UnaccentTransform`` calls the wrapper, so every admin
search compiles to the indexed expression. Postgres only; SQLite (tests,
laptops) is a no-op, and the search there stays plain ``icontains``.
"""

from django.db import migrations

FUNCTION = "immutable_unaccent"
OLD_INDEXES = (
    ("core_audit_context_trgm", "context"),
    ("core_audit_actor_trgm", "actor_label"),
)
NEW_INDEXES = (
    ("core_audit_actor_unacc_trgm", "actor_label"),
    ("core_audit_context_unacc_trgm", "context"),
    ("core_audit_objid_unacc_trgm", "object_id"),
)


def _unaccent_schema(cursor):
    cursor.execute(
        "SELECT n.nspname FROM pg_extension e "
        "JOIN pg_namespace n ON n.oid = e.extnamespace WHERE e.extname = 'unaccent'"
    )
    row = cursor.fetchone()
    return row[0] if row else None


def forwards(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    table = apps.get_model("core", "AuditLog")._meta.db_table
    quote = schema_editor.quote_name
    with schema_editor.connection.cursor() as cursor:
        schema = _unaccent_schema(cursor)
        if schema:
            s = quote(schema)
            body = f"SELECT {s}.unaccent('{schema}.unaccent'::regdictionary, $1)"
        else:
            body = "SELECT $1"
        cursor.execute(
            f"CREATE OR REPLACE FUNCTION public.{FUNCTION}(text) RETURNS text "
            f"LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS $func$ {body} $func$"
        )
        for name, _ in OLD_INDEXES:
            cursor.execute(f"DROP INDEX IF EXISTS {quote(name)}")
        for name, column in NEW_INDEXES:
            cursor.execute(
                f"CREATE INDEX IF NOT EXISTS {quote(name)} ON {quote(table)} "
                f"USING gin (UPPER(public.{FUNCTION}({quote(column)})) gin_trgm_ops)"
            )


def backwards(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    table = apps.get_model("core", "AuditLog")._meta.db_table
    quote = schema_editor.quote_name
    with schema_editor.connection.cursor() as cursor:
        for name, _ in NEW_INDEXES:
            cursor.execute(f"DROP INDEX IF EXISTS {quote(name)}")
        for name, column in OLD_INDEXES:
            cursor.execute(
                f"CREATE INDEX IF NOT EXISTS {quote(name)} ON {quote(table)} "
                f"USING gin (UPPER({quote(column)}) gin_trgm_ops)"
            )
        # The previous code calls UNACCENT directly; the wrapper can go.
        cursor.execute(f"DROP FUNCTION IF EXISTS public.{FUNCTION}(text)")


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0005_data_ops_indexes"),
    ]

    operations = [
        migrations.RunPython(forwards, backwards),
    ]
