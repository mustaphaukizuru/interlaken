"""Data Ops Phase 10 query budgets: the CMS media list and every CMS export.

The other CMS lists are pinned in ``test_data_ops.py::test_list_query_budgets``.
Each test here parametrizes a small and a large row count and asserts the SAME
constant; exports are consumed inside the assert block so the streamed rows
and the audit insert are counted.
"""

from datetime import date

import pytest
from django.urls import reverse

from apps.accounts.factories import AdminFactory
from apps.content.forms import FormDefinition, FormSubmission
from apps.content.media import MediaAsset
from apps.content.models import SchoolEvent, Testimonial
from apps.content.navigation import Redirect
from apps.content.pages import Page

pytestmark = pytest.mark.django_db

FIELDS = [
    {"key": "nombre", "label": "Nombre", "type": "text", "required": True},
    {"key": "acepta", "label": "Acepta", "type": "checkbox"},
]

# count + page + referenced ids (page drafts, published versions, comunicados:
# three reads, independent of the number of assets).
MEDIA_LIST_BUDGET = 5
# count + rows + audit insert, per export (see EXPORTS for the exceptions).
EXPORT_BUDGET = 3


def _body(resp) -> bytes:
    return b"".join(resp.streaming_content) if resp.streaming else resp.content


def _csv_lines(resp) -> list[str]:
    return [line for line in _body(resp).decode("utf-8-sig").split("\r\n")[1:] if line]


@pytest.fixture
def admin(api_client, settings, tmp_path):
    settings.MEDIA_ROOT = str(tmp_path)
    api_client.force_authenticate(AdminFactory())
    return api_client


def _seed(n):
    form = FormDefinition.objects.create(slug="f", title="F", fields=FIELDS)
    for i in range(n):
        SchoolEvent.objects.create(title=f"E{i}", start_date=date(2026, 10, i + 1))
        Testimonial.objects.create(quote="q", author=f"A{i}")
        Redirect.objects.create(from_path=f"/r{i}", to_path="/x")
        FormSubmission.objects.create(form=form, data={"nombre": f"N{i}"})
        Page.objects.create(slug=f"p{i}", title=f"P{i}")
        FormDefinition.objects.create(slug=f"f{i}", title=f"F{i}", fields=FIELDS)
        MediaAsset.objects.create(filename=f"m{i}.png", content_type="image/png", size=10)
    return form


@pytest.mark.parametrize("n", [1, 12])
def test_media_list(admin, django_assert_num_queries, n):
    _seed(n)
    with django_assert_num_queries(MEDIA_LIST_BUDGET):
        resp = admin.get(reverse("admin-media"))
    assert resp.status_code == 200
    assert resp.data["count"] == n


# (url name, uses the form pk, rows beyond n, budget)
EXPORTS = [
    ("admin-pages-export", False, 0, None),
    ("admin-redirects-export", False, 0, None),
    ("admin-forms-export", False, 1, None),  # + the seeded form "f"
    ("admin-form-submissions-export", True, 0, 4),  # + the form lookup
    ("admin-media-export", False, 0, None),
    ("admin-testimonials-export", False, 0, None),
    ("admin-calendar-export", False, 0, None),
]


@pytest.mark.parametrize("n", [1, 12])
@pytest.mark.parametrize("name,with_form,extra,budget", EXPORTS)
def test_exports(admin, django_assert_num_queries, n, name, with_form, extra, budget):
    form = _seed(n)
    args = [form.pk] if with_form else []
    with django_assert_num_queries(EXPORT_BUDGET if budget is None else budget):
        resp = admin.get(reverse(name, args=args))
        assert resp.status_code == 200
        assert len(_csv_lines(resp)) == n + extra
