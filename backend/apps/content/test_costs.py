"""
Costos por sección (CMS): endpoint público, orden, filtro de activos y
refresco de caché al guardar desde el admin.
"""
import pytest
from django.core.cache import cache
from django.urls import reverse

from apps.content.models import TuitionCost

pytestmark = pytest.mark.django_db

URL = reverse('tuition-costs')


@pytest.fixture(autouse=True)
def _clear_cache():
    cache.clear()
    yield
    cache.clear()


def test_public_and_seeded(api_client):
    """Anónimo OK; la migración 0006 siembra las 4 secciones en orden."""
    resp = api_client.get(URL)
    assert resp.status_code == 200
    rows = resp.json()
    assert [r['section'] for r in rows] == [
        'Sección Maternal', '1° a 3° de Preescolar', 'Primaria', 'Secundaria']
    # The old «inscripción» column is no longer published: the fee lives in
    # «Inscripción y reinscripción» (EnrollmentFee) only.
    assert all('inscripcion' not in r for r in rows)


def test_inactive_rows_hidden(api_client):
    TuitionCost.objects.filter(section='Primaria').update(is_active=False)
    cache.clear()
    sections = [r['section'] for r in api_client.get(URL).json()]
    assert 'Primaria' not in sections and len(sections) == 3


def test_admin_edit_refreshes_cache(api_client):
    api_client.get(URL)  # prime cache
    row = TuitionCost.objects.get(section='Secundaria')
    row.colegiatura = 7000
    row.save()  # save() borra la caché
    updated = [r for r in api_client.get(URL).json() if r['section'] == 'Secundaria']
    assert float(updated[0]['colegiatura']) == 7000.0
