"""Automatic years (2026-11-22).

* SiteSettings.admissions_next_from_month: from which month the site announces
  the next school cycle (default January, the rule until now).
* SiteSettings.pricing_years: the year each Costos price group was published
  for. Until now these were texts typed in the Costos page («Precios 2027»,
  «Precios 2027: pendientes»); the backfill reads the year from the published
  Costos page when it has one, otherwise uses the school's 2026-11 price sheet
  (inscripción and colegiaturas 2027; seguros, extraescolares, estancia 2026),
  which is what those built-in texts said.

Backwards drops both columns.
"""
import re

from django.db import migrations, models

GROUPS = ('fees', 'tuition', 'insurance', 'extras', 'daycare')
SHEET_2026_11 = {'fees': 2027, 'tuition': 2027, 'insurance': 2026, 'extras': 2026, 'daycare': 2026}
YEAR = re.compile(r'\b(20\d\d)\b')


def _years_from_page(Page) -> dict:
    page = Page.objects.filter(slug='costos').select_related('published_version').first()
    blocks = page.published_version.blocks if page and page.published_version else []
    for b in blocks if isinstance(blocks, list) else []:
        props = b.get('props') if isinstance(b, dict) else None
        if not isinstance(props, dict) or not any(f'{g}Year' in props for g in GROUPS):
            continue
        out = {}
        for g in GROUPS:
            m = YEAR.search(str(props.get(f'{g}Year') or ''))
            if m:
                out[g] = int(m.group(1))
        return out
    return {}


def backfill(apps, schema_editor):
    SiteSettings = apps.get_model('content', 'SiteSettings')
    Page = apps.get_model('content', 'Page')
    years = {**SHEET_2026_11, **_years_from_page(Page)}
    for s in SiteSettings.objects.all():
        if not s.pricing_years:
            s.pricing_years = years
            s.save(update_fields=['pricing_years'])


class Migration(migrations.Migration):

    dependencies = [
        ('content', '0034_page_unpublished_since'),
    ]

    operations = [
        migrations.AddField(
            model_name='sitesettings',
            name='admissions_next_from_month',
            field=models.PositiveSmallIntegerField(
                choices=[(1, '1 de enero'), (9, '1 de septiembre'), (10, '1 de octubre'), (11, '1 de noviembre'), (12, '1 de diciembre')],
                default=1, verbose_name='El sitio anuncia el siguiente ciclo desde'),
        ),
        migrations.AddField(
            model_name='sitesettings',
            name='pricing_years',
            field=models.JSONField(blank=True, default=dict, verbose_name='Año de los precios publicados'),
        ),
        migrations.RunPython(backfill, migrations.RunPython.noop),
    ]
