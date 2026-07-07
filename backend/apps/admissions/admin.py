from django.contrib import admin
from .models import PreRegistration, Registration, RegistrationDocument, OpenSchoolDay


@admin.register(PreRegistration)
class PreRegistrationAdmin(admin.ModelAdmin):
    list_display = ('child_first_name', 'child_last_name', 'parent_email', 'grade_applying', 'status', 'created_at')
    list_filter = ('status', 'level')
    search_fields = ('child_first_name', 'child_last_name', 'parent_name', 'parent_email')
    ordering = ('-created_at',)
    list_editable = ('status',)


@admin.register(Registration)
class RegistrationAdmin(admin.ModelAdmin):
    list_display = ('child_first_name', 'child_last_name', 'parent1_email', 'grade_applying', 'status', 'created_at')
    list_filter = ('status', 'level')
    search_fields = ('child_first_name', 'child_last_name', 'parent1_email')
    ordering = ('-created_at',)


@admin.register(RegistrationDocument)
class RegistrationDocumentAdmin(admin.ModelAdmin):
    list_display = ('registration', 'doc_type', 'uploaded_at')
    list_filter = ('doc_type',)


@admin.register(OpenSchoolDay)
class OpenSchoolDayAdmin(admin.ModelAdmin):
    list_display = ('event_name', 'event_date', 'event_time', 'max_capacity')
    ordering = ('event_date',)
