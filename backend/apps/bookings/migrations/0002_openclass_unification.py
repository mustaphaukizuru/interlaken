"""
Add AvailabilitySlot.title and port the legacy admissions.OpenSchoolDay rows into
the unified bookings model (open_class slots + their bookings).

The old ``OpenSchoolDay.event_time`` is free text ("10:00 AM", "9:00 - 11:00",
"10:00"), so time parsing is best-effort: we read the first HH:MM (and a second
one as the end, if present) and fall back to a 2-hour window otherwise. The port
is idempotent at the slot level (get_or_create on the natural key) and never
raises — a bad row is skipped so the migration always completes.
"""
import datetime
import re

from django.db import migrations, models

_TIME_RE = re.compile(r'(\d{1,2}):(\d{2})')


def _plus_two_hours(t):
    return datetime.time((t.hour + 2) % 24, t.minute)


def _parse_times(text):
    """Best-effort (start, end) from a free-text event_time string."""
    raw = text or ''
    lowered = raw.lower()
    matches = _TIME_RE.findall(raw)

    def _to_time(pair):
        h, m = min(int(pair[0]), 23), min(int(pair[1]), 59)
        if 'pm' in lowered and h < 12:
            h += 12
        return datetime.time(h, m)

    if not matches:
        start = datetime.time(9, 0)
        return start, _plus_two_hours(start)

    start = _to_time(matches[0])
    if len(matches) >= 2:
        end = _to_time(matches[1])
        if end <= start:
            end = _plus_two_hours(start)
    else:
        end = _plus_two_hours(start)
    return start, end


def port_open_school_days(apps, schema_editor):
    OpenSchoolDay = apps.get_model('admissions', 'OpenSchoolDay')
    AvailabilitySlot = apps.get_model('bookings', 'AvailabilitySlot')
    Booking = apps.get_model('bookings', 'Booking')

    status_map = {'confirmed': 'confirmed', 'cancelled': 'cancelled', 'attended': 'attended'}

    for osd in OpenSchoolDay.objects.all().iterator():
        try:
            start, end = _parse_times(osd.event_time)
            slot, _created = AvailabilitySlot.objects.get_or_create(
                visit_type='open_class',
                date=osd.event_date,
                start_time=start,
                end_time=end,
                defaults={
                    'title': osd.event_name or 'Puertas Abiertas',
                    'capacity': osd.max_capacity or 30,
                    'location': 'Campus Interlaken',
                    'is_active': True,
                },
            )
            # If the slot pre-existed, keep the richer title / larger capacity.
            changed = False
            if not slot.title and osd.event_name:
                slot.title, changed = osd.event_name, True
            if osd.max_capacity and slot.capacity < osd.max_capacity:
                slot.capacity, changed = osd.max_capacity, True
            if changed:
                slot.save(update_fields=['title', 'capacity'])

            Booking.objects.create(
                slot=slot,
                parent_name=osd.parent_name,
                parent_email=osd.parent_email,
                parent_phone=osd.parent_phone,
                child_name=osd.child_name or '',
                child_grade=osd.level_interest or '',
                num_attendees=1,
                status=status_map.get(osd.status, 'confirmed'),
                source='web',
                notes=osd.message or '',
                created_at=osd.created_at,
            )
        except Exception:
            # Best-effort port: never let one malformed legacy row block the migration.
            continue


class Migration(migrations.Migration):

    dependencies = [
        ('bookings', '0001_initial'),
        ('admissions', '0002_registration_access_token'),
    ]

    operations = [
        migrations.AddField(
            model_name='availabilityslot',
            name='title',
            field=models.CharField(blank=True, default='', max_length=200,
                                   verbose_name='Nombre del evento'),
        ),
        migrations.RunPython(port_open_school_days, migrations.RunPython.noop),
    ]
