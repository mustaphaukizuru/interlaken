"""
repair_phantom_topups — undo the POS-mirror credits that only echoed a purchase.

Background (2026-09-23 audit): Loyverse's ``customers.update`` webhook can carry
a points snapshot taken BEFORE a sale, and it arrives a few seconds after the
receipt event has already debited the wallet. For that moment Loyverse reads
higher than our ledger by exactly the purchase, and the mirror credited the
difference as a "recarga en caja". 31 such rows, $679, across 29 students. The
mirror now waits for the ledger to settle (``_pos_delta_is_settled``); this
command cleans up what it wrote before that guard existed.

Dry run by default. Each candidate is checked against the LIVE Loyverse balance
before anything is written: a phantom is reversed only when the student still
carries at least that much drift (local above Loyverse). If a later cash
recarga already absorbed the phantom (the mirror credited less than the
family paid, so the balance is right and only the history is off) it is
reported as ``absorbed`` and left alone: reversing it would take real money
away from the child.

    python manage.py repair_phantom_topups            # report only
    python manage.py repair_phantom_topups --commit   # write the reversals
"""
from decimal import Decimal

from django.core.management.base import BaseCommand

from apps.cafeteria import services
from apps.cafeteria.models import CafeteriaBalance

REASON = ('Recarga registrada por error: Loyverse informó el saldo previo a una compra '
          'de {amount} ya descontada (recibo {receipt}).')


class Command(BaseCommand):
    help = 'Reverse POS-mirror credits that merely echoed a purchase (dry run unless --commit).'

    def add_arguments(self, parser):
        parser.add_argument('--commit', action='store_true',
                            help='Write the reversals (default: report only).')

    def handle(self, *args, **o):
        commit = o['commit']
        try:
            points = {c.get('id'): services.get_balance_from_customer(c)
                      for c in services.get_all_customers()}
        except services.LoyverseError as e:
            self.stderr.write(self.style.ERROR(f'Loyverse unreachable, nothing checked: {e}'))
            return

        pairs = services.find_phantom_topups()
        if not pairs:
            self.stdout.write(self.style.SUCCESS('No phantom POS credits found.'))
            return

        # Walk per student, NEWEST phantom first. A phantom gets absorbed only
        # by a cash recarga that comes AFTER it (the mirror credits less than
        # the family paid), so when a wallet carries an old absorbed phantom
        # and a fresh live one, the drift belongs to the fresh one. Oldest-
        # first would spend the drift on the absorbed row and leave the real
        # one standing (student 10135 on 2026-09-23: 6 reversed, 15 left).
        pairs.sort(key=lambda p: (p[0].student_id, -p[0].id))
        local = {}
        reversed_n = absorbed = no_remote = 0
        reversed_total = Decimal('0')
        self.stdout.write(f'{"matrícula":<10} {"alumno":<32} {"monto":>8} {"deriva":>8}  acción')
        for topup, purchase in pairs:
            student = topup.student
            if student.id not in local:
                cb = CafeteriaBalance.objects.filter(student=student).first()
                local[student.id] = Decimal(str(cb.balance if cb else 0))
            remote = points.get(student.loyverse_id)
            amount = Decimal(str(topup.amount))
            name = student.user.full_name[:32]
            if remote is None:
                no_remote += 1
                self.stdout.write(f'{student.student_id:<10} {name:<32} {amount:>8} {"?":>8}  '
                                  'sin cliente en Loyverse, se omite')
                continue
            drift = local[student.id] - Decimal(str(remote))
            if drift < amount:
                absorbed += 1
                self.stdout.write(f'{student.student_id:<10} {name:<32} {amount:>8} {drift:>8}  '
                                  'absorbida por una recarga posterior, saldo correcto')
                continue
            action = 'REVERTIDA' if commit else 'se revertiría'
            if commit:
                adj = services.reverse_phantom_topup(
                    topup, reason=REASON.format(amount=f'${amount:.2f}',
                                                receipt=purchase.loyverse_receipt_id))
                if adj is None:
                    action = 'ya revertida'
            reversed_n += 1
            reversed_total += amount
            local[student.id] -= amount
            self.stdout.write(f'{student.student_id:<10} {name:<32} {amount:>8} {drift:>8}  {action}')

        mode = 'written' if commit else 'DRY RUN, nothing written (add --commit)'
        self.stdout.write(self.style.SUCCESS(
            f'\n{len(pairs)} phantom(s): {reversed_n} reversed (${reversed_total}), '
            f'{absorbed} absorbed, {no_remote} without a Loyverse customer. {mode}.'))
