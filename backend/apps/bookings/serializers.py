from datetime import time

from rest_framework import serializers

from .models import AvailabilitySlot, Booking, VisitType


class AvailabilitySlotSerializer(serializers.ModelSerializer):
    """Public read view of an open slot (used by the picker)."""
    spots_remaining = serializers.IntegerField(read_only=True)
    is_full         = serializers.BooleanField(read_only=True)

    class Meta:
        model = AvailabilitySlot
        fields = [
            'id', 'visit_type', 'date', 'start_time', 'end_time',
            'capacity', 'location', 'spots_remaining', 'is_full',
        ]


class BookingSerializer(serializers.ModelSerializer):
    """Read view of a booking, with denormalised slot details for confirmations."""
    slot_date       = serializers.DateField(source='slot.date', read_only=True)
    slot_start_time = serializers.TimeField(source='slot.start_time', read_only=True)
    slot_end_time   = serializers.TimeField(source='slot.end_time', read_only=True)
    slot_location   = serializers.CharField(source='slot.location', read_only=True)
    visit_type      = serializers.CharField(source='slot.visit_type', read_only=True)

    class Meta:
        model = Booking
        fields = [
            'id', 'slot', 'visit_type',
            'slot_date', 'slot_start_time', 'slot_end_time', 'slot_location',
            'parent_name', 'parent_email', 'parent_phone',
            'child_name', 'child_grade', 'num_attendees',
            'status', 'source', 'confirmation_sent', 'created_at',
        ]
        read_only_fields = ['id', 'status', 'source', 'confirmation_sent', 'created_at']


class BookingCreateSerializer(serializers.ModelSerializer):
    """Public booking payload. Capacity is enforced in the view under a lock."""
    slot = serializers.PrimaryKeyRelatedField(
        queryset=AvailabilitySlot.objects.filter(is_active=True)
    )

    class Meta:
        model = Booking
        fields = [
            'slot', 'parent_name', 'parent_email', 'parent_phone',
            'child_name', 'child_grade', 'num_attendees',
        ]

    def validate_num_attendees(self, value):
        if value < 1:
            raise serializers.ValidationError('Debe haber al menos un asistente.')
        return value


class SlotGeneratorSerializer(serializers.Serializer):
    """Admin bulk/recurring slot generator input.

    Produces individual slots for every ``weekday`` between ``start_date`` and
    ``end_date``, stepping from ``window_start`` to ``window_end`` in
    ``interval_minutes`` increments.
    """
    visit_type       = serializers.ChoiceField(choices=VisitType.choices, default=VisitType.INDIVIDUAL)
    start_date       = serializers.DateField()
    end_date         = serializers.DateField()
    weekdays         = serializers.ListField(
        child=serializers.IntegerField(min_value=0, max_value=6),
        allow_empty=False,
        help_text='0=Lunes … 6=Domingo',
    )
    window_start     = serializers.TimeField()
    window_end       = serializers.TimeField()
    interval_minutes = serializers.IntegerField(min_value=5, max_value=480, default=30)
    capacity         = serializers.IntegerField(min_value=1, default=1)
    location         = serializers.CharField(max_length=200, required=False, default='Campus Interlaken')

    def validate(self, data):
        if data['end_date'] < data['start_date']:
            raise serializers.ValidationError('La fecha final no puede ser anterior a la inicial.')
        if data['window_end'] <= data['window_start']:
            raise serializers.ValidationError('La hora de fin debe ser posterior a la de inicio.')
        return data
