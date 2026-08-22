"""
core/exports.py — shared helpers for CSV/PDF downloads (BACKLOG P0-12 #5).

Previously copy-pasted into accounts.exports, bookings.exports and
cafeteria.exports; one definition now.
"""
from django.http import HttpResponse
from django.utils import timezone


def fmt_dt(dt) -> str:
    """Local-time ``YYYY-MM-DD HH:MM`` or '' for None."""
    if not dt:
        return ''
    return timezone.localtime(dt).strftime('%Y-%m-%d %H:%M')


def export_filename(prefix: str, ext: str = 'csv') -> str:
    """``<prefix>_<YYYYMMDD>.<ext>`` stamped in local time."""
    stamp = timezone.localtime(timezone.now()).strftime('%Y%m%d')
    return f'{prefix}_{stamp}.{ext}'


def as_download(response: HttpResponse, filename: str) -> HttpResponse:
    response['Content-Disposition'] = f'attachment; filename="{filename}"'
    return response
