"""
seed_demo: realistic demo data for staging / UAT (BACKLOG P5-1).

Creates (idempotently, keyed by email / ids prefixed "demo-"):
  1 admin, 1 staff, 6 families (parents + 9 students across the 3 levels),
  cafetería balances + 30 days of purchases/top-ups, 8 pre-registros in every
  status, 3 open-class slots with bookings, 3 comunicados, 3 testimonials,
  6 calendar events, the CMS pages (via seed_cms).

Refuses to run when DEBUG is False unless --force, so it can never touch
production by accident. All demo accounts share the password "Demo-2026!".

    python manage.py seed_demo [--force] [--reset]
"""
from __future__ import annotations

import datetime as dt
import random
from decimal import Decimal

from django.conf import settings
from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

DEMO_PASSWORD = 'Demo-2026!'
FAMILIES = [
    ('López García', 'mama.lopez@demo.interlaken.mx', [('Ana', '2° Primaria', 'A'), ('Diego', '3° Preescolar', 'B')]),
    ('Martínez Ruiz', 'papa.martinez@demo.interlaken.mx', [('Sofía', '1° Secundaria', 'A')]),
    ('Hernández Torres', 'familia.hernandez@demo.interlaken.mx', [('Mateo', '5° Primaria', 'A'), ('Valentina', '1° Primaria', 'B')]),
    ('Ramírez Cruz', 'mama.ramirez@demo.interlaken.mx', [('Emilia', 'Maternal', '')]),
    ('González Flores', 'papa.gonzalez@demo.interlaken.mx', [('Santiago', '3° Secundaria', 'B'), ('Regina', '6° Primaria', 'A')]),
    ('Pérez Morales', 'familia.perez@demo.interlaken.mx', [('Leonardo', '2° Preescolar', 'A')]),
]
REFERRALS = ['Google', 'Facebook', 'Recomendación', 'Instagram', 'Letrero']


