from django.contrib import admin
from unfold.admin import ModelAdmin

from .models import OpenSchoolDay, PreRegistration, Registration, RegistrationDocument


@admin.register(PreRegistration)
class PreRegistrationAdmin(ModelAdmin):
    list_display = ('child_first_name', 'child_last_name', 'parent_email', 'grade_applying', 'status', 'created_at')
    list_filter = ('status', 'level')
    search_fields = ('child_first_name', 'child_last_name', 'parent_name', 'parent_email')
    ordering = ('-created_at',)
    list_editable = ('status',)


@admin.register(Registration)
class RegistrationAdmin(ModelAdmin):
    list_display = ('child_first_name', 'child_last_name', 'parent1_email', 'grade_applying', 'status', 'created_at')
    list_filter = ('status', 'level')
    search_fields = ('child_first_name', 'child_last_name', 'parent1_email')
    ordering = ('-created_at',)


@admin.register(RegistrationDocument)
class RegistrationDocumentAdmin(ModelAdmin):
    list_display = ('registration', 'doc_type', 'uploaded_at')
    list_filter = ('doc_type',)


@admin.register(OpenSchoolDay)
class OpenSchoolDayAdmin(ModelAdmin):
    list_display = ('event_name', 'event_date', 'event_time', 'max_capacity')
    ordering = ('event_date',)
