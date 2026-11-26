"""
bookings/views.py — Public slot picker + booking, admin availability & management.
"""
import logging
from datetime import datetime, timedelta

from django.conf import settings
from django.core.cache import cache
from django.db import transaction
from django.utils import timezone
from django.utils.decorators import method_decorator
from rest_framework import generics, permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import User
from apps.content.ops import AuditedCrudMixin
from apps.core.areas import has_area
from apps.core.audit import record
from apps.core.bulk import AdminBulkView
from apps.core.exporting import AdminExportMixin
from apps.core.filtersets import parse_bool_param
from apps.core.importing import ImportTemplateView, ImportView
from apps.core.listing import AdminListMixin
from apps.core.permissions import IsAdmin
from apps.core.plurals import count as plural
from apps.core.ratelimit import ratelimit

from . import data_ops
from .models import AvailabilitySlot, Booking
from .serializers import (
    AdminBookingSerializer,
    AdminSlotSerializer,
    AvailabilitySlotSerializer,
    BookingCreateSerializer,
    BookingSerializer,
    SlotGeneratorSerializer,
)
from .services import (
    SlotUnavailable,
    calendar,
    change_booking_status,
    create_booking,
    occupied_seats,
)
from .services.staff_alerts import CANCELLED_BY_FAMILY, alert_staff
from .services.status import visit_started


def _can_access_booking(user, booking):
    """Object-level ownership for a booking.

    Bookings carry no FK to a User (they are created from the public form), so a
    "guardian owns it" is established by matching the authenticated account's email
    to the booking's contact email. Admins, and staff holding the «visitas» area,
    may access any booking (a cafetería cashier may not).
    """
    if not (user and user.is_authenticated):
        return False
    if user.role == User.Role.ADMIN:
        return True
    if user.role == User.Role.STAFF and has_area(user, 'visitas'):
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
    admin_area = 'visitas'

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

        if created:
            # One summary row per generator run (QA 2026-11-24: none was written).
            record('create', object_type='bookings.availabilityslot', object_id='generador',
                   changes={
                       'created': created, 'skipped': skipped,
                       'visit_type': d['visit_type'], 'title': d.get('title') or '',
                       'start_date': d['start_date'].isoformat(),
                       'end_date': d['end_date'].isoformat(), 'weekdays': list(d['weekdays']),
                       'window': f"{d['window_start']:%H:%M}-{d['window_end']:%H:%M}",
                       'interval_minutes': d['interval_minutes'], 'capacity': d['capacity'],
                       'location': d['location'],
                   },
                   actor=request.user, context='bookings: generar horarios')
        return Response(
            {'created': created, 'skipped': skipped,
             'detail': f'{created} horarios generados ({skipped} ya existían).'},
            status=status.HTTP_201_CREATED,
        )


@method_decorator(ratelimit('booking-create', '10/m', method='POST'), name='dispatch')
class BookingCreateView(APIView):
    """POST /api/v1/bookings/ — public: create a booking (capacity-safe).

    Optional ``lead_token``: the signed token of the visit link the Expediente
    sends (``/agendar-visita?lead=…``). A valid one attaches the booking to its
    admissions case; a bad or expired one is ignored (the booking still goes
    through, matched by email later)."""
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        from apps.admissions.process import booking_from_visit_link, lead_from_token

        serializer = BookingCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        lead = lead_from_token(str(request.data.get('lead_token') or ''))
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
                pre_registration=lead,
            )
        except SlotUnavailable as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        if lead is not None:
            booking_from_visit_link(lead, booking)
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

        previous = booking.status
        booking.status = Booking.Status.CANCELLED
        booking.save(update_fields=['status', 'updated_at'])
        record('update', booking, {'status': [previous, Booking.Status.CANCELLED]},
               actor=request.user, context='bookings: cancelación')
        # Remove the parent's calendar event (fail-soft; clears the stored id).
        calendar.sync_booking_cancelled(booking)
        # The family cancelled it themselves: the school hears about it. Staff
        # who may cancel any visit (admins, «visitas» area) made the change and
        # need no alert.
        if not has_area(request.user, 'visitas'):
            alert_staff(booking, CANCELLED_BY_FAMILY)
        return Response(BookingSerializer(booking).data)


