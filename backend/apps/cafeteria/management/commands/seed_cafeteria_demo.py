"""
Seed a realistic demo cafeteria student (Alvarado) with an opening balance and a
week of history, linked to the dev parent — so the whole wallet experience
(parent balance + history, admin console) can be shown/verified WITHOUT a live
Loyverse token. Exercises the local ledger, which is the production source of
truth (spec R1).

DEV-ONLY: refuses to run unless DEBUG or SQLITE_LOCAL is set. Idempotent — a
re-run rebuilds the same clean demo.

    python manage.py seed_cafeteria_demo
    # then log in as devparent@interlaken.test / DevParent123! → Portal → Cafetería
"""
import os
from datetime import timedelta
from decimal import Decimal

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

PARENT = ('devparent@interlaken.test', 'DevParent123!')

# (days_ago, type, amount, description, items) — oldest first; balance runs forward.
EVENTS = [
    (6, 'topup',    Decimal('500'), 'Recarga en línea', []),
    (5, 'purchase', Decimal('45'),  'Torta, 2× Jugo',
     [{'name': 'Torta', 'quantity': 1, 'total': '25.00'},
      {'name': 'Jugo', 'quantity': 2, 'total': '20.00'}]),
    (4, 'purchase', Decimal('30'),  'Sándwich',
     [{'name': 'Sándwich', 'quantity': 1, 'total': '30.00'}]),
    (3, 'topup',    Decimal('300'), 'Recarga en oficina', []),
    (2, 'purchase', Decimal('25'),  'Agua, 2× Galleta',
     [{'name': 'Agua', 'quantity': 1, 'total': '12.00'},
      {'name': 'Galleta', 'quantity': 2, 'total': '13.00'}]),
    (1, 'purchase', Decimal('35'),  'Ensalada',
     [{'name': 'Ensalada', 'quantity': 1, 'total': '35.00'}]),
]


class Command(BaseCommand):
    help = ('Seed a demo cafeteria student + balance + history linked to devparent '
            '(DEBUG/SQLITE_LOCAL only).')

    def handle(self, *args, **options):
        if not (settings.DEBUG or os.getenv('SQLITE_LOCAL')):
            raise CommandError(
                'Refusing to seed demo data outside DEBUG/SQLITE_LOCAL — '
                'this command is for local/CI databases only.')

        from apps.accounts.models import StudentProfile, User
        from apps.cafeteria.models import CafeteriaBalance, CafeteriaTransaction

        # Reuse the E2E dev parent so you can log in and see the child's wallet.
        parent, _ = User.objects.get_or_create(
            email=PARENT[0],
            defaults={'first_name': 'Dev', 'last_name': 'Parent', 'role': User.Role.PARENT})
        parent.role = User.Role.PARENT
        parent.set_password(PARENT[1])
        parent.save()

        # Student "Alvarado" (matches the Loyverse code 09628 for a realistic demo).
        suser, _ = User.objects.get_or_create(
            email='09628@alumnos.interlaken.edu.mx',
            defaults={'first_name': 'Alejandro', 'last_name': 'Alvarado Felix',
                      'role': User.Role.STUDENT})
        suser.first_name, suser.last_name, suser.role = (
            'Alejandro', 'Alvarado Felix', User.Role.STUDENT)
        suser.set_unusable_password()
        suser.save()

        profile, _ = StudentProfile.objects.get_or_create(
            user=suser,
            defaults={'student_id': '09628', 'grade': '6° Primaria', 'group': 'A'})
        profile.student_id, profile.grade, profile.group = '09628', '6° Primaria', 'A'
        profile.save()
        profile.parents.add(parent)

        # Rebuild the ledger from scratch (idempotent).
        CafeteriaTransaction.objects.filter(student=profile).delete()
        cb, _ = CafeteriaBalance.objects.get_or_create(student=profile)

        now = timezone.now()
        tx_type = {'topup': CafeteriaTransaction.TxType.TOPUP,
                   'purchase': CafeteriaTransaction.TxType.PURCHASE}
        balance = Decimal('0')
        for i, (days_ago, kind, amount, desc, items) in enumerate(EVENTS):
            balance = balance + amount if kind == 'topup' else balance - amount
            CafeteriaTransaction.objects.create(
                student=profile, transaction_type=tx_type[kind], amount=amount,
                description=desc, items=items, date=now - timedelta(days=days_ago),
                loyverse_receipt_id=f'demo-{profile.student_id}-{i}', balance_after=balance)

        # Opening balance is now locally owned (last_synced set → sync_balances won't touch it).
        cb.balance = balance
        cb.last_synced = now
        cb.save(update_fields=['balance', 'last_synced'])

        self.stdout.write(self.style.SUCCESS(
            f'Demo cafeteria seeded: {suser.full_name} (matricula {profile.student_id}) - '
            f'balance ${balance}, {len(EVENTS)} transactions.'))
        self.stdout.write(
            f'Log in as {PARENT[0]} / {PARENT[1]} -> Portal -> Cafeteria to view it.')
