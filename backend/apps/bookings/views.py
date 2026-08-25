"""
bookings/views.py — Public slot picker + booking, admin availability & management.
"""
import logging
from datetime import datetime, timedelta

from django.conf import settings
from django.core.cache import cache
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from django.utils.decorators import method_decorator
from rest_framework import generics, permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import User
from apps.core.permissions import IsAdmin
from apps.core.ratelimit import ratelimit

from .models import AvailabilitySlot, Booking
from .serializers import (
    AdminSlotSerializer,
    AvailabilitySlotSerializer,
    BookingCreateSerializer,
    BookingSerializer,
    SlotGeneratorSerializer,
)
from .services import SlotUnavailable, calendar, create_booking, send_booking_confirmation


def _can_access_booking(user, booking):
    """Object-level ownership for a booking.

    Bookings carry no FK to a User (they are created from the public form), so a
    "guardian owns it" is established by matching the authenticated account's email
    to the booking's contact email. Admin/staff may access any booking.
    """
    if not (user and user.is_authenticated):
        return False
    if user.role in (User.Role.ADMIN, User.Role.STAFF):
        return True
    return bool(booking.parent_email) and \
        booking.parent_email.strip().lower() == (user.email or '').strip().lower()


def _slot_start(slot):
    """The slot's start as a timezone-aware (school-local) datetime."""
    return timezone.make_aware(datetime.combine(slot.date, slot.start_time))


AVAILABILITY_HORIZON_DAYS = 120


def _open_slots_qs(params):
    """Filter active, non-past slots by optional ?type=&from=&to=."""
    today = timezone.localdate()  # school-local day, not the UTC calendar date
    qs = AvailabilitySlot.objects.filter(is_active=True, date__gte=today)

    visit_type = params.get('type')
    if visit_type:
        qs = qs.filter(visit_type=visit_type)

    date_from = params.get('from')
    if date_from:
        qs = qs.filter(date__gte=date_from)

    date_to = params.get('to')
    if date_to:
        qs = qs.filter(date__lte=date_to)
    else:
        # Without an upper bound this public endpoint returned every slot the
        # generator ever created. Nobody books a visit a year out.
        qs = qs.filter(date__lte=today + timedelta(days=AVAILABILITY_HORIZON_DAYS))

    # One grouped aggregate for booked_count/is_full instead of 3 per slot.
    return AvailabilitySlot.annotate_booked(qs.order_by('date', 'start_time'))


class AvailabilityView(APIView):
    """
    GET  /api/v1/bookings/availability/?type=&from=&to=  — public: open slots.
    POST /api/v1/bookings/availability/                  — admin: generate slots.
    """
    def get_permissions(self):
        if self.request.method == 'POST':
            return [IsAdmin()]
        return [permissions.AllowAny()]

    # Public availability micro-cache (P7b): TTL-only, keyed on the filter
    # params — no invalidation web. The annotated query is already 1-query, so
    # this only shaves repeat traffic; ≤60s staleness is safe because
    # create_booking re-checks capacity server-side on every booking.
    CACHE_TTL = 60

    def get(self, request):
        params = request.query_params
        cache_key = 'bookings:availability:' + '&'.join(
            f'{k}={params.get(k, "")}' for k in ('type', 'from', 'to'))
        data = cache.get(cache_key)
        if data is None:
            now = timezone.now()
            slots = [s for s in _open_slots_qs(params)
                     if not s.is_full and _slot_start(s) >= now]  # hide already-started
            data = AvailabilitySlotSerializer(slots, many=True).data
            cache.set(cache_key, data, self.CACHE_TTL)
        return Response(data)

    def post(self, request):
        serializer = SlotGeneratorSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        d = serializer.validated_data

        created, skipped = 0, 0
        current = d['start_date']
        while current <= d['end_date']:
            # The frontend day-picker sends JS getDay() values (Sun=0, Mon=1 …
            # Sat=6); Python's date.weekday() is Mon=0 … Sun=6. Convert so the
            # generated slots land on the days the admin actually selected
            # (without this, "Lun–Vie" produced Tue–Sat — every day shifted +1).
            js_weekday = (current.weekday() + 1) % 7
            if js_weekday in d['weekdays']:
                cursor = datetime.combine(current, d['window_start'])
                window_end = datetime.combine(current, d['window_end'])
                step = timedelta(minutes=d['interval_minutes'])
                while cursor + step <= window_end:
                    slot_end = cursor + step
                    _, was_created = AvailabilitySlot.objects.get_or_create(
                        visit_type=d['visit_type'],
                        date=current,
                        start_time=cursor.time(),
                        end_time=slot_end.time(),
                        defaults={
                            'title': d.get('title') or '',
                            'capacity': d['capacity'],
                            'location': d['location'],
                            'is_active': True,
                        },
                    )
                    if was_created:
                        created += 1
                    else:
                        skipped += 1
                    cursor = slot_end
            current += timedelta(days=1)

        return Response(
            {'created': created, 'skipped': skipped,
             'detail': f'{created} horarios generados ({skipped} ya existían).'},
            status=status.HTTP_201_CREATED,
        )


