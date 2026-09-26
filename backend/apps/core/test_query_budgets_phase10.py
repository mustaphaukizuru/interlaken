"""Data Ops Phase 10 query budgets: the audit and contact-inbox exports.

The lists are pinned in ``test_audit_contract.py`` and
``test_contact_inbox_contract.py``. Each export is consumed inside the assert
block so the streamed rows and the audit insert are counted, and the count
must not grow with the rows.
"""

import pytest
from django.urls import reverse

from apps.accounts.factories import AdminFactory
from apps.core.audit import record
from apps.core.models import AuditLog, ContactMessage

pytestmark = pytest.mark.django_db

# count + rows (actor joined) + audit insert.
AUDIT_EXPORT_BUDGET = 3
# count + rows + audit insert.
CONTACT_EXPORT_BUDGET = 3


def _body(resp) -> bytes:
    return b"".join(resp.streaming_content) if resp.streaming else resp.content


def _csv_lines(resp) -> list[str]:
    return [line for line in _body(resp).decode("utf-8-sig").split("\r\n")[1:] if line]


@pytest.mark.parametrize("n", [1, 12])
def test_audit_export(api_client, django_assert_num_queries, n):
    admin = AdminFactory()
    actors = [AdminFactory() for _ in range(3)]
    for i in range(n):
        record(
            "update",
            object_type="qb.thing",
            object_id=str(i),
            changes={"k": [0, i]},
            actor=actors[i % 3],
            context="qb.phase10",
        )
    api_client.force_authenticate(admin)
    expected = AuditLog.objects.filter(context="qb.phase10").count()
    with django_assert_num_queries(AUDIT_EXPORT_BUDGET):
        resp = api_client.get(reverse("core-admin-audit-export"), {"context": "qb.phase10"})
        assert len(_csv_lines(resp)) == expected == n


@pytest.mark.parametrize("n", [1, 12])
def test_contact_export(api_client, django_assert_num_queries, n):
    for i in range(n):
        ContactMessage.objects.create(
            name=f"N{i}", email=f"n{i}@t.mx", subject="Informes", message="Hola"
        )
    api_client.force_authenticate(AdminFactory())
    with django_assert_num_queries(CONTACT_EXPORT_BUDGET):
        resp = api_client.get(reverse("core-contact-inbox-export"))
        assert len(_csv_lines(resp)) == n
