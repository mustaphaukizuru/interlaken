"""Automatic years (2026-11-22): the year of each Costos price group and the
month from which the site announces the next school cycle."""
from importlib import import_module

import pytest
from django.apps import apps as global_apps
from django.core.cache import cache

from apps.accounts.factories import ParentFactory, UserFactory
from apps.core.models import AuditLog

from .models import SiteSettings
from .pages import Page, PageVersion

pytestmark = pytest.mark.django_db

YEARS = "/api/v1/content/admin/pricing/years/"
PUBLIC_SETTINGS = "/api/v1/content/settings/"
ADMIN_SETTINGS = "/api/v1/content/admin/settings/"

mig = import_module("apps.content.migrations.0035_automatic_years")


@pytest.fixture(autouse=True)
def _clear_cache():
    cache.clear()
    yield
    cache.clear()


def test_only_admins_publish_price_years(api_client):
    assert api_client.get(YEARS).status_code in (401, 403)
    api_client.force_authenticate(user=ParentFactory())
    assert api_client.patch(YEARS, {"years": {"fees": 2028}}, format="json").status_code == 403
    staff = UserFactory(role="staff", staff_areas=["admisiones", "comunicados", "cafeteria"])
    api_client.force_authenticate(user=staff)
    assert api_client.patch(YEARS, {"years": {"fees": 2028}}, format="json").status_code == 403


def test_publish_a_year_per_group_is_audited_and_public(admin_client, api_client):
    s = SiteSettings.load()
    s.pricing_years = {"fees": 2027, "tuition": 2027, "insurance": 2026}
    s.save()
    api_client.get(PUBLIC_SETTINGS)  # warm the public cache: the save must clear it

    res = admin_client.patch(YEARS, {"years": {"insurance": 2027, "extras": "2027"}}, format="json")
    assert res.status_code == 200
    assert res.json()["years"] == {"fees": 2027, "tuition": 2027, "insurance": 2027, "extras": 2027}
    assert api_client.get(PUBLIC_SETTINGS).json()["pricing_years"]["insurance"] == 2027
    log = AuditLog.objects.filter(object_type="content.sitesettings").latest("id")
    assert log.changes["pricing_years"][0]["insurance"] == 2026
    assert log.changes["pricing_years"][1]["insurance"] == 2027

    # Same values again: nothing to record.
    count = AuditLog.objects.count()
    admin_client.patch(YEARS, {"years": {"insurance": 2027}}, format="json")
    assert AuditLog.objects.count() == count


@pytest.mark.parametrize("years, message", [
    ({}, "al menos una"),
    ({"colegiatura": 2027}, "desconocida"),
    ({"fees": "dos mil"}, "número"),
    ({"fees": 1999}, "entre 2000 y 2100"),
])
def test_rejects_bad_years(admin_client, years, message):
    res = admin_client.patch(YEARS, {"years": years}, format="json")
    assert res.status_code == 400
    assert message in str(res.json())


def test_settings_cannot_overwrite_price_years_and_take_the_month(admin_client):
    s = SiteSettings.load()
    s.pricing_years = {"fees": 2027}
    s.save()
    res = admin_client.patch(ADMIN_SETTINGS, {"pricing_years": {"fees": 1990}, "admissions_next_from_month": 11}, format="json")
    assert res.status_code == 200
    s.refresh_from_db()
    assert s.pricing_years == {"fees": 2027}
    assert s.admissions_next_from_month == 11
    bad = admin_client.patch(ADMIN_SETTINGS, {"admissions_next_from_month": 3}, format="json")
    assert bad.status_code == 400


def test_public_settings_carry_the_month_and_years(api_client):
    data = api_client.get(PUBLIC_SETTINGS).json()
    assert data["admissions_next_from_month"] == 1
    assert "pricing_years" in data


def test_backfill_reads_the_published_costos_page():
    s = SiteSettings.load()
    s.pricing_years = {}
    s.save()
    page = Page.objects.create(slug="costos", title="Costos", status="published")
    page.published_version = PageVersion.objects.create(page=page, number=1, blocks=[
        {"type": "costos.hero", "props": {"badge": "Ciclo Escolar {{ciclo}}"}},
        {"type": "costos.prices", "props": {"feesYear": "Precios 2028", "insuranceYear": "Precios 2027", "extrasYear": ""}},
    ])
    page.save()
    mig.backfill(global_apps, None)
    s.refresh_from_db()
    # Read from the page where it says a year, the 2026-11 price sheet elsewhere.
    assert s.pricing_years == {"fees": 2028, "tuition": 2027, "insurance": 2027, "extras": 2026, "daycare": 2026}


def test_backfill_without_a_page_uses_the_price_sheet_and_keeps_saved_years():
    s = SiteSettings.load()
    s.pricing_years = {}
    s.save()
    mig.backfill(global_apps, None)
    s.refresh_from_db()
    assert s.pricing_years == mig.SHEET_2026_11
    s.pricing_years = {"fees": 2030}
    s.save()
    mig.backfill(global_apps, None)
    s.refresh_from_db()
    assert s.pricing_years == {"fees": 2030}


