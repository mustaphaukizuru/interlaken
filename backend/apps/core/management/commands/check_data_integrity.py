"""
check_data_integrity — report the duplicates the Data Ops constraints would refuse.

Read-only. Run it in production BEFORE shipping the partial unique constraints
(``StudentProfile.loyverse_id`` where not blank, ``Lower(User.email)``) planned
for Data Ops Phase 10, and before the CheckConstraints of Phase 1
(``TopUpRequest.amount > 0``, ``CafeteriaBalance.balance >= 0``):

    docker compose exec -T app python manage.py check_data_integrity
    docker compose exec -T app python manage.py check_data_integrity --json

Exit code 1 when anything is found, so a deploy script can gate on it. The
cleanup paths are the guardian merge tool (``apps/accounts/merge.py``) for
duplicate emails and the Vincular Loyverse flow for duplicate customer ids.
"""

import json

from django.core.management.base import BaseCommand
from django.db.models import Count
from django.db.models.functions import Lower


def duplicate_loyverse_ids():
    from apps.accounts.models import StudentProfile

    rows = (
        StudentProfile.objects.exclude(loyverse_id="")
        .values("loyverse_id")
        .annotate(n=Count("id"))
        .filter(n__gt=1)
        .order_by("loyverse_id")
    )
    out = []
    for row in rows:
        students = (
            StudentProfile.objects.filter(loyverse_id=row["loyverse_id"])
            .select_related("user")
            .order_by("pk")
        )
        out.append(
            {
                "loyverse_id": row["loyverse_id"],
                "count": row["n"],
                "students": [
                    {
                        "id": s.pk,
                        "matricula": s.student_id,
                        "name": s.user.full_name,
                        "status": s.status,
                    }
                    for s in students
                ],
            }
        )
    return out


def duplicate_emails():
    from apps.accounts.models import User

    rows = (
        User.objects.annotate(email_lower=Lower("email"))
        .values("email_lower")
        .annotate(n=Count("id"))
        .filter(n__gt=1)
        .order_by("email_lower")
    )
    out = []
    for row in rows:
        users = (
            User.objects.annotate(email_lower=Lower("email"))
            .filter(email_lower=row["email_lower"])
            .order_by("pk")
        )
        out.append(
            {
                "email": row["email_lower"],
                "count": row["n"],
                "users": [
                    {"id": u.pk, "email": u.email, "role": u.role, "is_active": u.is_active}
                    for u in users
                ],
            }
        )
    return out


def negative_balances():
    from apps.cafeteria.models import CafeteriaBalance

    return [
        {"id": b.pk, "matricula": b.student.student_id, "balance": str(b.balance)}
        for b in (
            CafeteriaBalance.objects.filter(balance__lt=0).select_related("student").order_by("pk")
        )
    ]


def non_positive_topups():
    from apps.cafeteria.models import TopUpRequest

    return [
        {"id": t.pk, "matricula": t.student.student_id, "amount": str(t.amount), "status": t.status}
        for t in (
            TopUpRequest.objects.filter(amount__lte=0).select_related("student").order_by("pk")
        )
    ]


CHECKS = (
    ("duplicate_loyverse_ids", "StudentProfile.loyverse_id duplicado", duplicate_loyverse_ids),
    ("duplicate_emails", "User.email duplicado (sin distinguir mayúsculas)", duplicate_emails),
    ("negative_balances", "CafeteriaBalance.balance negativo", negative_balances),
    ("non_positive_topups", "TopUpRequest.amount ≤ 0", non_positive_topups),
)


def run_checks() -> dict:
    return {key: fn() for key, _, fn in CHECKS}


class Command(BaseCommand):
    help = (
        "Reporta duplicados y valores que las restricciones de Data Ops rechazarían (solo lectura)."
    )

    def add_arguments(self, parser):
        parser.add_argument("--json", action="store_true", help="Salida JSON.")

    def handle(self, *args, **options):
        report = run_checks()
        total = sum(len(v) for v in report.values())
        if options["json"]:
            self.stdout.write(
                json.dumps({"ok": total == 0, "findings": report}, ensure_ascii=False, indent=2)
            )
        else:
            for key, title, _ in CHECKS:
                items = report[key]
                self.stdout.write(f"{title}: {len(items)}")
                for item in items:
                    self.stdout.write(f"  - {json.dumps(item, ensure_ascii=False)}")
            if total == 0:
                self.stdout.write(self.style.SUCCESS("OK: sin hallazgos."))
            else:
                self.stdout.write(self.style.WARNING(f"{total} hallazgo(s)."))
        if total:
            raise SystemExit(1)
