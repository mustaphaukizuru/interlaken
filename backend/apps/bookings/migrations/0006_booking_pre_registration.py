"""Booking → admissions case (Expediente, Fase 5).

The visit link the Expediente sends attaches new bookings by a signed token;
the existing ones are matched here by the parent's email to the LATEST lead
with that email (case-insensitive). Purged rows (retention placeholder) and
bookings without an email stay unlinked.
"""

import django.db.models.deletion
from django.db import migrations, models


RETENTION_PLACEHOLDER = "[eliminado por retención]"


def backfill(apps, schema_editor):
    Booking = apps.get_model("bookings", "Booking")
    PreRegistration = apps.get_model("admissions", "PreRegistration")
    latest = {}
    rows = (PreRegistration.objects.exclude(parent_email="").exclude(parent_email=RETENTION_PLACEHOLDER)
            .order_by("created_at", "pk").values_list("pk", "parent_email"))
    for pk, email in rows.iterator():
        latest[email.strip().lower()] = pk  # later rows win: the latest lead
    for booking in (Booking.objects.filter(pre_registration__isnull=True).exclude(parent_email="")
                    .only("pk", "parent_email").iterator()):
        lead = latest.get((booking.parent_email or "").strip().lower())
        if lead is not None:
            Booking.objects.filter(pk=booking.pk).update(pre_registration_id=lead)


class Migration(migrations.Migration):

    dependencies = [
        ('admissions', '0014_admission_process'),
        ('bookings', '0005_visit_outcome'),
    ]

    operations = [
        migrations.AddField(
            model_name='booking',
            name='pre_registration',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='bookings', to='admissions.preregistration', verbose_name='Expediente de admisión'),
        ),
        migrations.RunPython(backfill, migrations.RunPython.noop),
    ]
