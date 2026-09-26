"""
seed_perf_data: bulk volume for query-plan checks (Data Ops Phase 10).

Fills a THROWAWAY database with production-like volumes so ``EXPLAIN
(ANALYZE, BUFFERS)`` on the admin lists means something:

    python manage.py seed_perf_data --students 400 --transactions 80000 --audit 250000

Creates (all tagged so they are recognisable and never collide with real rows):
  * student users ``perf-NNNNN@perf.invalid`` + StudentProfile ``PERF-NNNNN``
    (``loyverse_id`` ``perf-lv-NNNNN``, unique) + one CafeteriaBalance each with
    a varied balance (some negative, some high);
  * guardian users ``perf-parent-NNNNN@perf.invalid`` (one per two students);
  * CafeteriaTransaction rows (receipt ``PERF-R-NNNNNNNN``) spread over ~2 years;
  * AuditLog rows (``actor_label`` starts with ``perf-``), insert only;
  * Payment rows (``gateway_ref`` ``PERF-P-NNNNNNN``) in every status;
  * PreRegistration rows (``perf-pre-NNNNN@perf.invalid``) in every status.

Idempotent: each run counts the tagged rows already present and only tops up
to the requested totals, so re-running never duplicates. Refuses to run when
DEBUG is False unless ``--force``. Never point it at production.
"""

from __future__ import annotations

import datetime as dt
import random
from decimal import Decimal

from django.conf import settings
from django.contrib.auth.hashers import make_password
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

BATCH = 2000
DOMAIN = "@perf.invalid"
STUDENT_EMAIL_RE = r"^perf-[0-9]{5}@perf\.invalid$"
SPAN_DAYS = 730  # ~2 school years of history

FIRST = [
    "Ana",
    "Diego",
    "Sofía",
    "Mateo",
    "Valentina",
    "Santiago",
    "Regina",
    "Leonardo",
    "Emilia",
    "Camila",
    "Sebastián",
    "Ximena",
    "Emiliano",
    "Renata",
    "Daniel",
    "Lucía",
]
LAST = [
    "López",
    "García",
    "Martínez",
    "Ruiz",
    "Hernández",
    "Torres",
    "Ramírez",
    "Cruz",
    "González",
    "Flores",
    "Pérez",
    "Morales",
    "Sánchez",
    "Díaz",
    "Reyes",
    "Vargas",
]
GRADES = [
    ("Maternal", ""),
    ("1° Preescolar", "A"),
    ("2° Preescolar", "A"),
    ("3° Preescolar", "B"),
    ("1° Primaria", "A"),
    ("2° Primaria", "B"),
    ("3° Primaria", "A"),
    ("4° Primaria", "B"),
    ("5° Primaria", "A"),
    ("6° Primaria", "B"),
    ("1° Secundaria", "A"),
    ("2° Secundaria", "A"),
    ("3° Secundaria", "B"),
]
ITEMS = [
    "Torta de jamón",
    "Agua natural",
    "Jugo de naranja",
    "Sándwich",
    "Fruta picada",
    "Quesadilla",
    "Galletas",
    "Yogurt",
]
AUDIT_CONTEXTS = [
    "admin:students.update",
    "admin:cafeteria.adjust",
    "admin:cafeteria.refund",
    "import:loyverse_students",
    "export:students.csv",
    "webhook:payments",
    "admin:admissions.status",
    "admin:users.permissions",
    "cron:sync_balances",
    "admin:preregistrations.bulk",
]
AUDIT_TYPES = [
    "accounts.studentprofile",
    "accounts.user",
    "cafeteria.cafeteriabalance",
    "cafeteria.cafeteriatransaction",
    "payments.payment",
    "admissions.preregistration",
]


