"""
backup_database — timestamped DB backup with rotation.

Postgres (prod) → gzipped pg_dump (password via PGPASSWORD env, never argv).
MySQL (legacy)  → gzipped mysqldump (password via MYSQL_PWD env, never argv).
SQLite (dev)    → consistent copy via sqlite3's online backup API.

Usage:
    python manage.py backup_database [--output-dir DIR] [--keep N]

The production Supabase Postgres DB is also backed up off-site nightly by the
`db-backup` GitHub Actions workflow (pg_dump → uploaded artifact). This command
covers local/manual backups and any host with the app + a DB client on PATH.
Restores: a backup that has never been restored is not a backup.
"""
import gzip
import shutil
import sqlite3
import subprocess
from datetime import datetime
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

DEFAULT_KEEP = 14


class Command(BaseCommand):
    help = 'Create a timestamped database backup and rotate old ones.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--output-dir', default=str(Path(settings.BASE_DIR).parent / 'backups'),
            help='Directory for backup files (default: <repo>/backups, gitignored).')
        parser.add_argument(
            '--keep', type=int, default=DEFAULT_KEEP,
            help=f'How many most-recent backups to retain (default {DEFAULT_KEEP}).')

    def handle(self, *args, **opts):
        db = settings.DATABASES['default']
        out_dir = Path(opts['output_dir'])
        out_dir.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now().strftime('%Y%m%d-%H%M%S')
        engine = db['ENGINE']

        if 'sqlite' in engine:
            target = out_dir / f"db-{stamp}.sqlite3"
            self._backup_sqlite(Path(db['NAME']), target)
        elif 'postgresql' in engine:
            target = out_dir / f"db-{stamp}.sql.gz"
            self._backup_postgres(db, target)
        elif 'mysql' in engine:
            target = out_dir / f"db-{stamp}.sql.gz"
            self._backup_mysql(db, target)
        else:
            raise CommandError(f'Unsupported engine for backup: {engine}')

        removed = self._rotate(out_dir, keep=opts['keep'])
        size_kb = target.stat().st_size // 1024
        # ASCII only: Windows consoles (cp1252) choke on unicode arrows.
        self.stdout.write(self.style.SUCCESS(
            f'Backup OK -> {target} ({size_kb} KB); rotated out {removed} old file(s).'))

    def _backup_sqlite(self, source: Path, target: Path):
        if not source.exists():
            raise CommandError(f'SQLite file not found: {source}')
        src = sqlite3.connect(str(source))
        dst = sqlite3.connect(str(target))
        try:
            with dst:
                src.backup(dst)   # online backup API → consistent snapshot
        finally:
            dst.close()
            src.close()

    def _backup_postgres(self, db: dict, target: Path):
        pg_dump = shutil.which('pg_dump')
        if not pg_dump:
            raise CommandError('pg_dump not found on PATH.')
        cmd = [
            pg_dump,
            '--no-owner', '--no-privileges',
            f"--host={db.get('HOST') or 'localhost'}",
            f"--port={db.get('PORT') or '5432'}",
            f"--username={db['USER']}",
            db['NAME'],
        ]
        import os
        # Password via PGPASSWORD env, never argv (visible in process list).
        env = {**os.environ, 'PGPASSWORD': db.get('PASSWORD') or ''}
        proc = subprocess.run(cmd, capture_output=True, env=env)
        if proc.returncode != 0:
            raise CommandError(f'pg_dump failed: {proc.stderr.decode()[:400]}')
        with gzip.open(target, 'wb') as fh:
            fh.write(proc.stdout)

    def _backup_mysql(self, db: dict, target: Path):
        mysqldump = shutil.which('mysqldump')
        if not mysqldump:
            raise CommandError('mysqldump not found on PATH.')
        cmd = [
            mysqldump,
            '--single-transaction', '--quick', '--no-tablespaces',
            f"--host={db.get('HOST') or 'localhost'}",
            f"--port={db.get('PORT') or '3306'}",
            f"--user={db['USER']}",
            db['NAME'],
        ]
        import os
        env = {**os.environ, 'MYSQL_PWD': db['PASSWORD']}
        proc = subprocess.run(cmd, capture_output=True, env=env)
        if proc.returncode != 0:
            raise CommandError(f'mysqldump failed: {proc.stderr.decode()[:400]}')
        with gzip.open(target, 'wb') as fh:
            fh.write(proc.stdout)

    def _rotate(self, out_dir: Path, keep: int) -> int:
        backups = sorted(
            [p for p in out_dir.iterdir()
             if p.name.startswith('db-') and p.is_file()],
            key=lambda p: p.name, reverse=True)
        stale = backups[keep:]
        for path in stale:
            path.unlink()
        return len(stale)
