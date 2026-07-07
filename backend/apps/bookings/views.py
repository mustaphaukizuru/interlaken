"""
bookings/views.py — Public slot picker + booking, admin availability & management.
"""
from datetime import datetime, timedelta

from django.db import transaction
from django.utils import timezone
from django.utils.decorators import method_decorator
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import User
from apps.core.ratelimit import ratelimit

from .models import AvailabilitySlot, Booking
from .serializers import (
    AvailabilitySlotSerializer,
    BookingCreateSerializer,
    BookingSerializer,
    SlotGeneratorSerializer,
)
from .services import calendar, send_booking_confirmation


class IsAdmin(permissions.BasePermission):
    """Authenticated admin users only (matches cafeteria/portal convention)."""
    def has_permission(self, request, view):
        user = request.user
        return bool(user and user.is_authenticated and user.role == User.Role.ADMIN)


def _open_slots_qs(params):
    """Filter active, non-past slots by optional ?type=&from=&to=."""
    today = timezone.now().date()
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

    return qs.order_by('date', 'start_time')


class AvailabilityView(APIView):
    """
    GET  /api/v1/bookings/availability/?type=&from=&to=  — public: open slots.
    POST /api/v1/bookings/availability/                  — admin: generate slots.
    """
    def get_permissions(self):
        if self.request.method == 'POST':
            return [IsAdmin()]
        return [permissions.AllowAny()]

    def get(self, request):
        slots = [s for s in _open_slots_qs(request.query_params) if not s.is_full]
        return Response(AvailabilitySlotSerializer(slots, many=True).data)

    def post(self, request):
        serializer = SlotGeneratorSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        d = serializer.validated_data

        created, skipped = 0, 0
        current = d['start_date']
        while current <= d['end_date']:
            if current.weekday() in d['weekdays']:
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
        slot_id = data['slot'].id
        num = data['num_attendees']

        with transaction.atomic():
            # Lock the slot row so concurrent bookings can't oversell capacity.
            slot = AvailabilitySlot.objects.select_for_update().get(pk=slot_id)
            if not slot.is_active or slot.date < timezone.now().date():
                return Response(
                    {'detail': 'Este horario ya no está disponible.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            if slot.spots_remaining < num:
                return Response(
                    {'detail': 'El horario seleccionado ya no tiene cupo disponible.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            booking = Booking.objects.create(
                slot=slot,
                parent_name=data['parent_name'],
                parent_email=data['parent_email'],
                parent_phone=data['parent_phone'],
                child_name=data.get('child_name', ''),
                child_grade=data.get('child_grade', ''),
                num_attendees=num,
                status=Booking.Status.CONFIRMED,
                source=Booking.Source.WEB,
            )

        # Side effects outside the transaction/lock — both fail-soft, so a broken
        # SMTP or Google Calendar never turns a saved booking into a 500.
        send_booking_confirmation(booking)
        calendar.sync_booking_created(booking)
        return Response(BookingSerializer(booking).data, status=status.HTTP_201_CREATED)


class BookingDetailView(APIView):
    """GET /api/v1/bookings/<id>/ — booking status / confirmation details."""
    permission_classes = [permissions.AllowAny]

    def get(self, request, pk):
        try:
            booking = Booking.objects.select_related('slot').get(pk=pk)
        except Booking.DoesNotExist:
            return Response({'detail': 'No encontrado.'}, status=status.HTTP_404_NOT_FOUND)
        return Response(BookingSerializer(booking).data)


class BookingCancelView(APIView):
    """POST /api/v1/bookings/<id>/cancel/ — cancel a booking (frees the slot)."""
    permission_classes = [permissions.AllowAny]

    def post(self, request, pk):
        try:
            booking = Booking.objects.select_related('slot').get(pk=pk)
        except Booking.DoesNotExist:
            return Response({'detail': 'No encontrado.'}, status=status.HTTP_404_NOT_FOUND)

        if booking.status == Booking.Status.CANCELLED:
            return Response({'detail': 'La reserva ya estaba cancelada.'},
                            status=status.HTTP_400_BAD_REQUEST)

        booking.status = Booking.Status.CANCELLED
        booking.save(update_fields=['status', 'updated_at'])
        # Remove the parent's calendar event (fail-soft; clears the stored id).
        calendar.sync_booking_cancelled(booking)
        return Response(BookingSerializer(booking).data)


class AdminBookingsView(APIView):
    """GET /api/v1/bookings/admin/bookings/?type=&status=&date= — manage bookings."""
    permission_classes = [IsAdmin]

    def get(self, request):
        qs = Booking.objects.select_related('slot').all()
        visit_type = request.query_params.get('type')
        if visit_type:
            qs = qs.filter(slot__visit_type=visit_type)
        booking_status = request.query_params.get('status')
        if booking_status:
            qs = qs.filter(status=booking_status)
        date = request.query_params.get('date')
        if date:
            qs = qs.filter(slot__date=date)
        return Response(BookingSerializer(qs, many=True).data)


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