class Command(BaseCommand):
    help = "Seed bulk performance data into a throwaway database (never production)."

    def add_arguments(self, parser):
        parser.add_argument("--students", type=int, default=400)
        parser.add_argument("--transactions", type=int, default=80000)
        parser.add_argument("--audit", type=int, default=250000)
        parser.add_argument("--payments", type=int, default=3000)
        parser.add_argument("--preregistrations", type=int, default=3000)
        parser.add_argument("--force", action="store_true", help="Allow running with DEBUG=False.")

    def handle(self, *args, **opts):
        if not settings.DEBUG and not opts["force"]:
            raise CommandError(
                "seed_perf_data refuses to run with DEBUG=False: it inserts hundreds of "
                "thousands of fake rows. Use --force only on a throwaway database, never production."
            )
        for key in ("students", "transactions", "audit", "payments", "preregistrations"):
            if opts[key] < 0:
                raise CommandError(f"--{key} must be >= 0")

        self.now = timezone.now()
        self.rng = random.Random(10)
        students = self._students(opts["students"])
        parents = self._parents((opts["students"] + 1) // 2)
        self._transactions(opts["transactions"], students)
        self._audit(opts["audit"], parents)
        self._payments(opts["payments"], parents)
        self._preregistrations(opts["preregistrations"])

    # ── helpers ──────────────────────────────────────────────
    def _when(self) -> dt.datetime:
        return self.now - dt.timedelta(seconds=self.rng.randint(0, SPAN_DAYS * 86400))

    def _report(self, label, created, total):
        self.stdout.write(f"{label}: +{created} (total {total})")

    def _chunks(self, start, stop, build):
        """Insert rows ``build(i)`` for i in [start, stop) in atomic batches."""
        for lo in range(start, stop, BATCH):
            hi = min(lo + BATCH, stop)
            rows = [build(i) for i in range(lo, hi)]
            model = type(rows[0])
            with transaction.atomic():
                model.objects.bulk_create(rows, batch_size=BATCH)

    # ── students, wallets, guardians ─────────────────────────
    def _students(self, target):
        from apps.accounts.models import StudentProfile, User
        from apps.cafeteria.models import CafeteriaBalance

        password = make_password(None)  # unusable: seeded accounts can never log in
        have = User.objects.filter(email__regex=STUDENT_EMAIL_RE).count()

        def build_user(i):
            return User(
                email=f"perf-{i:05d}{DOMAIN}",
                first_name=FIRST[i % len(FIRST)],
                last_name=f"{LAST[i % len(LAST)]} {LAST[(i * 7) % len(LAST)]}",
                role=User.Role.STUDENT,
                password=password,
            )

        if target > have:
            self._chunks(have, target, build_user)
        users = {u.email: u for u in User.objects.filter(email__regex=STUDENT_EMAIL_RE)}

        existing = set(
            StudentProfile.objects.filter(student_id__startswith="PERF-").values_list(
                "student_id", flat=True
            )
        )
        profiles = []
        for i in range(target):
            sid = f"PERF-{i:05d}"
            if sid in existing:
                continue
            grade, group = GRADES[i % len(GRADES)]
            profiles.append(
                StudentProfile(
                    user=users[f"perf-{i:05d}{DOMAIN}"],
                    student_id=sid,
                    grade=grade,
                    group=group,
                    loyverse_id=f"perf-lv-{i:05d}",
                    status=StudentProfile.Status.ACTIVE,
                    enrollment_date=(
                        self.now - dt.timedelta(days=self.rng.randint(0, 2000))
                    ).date(),
                )
            )
        with transaction.atomic():
            StudentProfile.objects.bulk_create(profiles, batch_size=BATCH)
        students = list(
            StudentProfile.objects.filter(student_id__startswith="PERF-").order_by("student_id")
        )
        self._report("students", len(profiles), len(students))

        have_wallet = set(
            CafeteriaBalance.objects.filter(student__in=students).values_list(
                "student_id", flat=True
            )
        )
        wallets = [
            CafeteriaBalance(
                student=s, balance=self._balance(), last_synced=self.now, seeded_at=self.now
            )
            for s in students
            if s.pk not in have_wallet
        ]
        with transaction.atomic():
            CafeteriaBalance.objects.bulk_create(wallets, batch_size=BATCH)
        self._report("wallets", len(wallets), len(students))
        return students

    def _balance(self) -> Decimal:
        roll = self.rng.random()
        if roll < 0.05:
            cents = self.rng.randint(-8000, -100)  # overdrawn (POS debits past zero)
        elif roll < 0.15:
            cents = 0
        elif roll < 0.9:
            cents = self.rng.randint(100, 60000)
        else:
            cents = self.rng.randint(60000, 300000)  # a few large wallets
        return Decimal(cents) / 100

    def _parents(self, target):
        from apps.accounts.models import User

        password = make_password(None)
        qs = User.objects.filter(email__startswith="perf-parent-", email__endswith=DOMAIN)
        have = qs.count()
        if target > have:
            self._chunks(
                have,
                target,
                lambda i: User(
                    email=f"perf-parent-{i:05d}{DOMAIN}",
                    first_name=FIRST[(i * 3) % len(FIRST)],
                    last_name=LAST[(i * 5) % len(LAST)],
                    role=User.Role.PARENT,
                    password=password,
                ),
            )
        parents = list(qs.order_by("email"))
        self._report("parents", max(target - have, 0), len(parents))
        return parents

    # ── ledger ───────────────────────────────────────────────
    def _transactions(self, target, students):
        from apps.cafeteria.models import CafeteriaTransaction

        have = CafeteriaTransaction.objects.filter(
            loyverse_receipt_id__startswith="PERF-R-"
        ).count()
        if target <= have or not students:
            self._report("cafeteria transactions", 0, have)
            return
        TT = CafeteriaTransaction.TxType
        kinds = [TT.PURCHASE] * 16 + [TT.TOPUP] * 3 + [TT.REFUND, TT.ADJUSTMENT]

        def build(i):
            kind = self.rng.choice(kinds)
            when = self._when()
            if kind == TT.TOPUP:
                amount = Decimal(self.rng.choice([100, 200, 300, 500, 1000]))
                items = []
            else:
                amount = Decimal(self.rng.randint(1500, 12000)) / 100
                items = [{"name": self.rng.choice(ITEMS), "quantity": 1, "total": str(amount)}]
            return CafeteriaTransaction(
                student=students[i % len(students)],
                transaction_type=kind,
                amount=amount,
                description=f"Recibo PERF {i}",
                date=when,
                recorded_at=when,
                loyverse_receipt_id=f"PERF-R-{i:08d}",
                items=items,
                balance_after=Decimal(self.rng.randint(0, 150000)) / 100,
            )

        self._chunks(have, target, build)
        self._report("cafeteria transactions", target - have, target)

    # ── audit (insert only: the queryset refuses update/delete) ──
    def _audit(self, target, parents):
        from apps.core.models import AuditLog

        have = AuditLog.objects.filter(actor_label__startswith="perf-").count()
        if target <= have:
            self._report("audit log", 0, have)
            return
        actions = [a for a, _ in AuditLog.Action.choices]

        def build(i):
            actor = parents[i % len(parents)] if parents else None
            return AuditLog(
                actor=actor,
                actor_label=actor.email if actor else f"perf-system-{i % 7}",
                action=actions[i % len(actions)],
                object_type=AUDIT_TYPES[i % len(AUDIT_TYPES)],
                object_id=str(self.rng.randint(1, 5000)),
                context=self.rng.choice(AUDIT_CONTEXTS),
                changes={"balance": [str(self.rng.randint(0, 999)), str(self.rng.randint(0, 999))]},
                created_at=self._when(),
            )

        self._chunks(have, target, build)
        self._report("audit log", target - have, target)

    # ── payments ─────────────────────────────────────────────
    def _payments(self, target, parents):
        from apps.payments.models import Payment

        have = Payment.objects.filter(gateway_ref__startswith="PERF-P-").count()
        if target <= have:
            self._report("payments", 0, have)
            return
        S = Payment.Status
        statuses = [S.SUCCESS] * 6 + [S.FAILED] * 2 + [S.PENDING, S.PROCESSING, S.REFUNDED]
        gateways = [g for g, _ in Payment.Gateway.choices]

        def build(i):
            status = self.rng.choice(statuses)
            created = self._when()
            done = status in (S.SUCCESS, S.REFUNDED)
            return Payment(
                user=parents[i % len(parents)] if parents else None,
                payment_type=Payment.Type.CAFETERIA,
                amount=Decimal(self.rng.choice([100, 200, 300, 500, 1000])),
                status=status,
                description="Recarga cafetería (perf)",
                gateway=gateways[i % len(gateways)],
                gateway_tx_id=f"PERF-TX-{i:07d}" if done else None,
                gateway_ref=f"PERF-P-{i:07d}",
                created_at=created,
                completed_at=created + dt.timedelta(minutes=3) if done else None,
            )

        self._chunks(have, target, build)
        self._report("payments", target - have, target)

    # ── admissions ───────────────────────────────────────────
    def _preregistrations(self, target):
        from apps.admissions.models import PreRegistration

        have = PreRegistration.objects.filter(
            parent_email__startswith="perf-pre-", parent_email__endswith=DOMAIN
        ).count()
        if target <= have:
            self._report("pre-registrations", 0, have)
            return
        PS, PL = PreRegistration.Status, PreRegistration.Level
        statuses = [PS.PENDING] * 4 + [PS.CONTACTED] * 3 + [PS.ENROLLED] * 2 + [PS.REJECTED]
        levels = [PL.PRESCHOOL, PL.PRIMARY, PL.SECONDARY]

        def build(i):
            created = self._when()
            return PreRegistration(
                child_first_name=FIRST[i % len(FIRST)],
                child_last_name=LAST[(i * 3) % len(LAST)],
                child_dob=(created - dt.timedelta(days=365 * self.rng.randint(3, 14))).date(),
                level=levels[i % 3],
                grade_applying=GRADES[i % len(GRADES)][0],
                cycle=f"{created.year}-{created.year + 1}",
                parent_name=f"{FIRST[(i * 5) % len(FIRST)]} {LAST[i % len(LAST)]}",
                parent_email=f"perf-pre-{i:05d}{DOMAIN}",
                parent_phone=f"55{i:08d}",
                referral_source=self.rng.choice(
                    ["Google", "Facebook", "Recomendación", "Instagram"]
                ),
                status=self.rng.choice(statuses),
                created_at=created,
            )

        self._chunks(have, target, build)
        self._report("pre-registrations", target - have, target)
