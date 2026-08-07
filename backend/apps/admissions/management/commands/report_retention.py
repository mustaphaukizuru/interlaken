"""
report_retention — REPORT-ONLY audit of personal data past its retention window
(IK-LEGAL B4). It NEVER deletes: erasing minors' / families' records is a human
decision (and may conflict with ARCO / fiscal obligations). Wire it to cron to
surface candidates for review.
"""
from datetime import timedelta

from django.core.management.base import BaseCommand
from django.utils import timezone

from apps.accounts.models import StudentProfile
from apps.admissions.models import PreRegistration, Registration


class Command(BaseCommand):
    help = 'Report (never delete) personal data past its retention window.'

    def add_arguments(self, parser):
        parser.add_argument('--rejected-days', type=int, default=365,
                            help='Days after which rejected leads/registrations are flagged.')

    def handle(self, *args, **options):
        cutoff = timezone.now() - timedelta(days=options['rejected_days'])

        rejected_leads = PreRegistration.objects.filter(
            status=PreRegistration.Status.REJECTED, updated_at__lte=cutoff)
        rejected_regs = Registration.objects.filter(
            status=Registration.Status.REJECTED, updated_at__lte=cutoff)
        withdrawn = StudentProfile.objects.filter(is_active=False)

        self.stdout.write(self.style.WARNING(
            'Retention report (REPORT ONLY — nothing was deleted):'))
        self.stdout.write(
            f'  Rejected pre-registros older than {options["rejected_days"]}d: '
            f'{rejected_leads.count()}  ids={list(rejected_leads.values_list("id", flat=True)[:50])}')
        self.stdout.write(
            f'  Rejected inscripciones older than {options["rejected_days"]}d: '
            f'{rejected_regs.count()}  ids={list(rejected_regs.values_list("id", flat=True)[:50])}')
        self.stdout.write(
            f'  Withdrawn (inactive) students: {withdrawn.count()}  '
            f'ids={list(withdrawn.values_list("id", flat=True)[:50])}')
        self.stdout.write(
            'Review these for erasure manually; deletion is intentionally not automated.')
