"""
bookings/models.py — Availability slots and visit bookings.

Two visit types share one availability→booking model:
 - open_class  (Puertas Abiertas): one slot, capacity N, many bookings.
 - individual  (visita individual): one slot, capacity 1, one booking.

Capacity is enforced server-side; see views.BookingCreateView which locks the
slot with ``select_for_update`` before counting.
"""
from django.db import models
from django.db.models import Sum
from django.utils import timezone


class VisitType(models.TextChoices):
    OPEN_CLASS = 'open_class', 'Clase Abierta / Puertas Abiertas'
    INDIVIDUAL = 'individual', 'Visita Individual'


class AvailabilitySlot(models.Model):
    """Admin-published window during which a visit can be booked."""

    visit_type = models.CharField(
        max_length=20, choices=VisitType.choices, default=VisitType.INDIVIDUAL,
        verbose_name='Tipo de visita',
    )
    date       = models.DateField(verbose_name='Fecha')
    start_time = models.TimeField(verbose_name='Hora de inicio')
    end_time   = models.TimeField(verbose_name='Hora de fin')
    capacity   = models.PositiveIntegerField(default=1, verbose_name='Cupo')
    location   = models.CharField(max_length=200, blank=True, default='Campus Interlaken',
                                  verbose_name='Ubicación')
    is_active  = models.BooleanField(default=True, verbose_name='Activo')
    # "Master" Google Calendar block for this slot — populated in Prompt 13.
    google_event_id = models.CharField(max_length=255, blank=True, default='')
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        verbose_name = 'Disponibilidad'
        verbose_name_plural = 'Disponibilidad'
        ordering = ['date', 'start_time']
        # Avoid duplicate slots when the recurring generator overlaps a re-run.
        unique_together = ('visit_type', 'date', 'start_time', 'end_time')

    def __str__(self):
        return f'{self.get_visit_type_display()} — {self.date} {self.start_time:%H:%M}'

    @property
    def booked_count(self):
        """Attendees currently occupying the slot (cancelled/no-show free it)."""
        agg = self.bookings.filter(
            status__in=[Booking.Status.PENDING, Booking.Status.CONFIRMED, Booking.Status.ATTENDED]
        ).aggregate(total=Sum('num_attendees'))
        return agg['total'] or 0

    @property
    def spots_remaining(self):
        return max(0, self.capacity - self.booked_count)

    @property
    def is_full(self):
        return self.booked_count >= self.capacity


class Booking(models.Model):
    """A family's reservation against an AvailabilitySlot."""

    class Status(models.TextChoices):
        PENDING   = 'pending',   'Pendiente'
        CONFIRMED = 'confirmed', 'Confirmada'
        CANCELLED = 'cancelled', 'Cancelada'
        ATTENDED  = 'attended',  'Asistió'
        NO_SHOW   = 'no_show',   'No asistió'

    class Source(models.TextChoices):
        WEB      = 'web',      'Sitio web'
        WHATSAPP = 'whatsapp', 'WhatsApp'
        ADMIN    = 'admin',    'Administración'

    slot          = models.ForeignKey(AvailabilitySlot, on_delete=models.CASCADE, related_name='bookings')
    parent_name   = models.CharField(max_length=200, verbose_name='Nombre del padre/tutor')
    parent_email  = models.EmailField(verbose_name='Correo electrónico')
    parent_phone  = models.CharField(max_length=20, verbose_name='Teléfono / WhatsApp')
    child_name    = models.CharField(max_length=200, blank=True, verbose_name='Nombre del alumno')
    child_grade   = models.CharField(max_length=50, blank=True, verbose_name='Grado de interés')
    num_attendees = models.PositiveIntegerField(default=1, verbose_name='Número de asistentes')

    status = models.CharField(max_length=20, choices=Status.choices, default=Status.CONFIRMED)
    source = models.CharField(max_length=20, choices=Source.choices, default=Source.WEB)

    # Per-booking Google Calendar event — populated in Prompt 13.
    google_event_id   = models.CharField(max_length=255, blank=True, default='')
    confirmation_sent = models.BooleanField(default=False)
    notes             = models.TextField(blank=True, verbose_name='Notas')
    created_at        = models.DateTimeField(default=timezone.now)
    updated_at        = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'Reserva'
        verbose_name_plural = 'Reservas'
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.parent_name} — {self.slot.date} {self.slot.start_time:%H:%M} ({self.get_status_display()})'

    @property
    def is_active(self):
        return self.status in (self.Status.PENDING, self.Status.CONFIRMED, self.Status.ATTENDED)
