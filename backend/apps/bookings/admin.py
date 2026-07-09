from django.contrib import admin
from unfold.admin import ModelAdmin

from .models import AvailabilitySlot, Booking


@admin.register(AvailabilitySlot)
class AvailabilitySlotAdmin(ModelAdmin):
    list_display = ('date', 'start_time', 'end_time', 'visit_type', 'capacity', 'booked_count', 'is_active')
    list_filter = ('visit_type', 'is_active', 'date')
    ordering = ('-date', 'start_time')
    list_editable = ('is_active',)

    @admin.display(description='Reservados')
    def booked_count(self, obj):
        return obj.booked_count


@admin.register(Booking)
class BookingAdmin(ModelAdmin):
    list_display = ('parent_name', 'parent_email', 'slot', 'num_attendees', 'status', 'source', 'created_at')
    list_filter = ('status', 'source', 'slot__visit_type')
    search_fields = ('parent_name', 'parent_email', 'parent_phone', 'child_name')
    ordering = ('-created_at',)
    list_editable = ('status',)
    raw_id_fields = ('slot',)
