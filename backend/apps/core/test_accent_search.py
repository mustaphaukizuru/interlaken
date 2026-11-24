"""QA sweep 2026-11-24 (round 2): admin searches ignore accents and case
(«hernandez» finds «Hernández», «sofia» finds «Sofía») on SQLite too, and on
a PostgreSQL without the unaccent extension."""
import pytest
from django.urls import reverse

from apps.accounts.factories import StudentProfileFactory
from apps.core import listing
from apps.core.models import ContactMessage

pytestmark = pytest.mark.django_db


def _student(first, last):
    s = StudentProfileFactory()
    s.user.first_name, s.user.last_name = first, last
    s.user.save(update_fields=['first_name', 'last_name'])
    return s


def _ids(client, q):
    return {r['id'] for r in client.get(reverse('students'), {'q': q}).data['results']}


@pytest.mark.parametrize('q', ['hernandez', 'HERNANDEZ', 'Hernández', 'hernÁndez', 'sofia hernandez',
                               'Sofía'])
def test_roster_search_folds_accents(admin_client, q):
    sofia = _student('Sofía', 'Hernández López')
    _student('Ana', 'Pérez')
    assert _ids(admin_client, q) == {sofia.id}


def test_folding_works_both_ways_and_with_enye(admin_client):
    plain = _student('Sofia', 'Pena')
    accented = _student('Raúl', 'Peña')
    assert _ids(admin_client, 'peña') == {plain.id, accented.id}
    assert _ids(admin_client, 'pena') == {plain.id, accented.id}
    assert _ids(admin_client, 'raul pena') == {accented.id}   # («maria» is in «Primaria»)


def test_inbox_search_folds_accents(admin_client):
    msg = ContactMessage.objects.create(name='José Gutiérrez', email='j@test.mx',
                                        subject='Inscripción', message='Información')
    resp = admin_client.get(reverse('core-contact-inbox'), {'q': 'gutierrez inscripcion'})
    assert [r['id'] for r in resp.data['results']] == [msg.id]


def test_search_lookup_falls_back_without_postgres_unaccent(monkeypatch):
    monkeypatch.setattr(listing.connection, 'vendor', 'postgresql')
    monkeypatch.setattr(listing, '_postgres_unaccent_folds', lambda: False)
    assert listing.search_lookup('name') == 'name__foldaccents__icontains'
    monkeypatch.setattr(listing, '_postgres_unaccent_folds', lambda: True)
    assert listing.search_lookup('name') == 'name__unaccent__icontains'