# ── the rules (mirror of frontend lib/siteMeta.ts and lib/priceYears.ts) ──
from datetime import date  # noqa: E402

from .site_years import announced_cycle_start, expand_tokens, price_cycle_start  # noqa: E402


@pytest.mark.parametrize("today, from_month, start", [
    (date(2026, 11, 22), 1, 2026),
    (date(2027, 1, 1), 1, 2027),
    (date(2026, 10, 31), 11, 2026),
    (date(2026, 11, 1), 11, 2027),
    (date(2027, 3, 1), 11, 2027),
    (date(2026, 12, 31), 12, 2027),
])
def test_announced_cycle(today, from_month, start):
    assert announced_cycle_start(today, from_month) == start


def test_costos_follows_the_published_prices_not_the_calendar():
    years = {"fees": 2027, "tuition": 2027, "insurance": 2026}
    # Nov 2026: the school already published 2027 prices for some groups.
    assert price_cycle_start(years, date(2026, 11, 22)) == 2027
    # Jan 2028 and nothing new published: the site announces 2028 (the cards say «pendientes»).
    assert price_cycle_start(years, date(2028, 1, 2)) == 2028
    assert price_cycle_start({}, date(2026, 11, 22)) == 2026


def test_expand_tokens_reads_the_settings():
    s = SiteSettings.load()
    s.admissions_next_from_month = 11
    s.pricing_years = {"fees": 2028}
    s.save()
    assert expand_tokens("Admisiones {{ciclo}}", date(2026, 11, 22)) == "Admisiones 2027\u20132028"
    assert expand_tokens("Costos {{ciclo}}", date(2026, 11, 22), costos=True) == "Costos 2028\u20132029"
    assert expand_tokens("{{anios}} años", date(2027, 2, 1)) == "46 años"


def test_server_head_expands_the_cycle_per_request(client, settings, tmp_path):
    """The build writes {{ciclo}}; every request fills today's value (Costos: its prices' cycle)."""
    import copy
    import json

    from django.template import engines

    from apps.core import spa

    index = ('<html><head><title>x</title><meta name="description" content="x" />'
             '<link rel="canonical" href="https://interlaken.edu.mx/" /><!--HEAD--></head>'
             '<body><div id="root"><!--SHELL--></div></body></html>')
    routes = {
        '/admisiones': {'title': 'Admisiones {{ciclo}} · Colegio Interlaken', 'description': 'Ciclo {{ciclo}}.', 'jsonLd': []},
        '/admisiones/costos': {'title': 'Costos y colegiaturas {{ciclo}} · Colegio Interlaken', 'description': 'Costos.', 'jsonLd': []},
    }
    (tmp_path / 'index.html').write_text(index, encoding='utf-8')
    (tmp_path / 'shells.json').write_text('{}', encoding='utf-8')
    (tmp_path / 'seo-routes.json').write_text(json.dumps(routes), encoding='utf-8')
    templates = copy.deepcopy(settings.TEMPLATES)
    templates[0]['DIRS'] = [str(tmp_path)]
    settings.TEMPLATES = templates
    settings.STATICFILES_DIRS = [str(tmp_path)]
    spa.clear_caches()
    engines._engines.clear()
    try:
        s = SiteSettings.load()
        s.admissions_next_from_month = 1
        s.pricing_years = {"fees": 2099}
        s.save()
        this_year = date.today().year
        html = client.get('/admisiones').content.decode()
        assert f'Admisiones {this_year}\u2013{this_year + 1}' in html
        assert '{{ciclo}}' not in html
        costos = client.get('/admisiones/costos').content.decode()
        assert 'Costos y colegiaturas 2099\u20132100' in costos
    finally:
        spa.clear_caches()
        engines._engines.clear()


# ── console reminder («Pendientes» + the dashboard pop-up) ──
from .site_years import missing_price_groups, reminder_year  # noqa: E402

ALL_2027 = {"fees": 2027, "tuition": 2027, "insurance": 2027, "extras": 2027, "daycare": 2027}


def test_reminder_starts_a_month_before_the_site_moves_on():
    assert reminder_year(ALL_2027, date(2027, 11, 30)) == 2027
    assert reminder_year(ALL_2027, date(2027, 12, 1)) == 2028
    assert reminder_year(ALL_2027, date(2027, 10, 1), from_month=11) == 2028
    assert reminder_year(ALL_2027, date(2027, 9, 15), from_month=11) == 2027


def test_missing_groups_and_the_admin_badge(api_client, admin_user):
    s = SiteSettings.load()
    s.pricing_years = {"fees": 2099, "tuition": 2099, "insurance": 2026}
    s.save()
    year, missing = missing_price_groups(date(2026, 11, 22))
    assert year == 2099 and missing == ["insurance", "extras", "daycare"]
    api_client.force_authenticate(user=admin_user)
    data = api_client.get("/api/v1/core/badges/").json()
    assert data["precios"] == 3 and data["precios_anio"] == 2099
    # Staff never see it: «Costos y precios» is admin-only.
    staff = UserFactory(role="staff", staff_areas=["admisiones", "comunicados", "cafeteria"])
    api_client.force_authenticate(user=staff)
    assert "precios" not in api_client.get("/api/v1/core/badges/").json()
