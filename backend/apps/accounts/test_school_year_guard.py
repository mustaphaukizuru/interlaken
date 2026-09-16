"""The "Nuevo ciclo" wizard must not promote grades Loyverse already owns.

Since the import sets every grade from Loyverse, running the wizard's own
promotion afterwards would move the whole school up a second time. When the
roster is linked, promotion is off unless asked for explicitly; graduation
(3° Secundaria → egresado) is always applied, since that is the status change
the rollover exists for and Loyverse deletes graduates rather than marking them.
"""
import pytest
from django.urls import reverse

from apps.accounts.factories import StudentProfileFactory
from apps.accounts.models import StudentProfile


def roster(linked: bool):
    a = StudentProfileFactory(grade='1° Primaria', loyverse_id='u1' if linked else '')
    b = StudentProfileFactory(grade='3° Secundaria', loyverse_id='u2' if linked else '')
    return a, b


@pytest.mark.django_db
class TestPreviewFlag:
    def test_says_when_grades_come_from_loyverse(self, admin_client):
        roster(linked=True)
        assert admin_client.get(reverse('school-year-preview')).data['grades_from_loyverse'] is True

    def test_unlinked_roster_keeps_the_old_behaviour(self, admin_client):
        roster(linked=False)
        assert admin_client.get(reverse('school-year-preview')).data['grades_from_loyverse'] is False


@pytest.mark.django_db
class TestRunGuard:
    def _run(self, admin_client, **extra):
        return admin_client.post(reverse('school-year-run'),
                                 {'confirm': 'AVANZAR', 'new_cycle': '2027-2028', **extra}, format='json')

    def test_linked_roster_graduates_but_does_not_promote_by_default(self, admin_client):
        a, b = roster(linked=True)
        r = self._run(admin_client)
        assert r.status_code == 200, r.data
        assert r.data['promoted'] == 0 and r.data['graduated'] == 1 and r.data['promote_grades'] is False
        a.refresh_from_db()
        b.refresh_from_db()
        assert a.grade == '1° Primaria'                       # untouched: Loyverse owns it
        assert b.status == StudentProfile.Status.GRADUATED    # still graduated

    def test_linked_roster_promotes_only_when_asked_explicitly(self, admin_client):
        a, _ = roster(linked=True)
        r = self._run(admin_client, promote_grades=True)
        assert r.data['promoted'] == 1 and r.data['promote_grades'] is True
        a.refresh_from_db()
        assert a.grade == '2° Primaria'

    def test_unlinked_roster_still_promotes_by_default(self, admin_client):
        a, _ = roster(linked=False)
        r = self._run(admin_client)
        assert r.data['promoted'] == 1
        a.refresh_from_db()
        assert a.grade == '2° Primaria'

    def test_unlinked_roster_can_opt_out(self, admin_client):
        a, _ = roster(linked=False)
        r = self._run(admin_client, promote_grades=False)
        assert r.data['promoted'] == 0
        a.refresh_from_db()
        assert a.grade == '1° Primaria'
