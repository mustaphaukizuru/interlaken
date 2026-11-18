"""
check_money_queries: run the row-locked money queries against THIS database.

SQLite (the test suite) ignores row locks, so a ``select_for_update`` that
PostgreSQL refuses only ever fails in production: on 2026-11-18 every
«Verificar en MultiCobros» was a 500. This evaluates every locked queryset of
the payment and cafetería paths, plus the lock every admin bulk action takes
(see ``apps/core/money_queries.py`` for the list and how each mirrors the code),
on the real database:

    docker compose exec -T app python manage.py check_money_queries
    docker compose exec -T app python manage.py check_money_queries -v 2   # every query

Read-only and quick: each query targets a primary key that cannot exist, so it
matches and locks no row, and everything runs in one transaction that is
always rolled back, with a 5 s statement and 2 s lock timeout. Safe on
production at any time; ``deploy/deploy.sh`` runs it after the live check.

Exit code 1 (CommandError) when any query fails, naming it, its source and
the database error.
"""

from django.core.management.base import BaseCommand, CommandError
from django.db import connection

from apps.core.money_queries import run_checks


class Command(BaseCommand):
    help = (
        "Run the row-locked money queries (payments, cafetería, bulk actions) against this "
        "database. Read-only: one transaction, always rolled back."
    )

    def handle(self, *args, **options):
        verbosity = options["verbosity"]
        results = run_checks()
        failed = [r for r in results if not r.ok]
        vendor = connection.vendor

        for result in results:
            if not result.ok:
                self.stderr.write(f"  FAIL  {result.name}")
                self.stderr.write(f"        source: {result.source}")
                self.stderr.write(f"        error:  {result.error}")
            elif verbosity >= 2:
                self.stdout.write(f"  ok    {result.name}  ({result.source})")

        if failed:
            raise CommandError(
                f"{len(failed)} of {len(results)} money queries FAIL on this database "
                f"({vendor}). The code that runs them returns a 500 until it is fixed."
            )
        if verbosity >= 1:
            self.stdout.write(
                self.style.SUCCESS(
                    f"money queries OK: {len(results)} row-locked queries run on {vendor} "
                    "(rolled back, nothing written)"
                )
            )