@method_decorator(ratelimit('booking-create', '10/m', method='POST'), name='dispatch')
class BookingCreateView(APIView):
    """POST /api/v1/bookings/ — public: create a booking (capacity-safe)."""
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        serializer = BookingCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        try:
            booking = create_booking(
                slot_id=data['slot'].id,
                parent_name=data['parent_name'],
                parent_email=data['parent_email'],
                parent_phone=data['parent_phone'],
                child_name=data.get('child_name', ''),
                child_grade=data.get('child_grade', ''),
                num_attendees=data['num_attendees'],
                source=Booking.Source.WEB,
            )
        except SlotUnavailable as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(BookingSerializer(booking).data, status=status.HTTP_201_CREATED)


class BookingDetailView(APIView):
    """GET /api/v1/bookings/<id>/ — booking status / confirmation details.

    Authenticated + owner-only: exposes contact PII, so only the owning guardian
    (or staff/admin) may read it. Non-owners get 404 (no existence oracle).
    """
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, pk):
        try:
            booking = Booking.objects.select_related('slot').get(pk=pk)
        except Booking.DoesNotExist:
            return Response({'detail': 'No encontrado.'}, status=status.HTTP_404_NOT_FOUND)
        if not _can_access_booking(request.user, booking):
            return Response({'detail': 'No encontrado.'}, status=status.HTTP_404_NOT_FOUND)
        return Response(BookingSerializer(booking).data)


class BookingCancelView(APIView):
    """POST /api/v1/bookings/<id>/cancel/ — cancel a booking (frees the slot).

    Authenticated + owner-only (or staff/admin); non-owners get 404.
    """
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, pk):
        try:
            booking = Booking.objects.select_related('slot').get(pk=pk)
        except Booking.DoesNotExist:
            return Response({'detail': 'No encontrado.'}, status=status.HTTP_404_NOT_FOUND)

        if not _can_access_booking(request.user, booking):
            return Response({'detail': 'No encontrado.'}, status=status.HTTP_404_NOT_FOUND)

        if booking.status == Booking.Status.CANCELLED:
            return Response({'detail': 'La reserva ya estaba cancelada.'},
                            status=status.HTTP_400_BAD_REQUEST)

        booking.status = Booking.Status.CANCELLED
        booking.save(update_fields=['status', 'updated_at'])
        # Remove the parent's calendar event (fail-soft; clears the stored id).
        calendar.sync_booking_cancelled(booking)
        return Response(BookingSerializer(booking).data)


def filter_admin_bookings(params):
    """Admin booking queryset for ``params`` — shared by the list and the CSV
    export so the download always matches the on-screen filters."""
    qs = (Booking.objects.select_related('slot')
          .order_by('-slot__date', '-slot__start_time', '-id'))
    visit_type = params.get('type')
    if visit_type:
        qs = qs.filter(slot__visit_type=visit_type)
    booking_status = params.get('status')
    if booking_status:
        qs = qs.filter(status=booking_status)
    date = params.get('date')
    if date:
        qs = qs.filter(slot__date=date)
    q = params.get('q')
    if q:
        # Powers the admin Ctrl+K palette.
        qs = qs.filter(
            Q(parent_name__icontains=q) | Q(parent_email__icontains=q)
            | Q(child_name__icontains=q))
    return qs


class AdminBookingsView(generics.ListAPIView):
    """GET /api/v1/bookings/admin/bookings/?type=&status=&date=&q= — manage
    bookings. Paginated (DRF PageNumberPagination) so the admin console's pager
    is real: previously this returned every booking in one list, making the
    frontend pager inert and the counts wrong."""
    serializer_class = BookingSerializer
    permission_classes = [IsAdmin]

    def get_queryset(self):
        return filter_admin_bookings(self.request.query_params)


class AdminBookingsExportView(APIView):
    """GET /api/v1/bookings/admin/bookings/export/ — CSV of the visits list.

    Accepts the same query params as the list endpoint (type / status / date / q)
    so the download respects the active filters.
    """
    permission_classes = [IsAdmin]

    def get(self, request):
        from . import exports
        return exports.bookings_csv(filter_admin_bookings(request.query_params))


