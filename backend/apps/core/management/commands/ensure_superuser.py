"""
ensure_superuser — idempotent, env-driven admin bootstrap.

Render's free tier has no persistent shell, so the production superuser is
declared by env vars and reconciled on every deploy:

    DJANGO_SUPERUSER_EMAIL          (required — the login / username)
    DJANGO_SUPERUSER_PASSWORD       (set on create; also on update when
                                     DJANGO_SUPERUSER_FORCE_PASSWORD=1)
    DJANGO_SUPERUSER_FIRST_NAME     (optional)
    DJANGO_SUPERUSER_LAST_NAME      (optional)

Unlike `createsuperuser --noinput` (which only ever CREATES and errors if the
account exists), this creates the account when missing and otherwise ensures it
is an active admin (is_staff + is_superuser + role=admin). So pointing
DJANGO_SUPERUSER_EMAIL at a new address provisions that admin on the next deploy
without a shell. It never modifies or deletes other users.
"""
import os

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = 'Idempotently ensure the env-configured superuser exists and is an admin.'

    def handle(self, *args, **options):
        email = (os.environ.get('DJANGO_SUPERUSER_EMAIL') or '').strip()
        if not email:
            self.stdout.write('DJANGO_SUPERUSER_EMAIL not set - skipping admin bootstrap.')
            return

        User = get_user_model()
        password = os.environ.get('DJANGO_SUPERUSER_PASSWORD') or ''
        user, created = User.objects.get_or_create(
            email=email,
            defaults={
                'first_name': os.environ.get('DJANGO_SUPERUSER_FIRST_NAME', 'Admin'),
                'last_name': os.environ.get('DJANGO_SUPERUSER_LAST_NAME', ''),
                'role': User.Role.ADMIN,
                'is_staff': True,
                'is_superuser': True,
            },
        )

        changed = []
        if not user.is_staff:
            user.is_staff = True; changed.append('is_staff')
        if not user.is_superuser:
            user.is_superuser = True; changed.append('is_superuser')
        if user.role != User.Role.ADMIN:
            user.role = User.Role.ADMIN; changed.append('role')
        if not user.is_active:
            user.is_active = True; changed.append('is_active')

        # Password is set on creation; on an existing account only when explicitly
        # forced (so a routine redeploy never silently resets a rotated password).
        force = os.environ.get('DJANGO_SUPERUSER_FORCE_PASSWORD') == '1'
        if password and (created or force):
            user.set_password(password); changed.append('password')

        if created or changed:
            user.save()

        state = 'created' if created else ('updated' if changed else 'already current')
        detail = f' ({", ".join(changed)})' if changed and not created else ''
        self.stdout.write(self.style.SUCCESS(f'Superuser {state}: {email}{detail}'))