class AdminBookingsView(AdminListMixin, generics.ListAPIView):
    """GET /api/v1/bookings/admin/bookings/ — the Visitas list (Data Ops C1).

    ``q`` over tutor name / email / phone and child name (powers the Ctrl+K
    palette too); ``type``, ``status``, ``source``, ``date``, ``from``/``to``
    (slot date) via ``BookingFilterSet``; whitelisted ``ordering`` keys
    ``date, status, parent, child, created_at, attendees`` with a ``-pk``
    tiebreak; ``page`` / ``page_size`` (≤ 100). Two queries whatever the page.
    """
    admin_area = 'visitas'
    serializer_class = AdminBookingSerializer
    search_fields = data_ops.BOOKING_SEARCH_FIELDS
    ordering = data_ops.BOOKING_ORDERING
    default_ordering = data_ops.BOOKING_DEFAULT_ORDERING
    filterset_class = data_ops.BookingFilterSet

    def get_queryset(self):
        # The case joins in: «Ver expediente» per row without a query each.
        return Booking.objects.select_related('slot', 'pre_registration')


class AdminBookingsExportView(AdminExportMixin, AdminBookingsView):
    """GET /api/v1/bookings/admin/bookings/export/?fmt=csv|xlsx|pdf&ids=… — the
    Visitas list as a file: same filters, ``q`` and ``ordering`` as the list
    (it IS the list view), capped (10,000 / PDF 1,000 → 413) and audited."""
    admin_area = 'visitas'
    export_spec = data_ops.BOOKING_EXPORT


class AdminBookingBulkView(AdminBulkView):
    """POST /api/v1/bookings/admin/bookings/bulk/ — confirm / cancel / attended /
    no_show on ≤ 500 bookings (or ``all_matching`` the list filters). Every row
    goes through ``change_booking_status`` (transition table, capacity by
    ``num_attendees`` under a slot lock, confirmation email unless
    ``payload.notify`` is false, calendar sync) and gets its own audit row."""
    admin_area = 'visitas'
    entity = 'bookings.booking'
    list_view_class = AdminBookingsView
    actions = data_ops.BOOKING_BULK_ACTIONS

    def get_queryset(self):
        return Booking.objects.select_related('slot')


