"""
bookings/exports.py — CSV export of the admin visits (reservas) list.

Mirrors the cafetería export pattern (apps/cafeteria/exports.py): es-MX headers
and a UTF-8 BOM so Excel opens accented names correctly.
"""
import csv

from django.http import HttpResponse
from django.utils import timezone

VISIT_TYPE_LABEL = {'individual': 'Individual', 'open_class': 'Puertas Abiertas'}


def _fmt_dt(dt) -> str:
    if not dt:
        return ''
    return timezone.localtime(dt).strftime('%Y-%m-%d %H:%M')


def _filename(prefix: str) -> str:
    stamp = timezone.localtime(timezone.now()).strftime('%Y%m%d')
    return f'{prefix}_{stamp}.csv'


def bookings_csv(bookings) -> HttpResponse:
    """CSV of the (already filtered) admin bookings queryset."""
    header = ['Fecha', 'Hora', 'Tipo', 'Tutor', 'Correo', 'Teléfono',
              'Alumno', 'Grado de interés', 'Asistentes', 'Estado']

    response = HttpResponse(content_type='text/csv; charset=utf-8')
    response.write('﻿')  # BOM so Excel opens UTF-8 accents correctly
    writer = csv.writer(response)
    writer.writerow(['Visitas'])
    writer.writerow(['Generado', _fmt_dt(timezone.now())])
    writer.writerow([])
    writer.writerow(header)
    for b in bookings:
        slot = b.slot
        writer.writerow([
            slot.date.isoformat() if slot.date else '',
            f'{slot.start_time:%H:%M}–{slot.end_time:%H:%M}' if slot.start_time else '',
            VISIT_TYPE_LABEL.get(slot.visit_type, slot.visit_type),
            b.parent_name,
            b.parent_email,
            b.parent_phone,
            b.child_name,
            b.child_grade,
            b.num_attendees,
            b.get_status_display(),
        ])
    response['Content-Disposition'] = f'attachment; filename="{_filename("visitas")}"'
    return response
