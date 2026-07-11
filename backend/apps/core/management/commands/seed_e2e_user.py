"""
Create/refresh the dev superuser the Playwright E2E suite logs in as.

DEV-ONLY: refuses to run unless DEBUG or SQLITE_LOCAL is set, so the hardcoded
credentials can never be seeded into a production database.
"""
import os

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

# dev-only credentials; see e2e/helpers.ts
ADMIN = ('devadmin@interlaken.test', 'DevAdmin123!')
PARENT = ('devparent@interlaken.test', 'DevParent123!')


class Command(BaseCommand):
    help = 'Seed the dev users the Playwright E2E suite logs in as (DEBUG/SQLITE_LOCAL only).'

    def handle(self, *args, **options):
        if not (settings.DEBUG or os.getenv('SQLITE_LOCAL')):
            raise CommandError(
                'Refusing to seed E2E users outside DEBUG/SQLITE_LOCAL — '
                'this command is for local/CI test databases only.'
            )

        from apps.accounts.models import User

        self._seed(User, *ADMIN, role=User.Role.ADMIN, staff=True, superuser=True)
        self._seed(User, *PARENT, role=User.Role.PARENT, staff=False, superuser=False)

        # Clear any django-axes lockouts so a prior run's failed-login test can't
        # keep the E2E users locked out.
        from django.core.management import call_command
        try:
            call_command('axes_reset')
        except Exception:  # axes not installed / different config — non-fatal
            pass

    def _seed(self, User, email, password, *, role, staff, superuser):
        user, created = User.objects.get_or_create(
            email=email,
            defaults={'first_name': 'Dev', 'last_name': role.label, 'role': role,
                      'is_staff': staff, 'is_superuser': superuser},
        )
        user.role = role
        user.is_staff = staff
        user.is_superuser = superuser
        user.set_password(password)
        user.save()
        self.stdout.write(self.style.SUCCESS(
            f"E2E {role.label} {'created' if created else 'updated'}: {email}"
        ))
