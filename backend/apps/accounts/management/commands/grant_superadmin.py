"""
grant_superadmin — make one account the school's super administrator.

A super administrator is a portal admin (``role=admin``: the whole /admin
console, including Personal, where staff accounts are created) AND a Django
superuser with ``is_staff`` (the technical /django-admin/ panel). The portal
never lets another admin edit or deactivate a superuser, so the account cannot
be locked out from the console.

Idempotent and audited (``AuditLog`` context ``ops.grant_superadmin``). It never
reads, prints or sets a usable password: with ``--create`` a missing account is
created with an unusable one, and its owner sets it with
``manage.py changepassword <email>`` (or "Olvidé mi contraseña").

    python manage.py grant_superadmin colegio@interlaken.com.mx
    python manage.py grant_superadmin nuevo@interlaken.com.mx --create --first-name Ana --last-name Ruiz
"""

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

FLAGS = ('role', 'is_staff', 'is_superuser', 'is_active')


class Command(BaseCommand):
    help = 'Grant portal admin + Django superuser to an account (audited, no passwords).'

    def add_arguments(self, parser):
        parser.add_argument('email')
        parser.add_argument('--create', action='store_true',
                            help='Create the account (unusable password) when it does not exist.')
        parser.add_argument('--first-name', default='')
        parser.add_argument('--last-name', default='')

    def handle(self, *args, email, create, first_name, last_name, **options):
        from apps.accounts.models import User
        from apps.core.audit import record

        email = User.objects.normalize_email(email.strip())
        if '@' not in email:
            raise CommandError(f'Correo no válido: {email!r}')
        with transaction.atomic():
            user = User.objects.select_for_update().filter(email__iexact=email).first()
            created = False
            if user is None:
                if not create:
                    raise CommandError(f'No existe la cuenta {email}. Use --create para crearla.')
                user = User(email=email, first_name=first_name.strip() or 'Administración',
                            last_name=last_name.strip())
                user.set_unusable_password()
                created = True
            before = {f: getattr(user, f) for f in FLAGS} if not created else None
            user.role = User.Role.ADMIN
            user.is_staff = True
            user.is_superuser = True
            user.is_active = True
            user.save()
            after = {f: getattr(user, f) for f in FLAGS}
            if before == after:
                self.stdout.write(f'{email}: ya es superadministrador; sin cambios.')
                return
            record('create' if created else 'update', user, {'before': before, 'after': after},
                   actor=None, context='ops.grant_superadmin')
        self.stdout.write(self.style.SUCCESS(
            f'{email}: {"creada y " if created else ""}ahora es superadministrador '
            f'(portal admin + Django superusuario).'))
        if created:
            self.stdout.write(f'Defina su contraseña con: python manage.py changepassword {email}')