class AdminBookingActionView(APIView):
    """POST /api/v1/bookings/admin/bookings/<id>/<action>/ — confirm/cancel/attended/no_show."""
    permission_classes = [IsAdmin]

    ACTIONS = {
        'confirm':  Booking.Status.CONFIRMED,
        'cancel':   Booking.Status.CANCELLED,
        'attended': Booking.Status.ATTENDED,
        'no_show':  Booking.Status.NO_SHOW,
    }

    def post(self, request, pk, action):
        new_status = self.ACTIONS.get(action)
        if new_status is None:
            return Response({'detail': 'Acción no válida.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            booking = Booking.objects.select_related('slot').get(pk=pk)
        except Booking.DoesNotExist:
            return Response({'detail': 'No encontrado.'}, status=status.HTTP_404_NOT_FOUND)

        booking.status = new_status
        booking.save(update_fields=['status', 'updated_at'])
        if action == 'confirm':
            if not booking.confirmation_sent:
                send_booking_confirmation(booking)
            calendar.sync_booking_created(booking)
        elif action == 'cancel':
            calendar.sync_booking_cancelled(booking)
        return Response(BookingSerializer(booking).data)


class AdminBookingRescheduleView(APIView):
    """POST /bookings/admin/bookings/<pk>/reschedule/ {"slot": id} — move a visit to another slot (P4-2).
    Checks capacity, keeps the old slot as rescheduled_from, re-syncs the calendar and emails the family."""
    permission_classes = [IsAdmin]

    def post(self, request, pk):
        booking = Booking.objects.select_related('slot').filter(pk=pk).first()
        if booking is None:
            return Response({'detail': 'No encontrado.'}, status=status.HTTP_404_NOT_FOUND)
        slot = AvailabilitySlot.objects.filter(pk=request.data.get('slot'), is_active=True).first()
        if slot is None:
            return Response({'slot': ['Horario no válido.']}, status=status.HTTP_400_BAD_REQUEST)
        if slot.pk == booking.slot_id:
            return Response({'slot': ['Es el mismo horario.']}, status=status.HTTP_400_BAD_REQUEST)
        # Lock the target slot while we count and move, so two admins
        # rescheduling into the last seat cannot both succeed (create_booking
        # already does this; this path did not).
        with transaction.atomic():
            slot = AvailabilitySlot.objects.select_for_update().get(pk=slot.pk)
            booked = (Booking.objects.filter(slot=slot).exclude(status=Booking.Status.CANCELLED)
                      .exclude(pk=booking.pk).count())
            if booked + booking.num_attendees > slot.capacity:
                return Response({'slot': ['Ese horario ya no tiene cupo suficiente.']}, status=status.HTTP_400_BAD_REQUEST)
            old = booking.slot
            booking.rescheduled_from = old
            booking.slot = slot
            if booking.status in (Booking.Status.NO_SHOW, Booking.Status.CANCELLED):
                booking.status = Booking.Status.CONFIRMED
            booking.save(update_fields=['slot', 'rescheduled_from', 'status', 'updated_at'])
        try:
            calendar.sync_booking_cancelled(booking)
            calendar.sync_booking_created(booking)
        except Exception:  # noqa: BLE001 - calendar is best effort, but never silent
            logging.getLogger(__name__).exception('Calendar resync failed for booking %s', booking.pk)
        from apps.portal.services import send_email
        send_email(
            'Su visita al Colegio Interlaken cambió de horario',
            f'Hola {booking.parent_name}:\n\nSu visita quedó reprogramada para el {slot.date:%d/%m/%Y} a las {slot.start_time:%H:%M}'
            f' (antes {old.date:%d/%m/%Y} {old.start_time:%H:%M}).\n\nSi no le es posible, responda a este correo o escríbanos por WhatsApp.',
            [booking.parent_email], reply_to=settings.ADMISSIONS_EMAIL)
        from apps.core.audit import record
        record('update', booking, {'slot': {'from': old.pk, 'to': slot.pk}}, actor=request.user, context='bookings: reprogramación')
        return Response(BookingSerializer(booking).data)


class AdminBookingOutcomeView(APIView):
    """POST /bookings/admin/bookings/<pk>/outcome/ {"outcome", "note"?, "prereg_status"?} — post-visit result (P4-2).
    Marks the visit attended, stores the outcome and optionally moves the linked
    pre-registro (matched by parent email) to contacted/enrolled/rejected."""
    permission_classes = [IsAdmin]

    def post(self, request, pk):
        from apps.admissions.models import PreRegistration
        booking = Booking.objects.filter(pk=pk).first()
        if booking is None:
            return Response({'detail': 'No encontrado.'}, status=status.HTTP_404_NOT_FOUND)
        outcome = str(request.data.get('outcome') or '')
        if outcome not in Booking.Outcome.values or outcome == '':
            return Response({'outcome': ['Resultado no válido.']}, status=status.HTTP_400_BAD_REQUEST)
        booking.outcome = outcome
        booking.outcome_note = str(request.data.get('note') or '')[:500]
        if booking.status in (Booking.Status.CONFIRMED, Booking.Status.PENDING):
            booking.status = Booking.Status.ATTENDED
        booking.save(update_fields=['outcome', 'outcome_note', 'status', 'updated_at'])
        linked = None
        prereg = PreRegistration.objects.filter(parent_email__iexact=booking.parent_email).order_by('-created_at').first()
        target = {'enrolling': PreRegistration.Status.ENROLLED, 'declined': PreRegistration.Status.REJECTED,
                  'interested': PreRegistration.Status.CONTACTED, 'not_now': PreRegistration.Status.CONTACTED}.get(outcome)
        if prereg is not None and request.data.get('update_prereg', True) and target and prereg.status != PreRegistration.Status.ENROLLED:
            prereg.status = target
            prereg.save(update_fields=['status', 'updated_at'])
            linked = {'id': prereg.pk, 'status': prereg.status}
        from apps.core.audit import record
        record('update', booking, {'outcome': outcome, 'prereg': linked}, actor=request.user, context='bookings: resultado de visita')
        data = BookingSerializer(booking).data
        data['pre_registration'] = linked
        return Response(data)


class AdminWeekView(APIView):
    """GET /bookings/admin/week/?start=YYYY-MM-DD — 7 days of slots with their bookings (P4-2 calendar)."""
    permission_classes = [IsAdmin]

    def get(self, request):
        start_s = request.query_params.get('start')
        try:
            start = datetime.strptime(start_s, '%Y-%m-%d').date() if start_s else timezone.localdate()
        except ValueError:
            return Response({'start': ['Fecha no válida.']}, status=status.HTTP_400_BAD_REQUEST)
        start = start - timedelta(days=start.weekday())  # Monday
        end = start + timedelta(days=6)
        slots = (AvailabilitySlot.objects.filter(date__range=(start, end)).order_by('date', 'start_time')
                 .prefetch_related('bookings'))
        days = []
        for i in range(7):
            d = start + timedelta(days=i)
            day_slots = []
            for sl in slots:
                if sl.date != d:
                    continue
                bk = [b for b in sl.bookings.all() if b.status != Booking.Status.CANCELLED]
                day_slots.append({
                    'id': sl.pk, 'title': sl.title, 'visit_type': sl.visit_type, 'start_time': sl.start_time.strftime('%H:%M'),
                    'end_time': sl.end_time.strftime('%H:%M'), 'capacity': sl.capacity, 'is_active': sl.is_active,
                    'booked': sum(b.num_attendees for b in bk),
                    'bookings': [{'id': b.pk, 'parent_name': b.parent_name, 'child_name': b.child_name, 'status': b.status,
                                  'outcome': b.outcome, 'num_attendees': b.num_attendees, 'parent_phone': b.parent_phone} for b in bk],
                })
            days.append({'date': d.isoformat(), 'slots': day_slots})
        return Response({'start': start.isoformat(), 'end': end.isoformat(), 'days': days})


class AdminSlotListView(generics.ListAPIView):
    """GET /api/v1/bookings/admin/slots/?type=&active=&from=&to= — every
    published slot (incl. inactive/past), paginated, so the console can view
    and manage availability (the admin could previously only generate slots)."""
    serializer_class = AdminSlotSerializer
    permission_classes = [IsAdmin]

    def get_queryset(self):
        qs = AvailabilitySlot.objects.order_by('-date', '-start_time')
        p = self.request.query_params
        if p.get('type'):
            qs = qs.filter(visit_type=p['type'])
        active = p.get('active')
        if active in ('true', 'false'):
            qs = qs.filter(is_active=(active == 'true'))
        if p.get('from'):
            qs = qs.filter(date__gte=p['from'])
        if p.get('to'):
            qs = qs.filter(date__lte=p['to'])
        return AvailabilitySlot.annotate_booked(qs)


class AdminSlotDetailView(generics.RetrieveUpdateDestroyAPIView):
    """GET/PATCH/DELETE /api/v1/bookings/admin/slots/<id>/ — edit (capacity,
    location, title, is_active) or delete a slot. Deleting is refused when any
    booking references the slot (CASCADE would erase that history); deactivate
    instead."""
    queryset = AvailabilitySlot.objects.all()
    serializer_class = AdminSlotSerializer
    permission_classes = [IsAdmin]
    http_method_names = ['get', 'patch', 'delete']

    def destroy(self, request, *args, **kwargs):
        slot = self.get_object()
        booked = slot.bookings.count()
        if booked:
            return Response(
                {'detail': f'No se puede eliminar: {booked} reserva(s) asociada(s). '
                           f'Desactive el horario para ocultarlo sin perder el historial.'},
                status=status.HTTP_400_BAD_REQUEST)
        return super().destroy(request, *args, **kwargs)