class Command(BaseCommand):
    help = 'Seed demo data for staging/UAT (never on production without --force).'

    def add_arguments(self, parser):
        parser.add_argument('--force', action='store_true', help='Allow running with DEBUG=False.')
        parser.add_argument('--reset', action='store_true', help='Delete demo rows first.')

    def handle(self, *args, **opts):
        if not settings.DEBUG and not opts['force']:
            raise CommandError('DEBUG es False: use --force solo en staging, nunca en producción.')
        random.seed(42)
        from apps.accounts.models import ParentProfile, StudentProfile, User
        from apps.admissions.models import PreRegistration
        from apps.bookings.models import AvailabilitySlot, Booking, VisitType
        from apps.cafeteria.models import CafeteriaBalance, CafeteriaTransaction
        from apps.content.models import SchoolEvent, Testimonial
        from apps.portal.models import Announcement

        if opts['reset']:
            with transaction.atomic():
                demo_students = StudentProfile.objects.filter(student_id__startswith='DEMO-')
                CafeteriaTransaction.objects.filter(student__in=demo_students).delete()
                CafeteriaBalance.objects.filter(student__in=demo_students).delete()
                demo_students.delete()
                User.objects.filter(email__endswith='@demo.interlaken.mx').delete()
                PreRegistration.objects.filter(parent_email__endswith='@demo.interlaken.mx').delete()
                Booking.objects.filter(parent_email__endswith='@demo.interlaken.mx').delete()
                AvailabilitySlot.objects.filter(title__startswith='[demo]').delete()
                Announcement.objects.filter(title__startswith='[demo]').delete()
                Testimonial.objects.filter(author__endswith='(demo)').delete()
                SchoolEvent.objects.filter(description__startswith='[demo]').delete()
            self.stdout.write('Datos demo eliminados.')

        now = timezone.now()
        today = timezone.localdate()

        def user(email, first, last, role, **extra):
            u, created = User.objects.get_or_create(email=email, defaults={'first_name': first, 'last_name': last, 'role': role, **extra})
            if created:
                u.set_password(DEMO_PASSWORD)
                u.save(update_fields=['password'])
            return u

        admin = user('direccion@demo.interlaken.mx', 'Dirección', 'Demo', User.Role.ADMIN, is_staff=True)
        user('comunicacion@demo.interlaken.mx', 'Comunicación', 'Demo', User.Role.STAFF)

        students = []
        for i, (surname, email, kids) in enumerate(FAMILIES):
            parent = user(email, 'Familia', surname, User.Role.PARENT)
            ParentProfile.objects.get_or_create(user=parent, defaults={'phone': f'55{1000000 + i * 111111:07d}'})
            for j, (name, grade, group) in enumerate(kids):
                sid = f'DEMO-{i + 1}{j + 1:02d}'
                su = user(f'{name.lower()}.{surname.split()[0].lower()}@demo.interlaken.mx', name, surname, User.Role.STUDENT)
                sp, _ = StudentProfile.objects.get_or_create(student_id=sid, defaults={'user': su, 'grade': grade, 'group': group})
                sp.parents.add(parent)
                students.append(sp)
                bal, _ = CafeteriaBalance.objects.get_or_create(student=sp, defaults={'balance': Decimal(random.choice([15, 80, 240, 410]))})
                for d in range(30):
                    if random.random() < 0.45:
                        CafeteriaTransaction.objects.get_or_create(
                            loyverse_receipt_id=f'demo-{sid}-{d}',
                            defaults={'student': sp, 'transaction_type': CafeteriaTransaction.TxType.PURCHASE,
                                      'amount': Decimal(random.choice([25, 35, 45, 60])), 'date': now - dt.timedelta(days=d, hours=random.randint(1, 6)),
                                      'description': random.choice(['Torta y jugo', 'Fruta', 'Sándwich', 'Agua y galletas'])})
                    if d % 10 == 3:
                        CafeteriaTransaction.objects.get_or_create(
                            loyverse_receipt_id=f'demo-{sid}-topup-{d}',
                            defaults={'student': sp, 'transaction_type': CafeteriaTransaction.TxType.TOPUP, 'amount': Decimal(200),
                                      'date': now - dt.timedelta(days=d), 'description': 'Recarga en caja'})

        statuses = list(PreRegistration.Status)
        for i in range(8):
            PreRegistration.objects.get_or_create(
                parent_email=f'prospecto{i + 1}@demo.interlaken.mx',
                defaults={'child_first_name': random.choice(['Lucía', 'Bruno', 'Camila', 'Iker']), 'child_last_name': random.choice(['Navarro', 'Soto', 'Vega']),
                          'child_dob': dt.date(today.year - random.choice([3, 5, 8, 12]), random.randint(1, 12), random.randint(1, 28)),
                          'level': random.choice(['preescolar', 'primaria', 'secundaria']), 'grade_applying': '1°',
                          'parent_name': f'Prospecto {i + 1}', 'parent_phone': f'55{2000000 + i:07d}', 'status': statuses[i % len(statuses)],
                          'referral_source': REFERRALS[i % len(REFERRALS)]})

        for k in range(3):
            slot, _ = AvailabilitySlot.objects.get_or_create(
                title=f'[demo] Clase abierta {k + 1}', visit_type=VisitType.OPEN_CLASS,
                defaults={'date': today + dt.timedelta(days=3 + k * 7), 'start_time': dt.time(9, 0), 'end_time': dt.time(10, 30), 'capacity': 12})
            for b in range(2):
                Booking.objects.get_or_create(slot=slot, parent_email=f'visita{k}{b}@demo.interlaken.mx',
                                              defaults={'parent_name': f'Visitante {k}{b}', 'parent_phone': '5533334444', 'child_name': 'Peque', 'child_grade': 'Preescolar'})

        for title, body, site in [
            ('[demo] Junta de padres de familia', 'Viernes 9:00 en el auditorio. Confirme asistencia con la coordinación.', False),
            ('[demo] Suspensión de clases', 'El lunes no hay clases por consejo técnico.', True),
            ('[demo] Festival de primavera', 'Ensayos la próxima semana; vestuario por grupo.', False),
        ]:
            Announcement.objects.get_or_create(title=title, defaults={'body': body, 'created_by': admin, 'show_on_site': site, 'site_link': '/calendario' if site else ''})

        for quote, author, level in [
            ('Mis hijos llegan felices y el inglés se nota desde preescolar.', 'Mariana R. (demo)', 'Preescolar'),
            ('La comunicación con el colegio es constante y cercana.', 'Carlos M. (demo)', 'Primaria'),
            ('Excelente preparación para la preparatoria.', 'Egresado 2024 (demo)', 'Secundaria'),
        ]:
            Testimonial.objects.get_or_create(author=author, defaults={'quote': quote, 'role': 'Familia', 'level': level, 'is_published': True})

        for i, (title, kind) in enumerate([('Inicio de ciclo', 'event'), ('Consejo técnico', 'holiday'), ('Festival de primavera', 'event'),
                                           ('Entrega de boletas', 'event'), ('Vacaciones', 'holiday'), ('Clase abierta', 'event')]):
            SchoolEvent.objects.get_or_create(title=title, start_date=today + dt.timedelta(days=2 + i * 9),
                                              defaults={'kind': kind, 'description': '[demo] Evento de ejemplo', 'is_published': True})

        call_command('seed_cms', publish=False, stdout=self.stdout)
        self.stdout.write(self.style.SUCCESS(
            f'Demo listo: admin direccion@demo.interlaken.mx / staff comunicacion@demo.interlaken.mx / familias *@demo.interlaken.mx '
            f'(contraseña {DEMO_PASSWORD}); {len(students)} alumnos.'))