class AdminBookingActionView(APIView):
    """POST /api/v1/bookings/admin/bookings/<id>/<action>/ — confirm / cancel /
    attended / no_show / reopen. Body (optional): ``{"note": "…", "notify": true}``.

    Same guard as the bulk endpoint: the transition table (a cancelled booking
    only reopens to pending; attended ↔ no-show needs a note), a capacity
    check by ``num_attendees`` under a slot lock when the move claims seats,
    and one audit row per change."""
    admin_area = 'visitas'
    permission_classes = [IsAdmin]

    ACTIONS = {
        'confirm':  Booking.Status.CONFIRMED,
        'cancel':   Booking.Status.CANCELLED,
        'attended': Booking.Status.ATTENDED,
        'no_show':  Booking.Status.NO_SHOW,
        'reopen':   Booking.Status.PENDING,
        # «Deshacer cancelación» (owner 2026-11-26): a cancelled visit straight
        # back to «Confirmada», with «Su visita sigue en pie» unless notify=false.
        'uncancel': Booking.Status.CONFIRMED,
    }
    CONTEXTS = {'uncancel': 'bookings: deshacer cancelación'}

    def post(self, request, pk, action):
        new_status = self.ACTIONS.get(action)
        if new_status is None:
            return Response({'detail': 'Acción no válida.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            booking = Booking.objects.select_related('slot').get(pk=pk)
        except Booking.DoesNotExist:
            return Response({'detail': 'No encontrado.'}, status=status.HTTP_404_NOT_FOUND)
        if action == 'confirm' and booking.status == Booking.Status.CANCELLED:
            # Undoing a cancellation has its own action: its own email to the
            # family («Su visita sigue en pie»), date guard and audit context.
            return Response({'detail': 'No se puede pasar de «Cancelada» a «Confirmada» con «Confirmar»: '
                                       'use «Deshacer cancelación».'},
                            status=status.HTTP_400_BAD_REQUEST)
        if action == 'uncancel' and booking.status != Booking.Status.CANCELLED:
            return Response({'detail': f'La visita está «{booking.get_status_display()}»: solo se '
                                       'deshace la cancelación de una visita cancelada.'},
                            status=status.HTTP_400_BAD_REQUEST)

        note = str(request.data.get('note') or '').strip()[:500]
        notify = request.data.get('notify', True) not in (False, 'false', '0', 0)
        previous = change_booking_status(booking, new_status, note=note, notify=notify)
        changes = {'status': [previous, new_status]}
        if note:
            changes['note'] = note
        if action in ('uncancel', 'cancel'):
            # Whether the family was emailed: the audit is how the office later
            # answers «did they hear about it?» (2026-11-26: it could not tell).
            changes['family_notified'] = bool(notify and booking.parent_email
                                              and not visit_started(booking))
        record('update', booking, changes, actor=request.user,
               context=self.CONTEXTS.get(action, f'bookings: {action}'))
        return Response(AdminBookingSerializer(booking).data)


class AdminBookingRescheduleView(APIView):
    """POST /bookings/admin/bookings/<pk>/reschedule/ {"slot": id} — move a visit to another slot (P4-2).
    Checks capacity, keeps the old slot as rescheduled_from, re-syncs the calendar and emails the family."""
    admin_area = 'visitas'
    permission_classes = [IsAdmin]

    def post(self, request, pk):
        booking = Booking.objects.select_related('slot').filter(pk=pk).first()
        if booking is None:
            return Response({'detail': 'No encontrado.'}, status=status.HTTP_404_NOT_FOUND)
        if booking.status == Booking.Status.ATTENDED or booking.outcome:
            return Response({'detail': 'Esta visita ya ocurrió (asistida o con resultado): no se reprograma.'},
                            status=status.HTTP_400_BAD_REQUEST)
        try:
            slot_pk = int(request.data.get('slot'))
        except (TypeError, ValueError):
            return Response({'slot': ['Horario no válido.']}, status=status.HTTP_400_BAD_REQUEST)
        slot = AvailabilitySlot.objects.filter(pk=slot_pk, is_active=True).first()
        if slot is None:
            return Response({'slot': ['Horario no válido.']}, status=status.HTTP_400_BAD_REQUEST)
        if slot.pk == booking.slot_id:
            return Response({'slot': ['Es el mismo horario.']}, status=status.HTTP_400_BAD_REQUEST)
        now = timezone.localtime()
        if (slot.date, slot.start_time) <= (now.date(), now.time()):
            return Response({'slot': ['Ese horario ya pasó: elija uno futuro.']}, status=status.HTTP_400_BAD_REQUEST)
        # Lock the target slot while we count and move, so two admins
        # rescheduling into the last seat cannot both succeed (create_booking
        # already does this; this path did not).
        with transaction.atomic():
            slot = AvailabilitySlot.objects.select_for_update().get(pk=slot.pk)
            # Seats = attendees, not rows, and no-shows free theirs: the same
            # rule as create_booking and AvailabilitySlot.annotate_booked.
            booked = occupied_seats(slot, exclude_pk=booking.pk)
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
        from apps.portal.emailing import EmailContent, long_date
        from apps.portal.services import send_email
        content = EmailContent(
            category='Visitas', tone='warning',
            title='Su visita fue reprogramada',
            intro=(f'Estimado/a {booking.parent_name}: su visita quedó reprogramada para el '
                   f'{long_date(slot.date)} a las {slot.start_time:%H:%M}.'),
            details=[('Nuevo horario', f'{long_date(slot.date)}, {slot.start_time:%H:%M} a {slot.end_time:%H:%M}'),
                     ('Horario anterior', f'{long_date(old.date)}, {old.start_time:%H:%M}'),
                     ('Lugar', slot.location or 'Campus Interlaken')],
            note='Si no le es posible, responda a este correo o escríbanos por WhatsApp.',
            signoff='Equipo de Admisiones',
            reason='Recibe este correo porque agendó una visita al Colegio Interlaken.',
        )
        send_email('Su visita al Colegio Interlaken cambió de horario', '', [booking.parent_email],
                   reply_to=settings.ADMISSIONS_EMAIL, content=content)
        record('update', booking, {'slot': {'from': old.pk, 'to': slot.pk}}, actor=request.user, context='bookings: reprogramación')
        return Response(AdminBookingSerializer(booking).data)


class AdminBookingOutcomeView(APIView):
    """POST /bookings/admin/bookings/<pk>/outcome/ {"outcome", "note"?, "update_prereg"?}: post-visit result (P4-2).

    Marks the visit attended through the booking transition table (no email),
    stores the outcome and, unless ``update_prereg`` is false, moves the
    booking's admissions case: ``Booking.pre_registration`` first, else the
    latest lead with the parent's email (then attached to the booking). The
    case moves forward only, through ``admissions.process.apply_booking_outcome``
    (Expediente, Fase 5): «Se inscribirá» → Examen, «No le interesó» → cerrado,
    «Interesada» / «No por ahora» → Visita guiada (legacy status «contacted»).
    A closed or enrolled case is skipped and reported, never forced (its own
    audit row on the case)."""
    admin_area = 'visitas'
    permission_classes = [IsAdmin]

    def post(self, request, pk):
        from apps.admissions.process import apply_booking_outcome, lead_for_booking
        from apps.bookings.services.status import change_booking_status

        booking = Booking.objects.select_related('slot').filter(pk=pk).first()
        if booking is None:
            return Response({'detail': 'No encontrado.'}, status=status.HTTP_404_NOT_FOUND)
        outcome = str(request.data.get('outcome') or '')
        if outcome not in Booking.Outcome.values or outcome == '':
            return Response({'outcome': ['Resultado no válido.']}, status=status.HTTP_400_BAD_REQUEST)
        update_prereg = parse_bool_param(request.data.get('update_prereg', True))
        if update_prereg is None:
            return Response({'update_prereg': ['Valor inválido: use true o false.']},
                            status=status.HTTP_400_BAD_REQUEST)
        if booking.status in (Booking.Status.CANCELLED, Booking.Status.NO_SHOW):
            return Response({'detail': f'La visita está «{booking.get_status_display()}»: '
                                       'márquela como asistida antes de registrar el resultado.'},
                            status=status.HTTP_400_BAD_REQUEST)

        with transaction.atomic():
            previous = booking.status
            if booking.status in (Booking.Status.CONFIRMED, Booking.Status.PENDING):
                change_booking_status(booking, Booking.Status.ATTENDED, note=None, notify=False)
            booking.outcome = outcome
            booking.outcome_note = str(request.data.get('note') or '')[:500]
            booking.save(update_fields=['outcome', 'outcome_note', 'updated_at'])

            linked = None
            lead = lead_for_booking(booking, lock=True) if update_prereg else None
            if lead is not None:
                linked = apply_booking_outcome(lead, booking, outcome, actor=request.user)
            changes = {'outcome': outcome, 'prereg': linked}
            if previous != booking.status:
                changes['status'] = [previous, booking.status]
            record('update', booking, changes, actor=request.user, context='bookings: resultado de visita')
        data = AdminBookingSerializer(booking).data
        data['pre_registration'] = linked
        return Response(data)


def _booking_prefill(booking) -> dict:
    """What «Pasar a Admisiones» starts the form with: the booking's own data.
    The grade is kept only when it reads as one of the admission grades
    («1° primaria», «Primaria 1» → «1° Primaria»); the office picks it otherwise."""
    from apps.admissions.ficha_schema import normalize_grade

    return {
        'child_name': booking.child_name,
        'grade_applying': normalize_grade(booking.child_grade) or '',
        'child_grade_text': booking.child_grade,
        'parent_name': booking.parent_name,
        'parent_email': booking.parent_email,
        'parent_phone': booking.parent_phone,
    }


def _case_brief(lead) -> dict | None:
    if lead is None:
        return None
    from apps.admissions.process import stage_label

    return {
        'id': lead.pk,
        'child_name': f'{lead.child_first_name} {lead.child_last_name}'.strip(),
        'stage': lead.stage,
        'stage_label': stage_label(lead.stage),
    }


class AdminBookingAdmissionsView(APIView):
    """GET/POST /bookings/admin/bookings/<pk>/admissions/: «Pasar a Admisiones».

    Owner 2026-11-26: a family that booked on the website by itself had no
    admissions case, so the office could not start the process from the visit.

    GET: ``{case, duplicates, prefill}``. ``case`` is the Expediente the visit
    belongs to (or null); ``duplicates`` are cases with the family's phone or
    email (``process.find_duplicates``), to link instead of creating a twin.

    POST: ``{link_to: <case id>}`` attaches the visit to that case, or the
    «Nuevo prospecto» fields (``ProspectSerializer``, same rules) create one.
    Then the case moves forward only: a visit that stands or happened puts it in
    «Visita guiada», and a result already recorded on the visit is applied like
    «Resultado de la visita» does (``apply_booking_outcome``); a cancelled or
    missed visit leaves it in «Informes». 409 when the visit already has a case.
    Both the case and the booking get an audit row. The booking row is locked so
    a double click never creates two cases.
    """
    admin_area = ('admisiones', 'visitas')
    permission_classes = [IsAdmin]

    def get(self, request, pk):
        from apps.admissions.process import find_duplicates
        from apps.admissions.process_serializers import case_row

        booking = Booking.objects.select_related('slot', 'pre_registration').filter(pk=pk).first()
        if booking is None:
            return Response({'detail': 'No encontrado.'}, status=status.HTTP_404_NOT_FOUND)
        lead = booking.pre_registration
        duplicates = [] if lead is not None else [
            case_row(d) for d in find_duplicates(phone=booking.parent_phone, email=booking.parent_email)
        ]
        return Response({'case': _case_brief(lead), 'duplicates': duplicates,
                         'prefill': _booking_prefill(booking)})

    def post(self, request, pk):
        from apps.admissions import process
        from apps.admissions.models import PreRegistration
        from apps.admissions.process_serializers import ProspectSerializer, case_row

        with transaction.atomic():
            booking = Booking.objects.select_for_update().filter(pk=pk).first()
            if booking is None:
                return Response({'detail': 'No encontrado.'}, status=status.HTTP_404_NOT_FOUND)
            if booking.pre_registration_id:
                return Response({'detail': 'Esta visita ya tiene expediente de admisión.',
                                 'case': _case_brief(booking.pre_registration)},
                                status=status.HTTP_409_CONFLICT)
            link_to = request.data.get('link_to')
            if link_to not in (None, ''):
                try:
                    lead_pk = int(link_to)
                except (TypeError, ValueError):
                    return Response({'link_to': ['Expediente no válido.']},
                                    status=status.HTTP_400_BAD_REQUEST)
                lead = PreRegistration.objects.select_for_update().filter(pk=lead_pk).first()
                if lead is None:
                    return Response({'link_to': ['Expediente no encontrado.']},
                                    status=status.HTTP_400_BAD_REQUEST)
                created = False
            else:
                ser = ProspectSerializer(data=request.data)
                ser.is_valid(raise_exception=True)
                lead = ser.save()
                created = True

            booking.pre_registration = lead
            booking.save(update_fields=['pre_registration', 'updated_at'])
            via = f'visitas: pasar a admisiones (visita #{booking.pk})'
            if created:
                record('create', lead, {'via': via, 'booking': booking.pk, 'stage': lead.stage},
                       actor=request.user, context=f'{process.CASE_CONTEXT}: {via}')
            else:
                record('update', lead, {'via': via, 'booking': booking.pk},
                       actor=request.user, context=f'{process.CASE_CONTEXT}: {via}')

            # Forward only: never pulls a case back, never moves a closed one.
            standing = (Booking.Status.PENDING, Booking.Status.CONFIRMED, Booking.Status.ATTENDED)
            if booking.status in standing and booking.outcome:
                process.apply_booking_outcome(lead, booking, booking.outcome, actor=request.user)
            elif booking.status in standing:
                diff = process.advance_to(lead, process.Stage.VISITA)
                if diff:
                    diff['booking'] = booking.pk
                process.save_and_record(lead, diff, request.user,
                                        context=f'{process.CASE_CONTEXT}: {via}')
            record('update', booking,
                   {'pre_registration': [None, lead.pk], 'case_created': created},
                   actor=request.user, context='bookings: pasar a admisiones')
        lead.refresh_from_db()
        return Response({'case': case_row(lead), 'created': created},
                        status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)


class AdminWeekView(APIView):
    """GET /bookings/admin/week/?start=YYYY-MM-DD — 7 days of slots with their bookings (P4-2 calendar)."""
    admin_area = 'visitas'
    permission_classes = [IsAdmin]

    def get(self, request):
        start_s = request.query_params.get('start')
        try:
            start = datetime.strptime(start_s, '%Y-%m-%d').date() if start_s else timezone.localdate()
            start = start - timedelta(days=start.weekday())  # Monday
            end = start + timedelta(days=6)
        except (ValueError, OverflowError):
            # OverflowError: the week of 9999-12-31 ends past the last date.
            return Response({'start': ['Fecha no válida.']}, status=status.HTTP_400_BAD_REQUEST)
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
                                  'outcome': b.outcome, 'num_attendees': b.num_attendees, 'parent_phone': b.parent_phone,
                                  # The admissions case (Expediente) the visit belongs to, if any.
                                  'case': b.pre_registration_id} for b in bk],
                })
            days.append({'date': d.isoformat(), 'slots': day_slots})
        return Response({'start': start.isoformat(), 'end': end.isoformat(), 'days': days})


