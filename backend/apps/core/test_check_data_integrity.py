"""
check_data_integrity — read-only report of the duplicates the Phase 10 unique
constraints would refuse (loyverse_id, lower(email)), exit code 1 on findings.
"""

import io
import json

import pytest
from django.core.management import call_command

from apps.accounts.factories import StudentProfileFactory, UserFactory
from apps.core.management.commands.check_data_integrity import run_checks

pytestmark = pytest.mark.django_db


def _run(*args):
    out = io.StringIO()
    code = 0
    try:
        call_command("check_data_integrity", *args, stdout=out)
    except SystemExit as exc:
        code = exc.code
    return code, out.getvalue()


def test_clean_database_is_ok():
    StudentProfileFactory(loyverse_id="loy-1")
    StudentProfileFactory(loyverse_id="")
    StudentProfileFactory(loyverse_id="")  # blanks never count as duplicates
    code, out = _run()
    assert code == 0 and "OK: sin hallazgos." in out
    assert all(v == [] for v in run_checks().values())


def test_reports_duplicate_loyverse_ids_and_case_duplicate_emails():
    a = StudentProfileFactory(loyverse_id="dup-1")
    b = StudentProfileFactory(loyverse_id="dup-1")
    UserFactory(email="Familia@x.mx")
    UserFactory(email="familia@x.mx")
    code, out = _run("--json")
    assert code == 1
    report = json.loads(out)
    assert report["ok"] is False
    loy = report["findings"]["duplicate_loyverse_ids"]
    assert len(loy) == 1 and loy[0]["loyverse_id"] == "dup-1" and loy[0]["count"] == 2
    assert {s["id"] for s in loy[0]["students"]} == {a.pk, b.pk}
    emails = report["findings"]["duplicate_emails"]
    assert len(emails) == 1 and emails[0]["email"] == "familia@x.mx"
    assert sorted(u["email"] for u in emails[0]["users"]) == ["Familia@x.mx", "familia@x.mx"]
    assert report["findings"]["negative_balances"] == []
    assert report["findings"]["non_positive_topups"] == []


def test_plain_output_lists_findings():
    StudentProfileFactory(loyverse_id="dup-2")
    StudentProfileFactory(loyverse_id="dup-2")
    code, out = _run()
    assert code == 1
    assert "StudentProfile.loyverse_id duplicado: 1" in out
    assert "dup-2" in out and "1 hallazgo(s)." in out