class AdminSlotListView(AdminListMixin, generics.ListAPIView):
    """GET /api/v1/bookings/admin/slots/ — every published slot (incl. inactive/past).

    Data Ops C1: ``q`` over title / location; ``type``, ``active=true|false``,
    ``from``/``to`` via ``SlotFilterSet``; ordering keys ``date, start, type,
    capacity, booked`` (``booked`` is the annotated attendee total) with a
    ``-pk`` tiebreak; ``page`` / ``page_size``. One query per page + count."""
    admin_area = 'visitas'
    serializer_class = AdminSlotSerializer
    search_fields = data_ops.SLOT_SEARCH_FIELDS
    ordering = data_ops.SLOT_ORDERING
    default_ordering = data_ops.SLOT_DEFAULT_ORDERING
    filterset_class = data_ops.SlotFilterSet

    def get_queryset(self):
        return AvailabilitySlot.annotate_booked(AvailabilitySlot.objects.all())


class AdminSlotExportView(AdminExportMixin, AdminSlotListView):
    """GET /api/v1/bookings/admin/slots/export/?fmt=csv|xlsx|pdf&ids=…"""
    admin_area = 'visitas'
    export_spec = data_ops.SLOT_EXPORT


class AdminSlotBulkView(AdminBulkView):
    """POST /api/v1/bookings/admin/slots/bulk/ — activate / deactivate / delete.
    A slot with any booking (even cancelled) is never deleted: it is reported
    as skipped with the reason (deactivate it instead)."""
    admin_area = 'visitas'
    entity = 'bookings.availabilityslot'
    list_view_class = AdminSlotListView
    actions = data_ops.SLOT_BULK_ACTIONS


class AdminSlotImportTemplateView(ImportTemplateView):
    """GET /api/v1/bookings/admin/slots/import/template/?fmt=csv|xlsx"""
    admin_area = 'visitas'
    spec = data_ops.SLOT_IMPORT


class AdminSlotImportView(ImportView):
    """POST /api/v1/bookings/admin/slots/import/ — multipart ``file`` with
    ``tipo, fecha (DD/MM/AAAA), inicio (HH:MM), fin, cupo, lugar`` (+ ``titulo``);
    ``dry_run=1`` (default) previews, ``report=csv|xlsx`` returns the annotated
    file, ``dry_run=0`` commits (``valid_only=1`` to skip error rows)."""
    admin_area = 'visitas'
    spec = data_ops.SLOT_IMPORT
    template_url = '/api/v1/bookings/admin/slots/import/template/'


class AdminSlotDetailView(AuditedCrudMixin, generics.RetrieveUpdateDestroyAPIView):
    """GET/PATCH/DELETE /api/v1/bookings/admin/slots/<id>/ — edit (capacity,
    location, title, is_active) or delete a slot. Deleting is refused when any
    booking references the slot (CASCADE would erase that history); deactivate
    instead. Every edit and delete writes an audit row with the changed fields."""
    admin_area = 'visitas'
    audit_context = 'bookings: horario'
    queryset = AvailabilitySlot.objects.all()
    serializer_class = AdminSlotSerializer
    permission_classes = [IsAdmin]
    http_method_names = ['get', 'patch', 'delete']

    def destroy(self, request, *args, **kwargs):
        slot = self.get_object()
        booked = slot.bookings.count()
        if booked:
            return Response(
                {'detail': f'No se puede eliminar: '
                           f'{plural(booked, "reserva asociada", "reservas asociadas")}. '
                           f'Desactive el horario para ocultarlo sin perder el historial.'},
                status=status.HTTP_400_BAD_REQUEST)
        return super().destroy(request, *args, **kwargs)
