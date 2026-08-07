from django.contrib import admin
from django.contrib.auth.admin import GroupAdmin as BaseGroupAdmin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from django.contrib.auth.models import Group
from unfold.admin import ModelAdmin, StackedInline
from unfold.forms import AdminPasswordChangeForm, UserChangeForm, UserCreationForm

from .models import ParentProfile, StudentProfile, User


class LoyverseProfileInline(StackedInline):
    """Read-only Loyverse snapshot shown on the student page (synced separately)."""
    from apps.cafeteria.models import LoyverseProfile
    model = LoyverseProfile
    can_delete = False
    extra = 0
    max_num = 0  # never add from here — populated by sync_loyverse_profiles
    fields = ('customer_code', 'name', 'email', 'phone_number', 'address_code',
              'first_visit', 'last_visit', 'total_visits', 'total_spent',
              'total_points', 'synced_at')
    readonly_fields = fields

# Re-register Group with the unfold skin so auth plumbing renders consistently.
admin.site.unregister(Group)


@admin.register(Group)
class GroupAdmin(BaseGroupAdmin, ModelAdmin):
    pass


@admin.register(User)
class UserAdmin(BaseUserAdmin, ModelAdmin):
    form = UserChangeForm
    add_form = UserCreationForm
    change_password_form = AdminPasswordChangeForm
    list_display = ('email', 'full_name', 'role', 'is_active', 'date_joined')
    list_filter = ('role', 'is_active', 'is_staff')
    search_fields = ('email', 'first_name', 'last_name')
    ordering = ('-date_joined',)
    date_hierarchy = 'date_joined'
    readonly_fields = ('last_login', 'date_joined')
    fieldsets = (
        (None, {'fields': ('email', 'password')}),
        ('Información personal', {'fields': ('first_name', 'last_name', 'avatar', 'whatsapp')}),
        ('Permisos', {'fields': ('role', 'is_active', 'is_staff', 'is_superuser', 'groups', 'user_permissions')}),
        ('Fechas', {'fields': ('last_login', 'date_joined')}),
    )
    add_fieldsets = (
        (None, {'classes': ('wide',), 'fields': ('email', 'first_name', 'last_name', 'role', 'password1', 'password2')}),
    )
    filter_horizontal = ('groups', 'user_permissions')

@admin.register(StudentProfile)
class StudentProfileAdmin(ModelAdmin):
    list_display = ('user', 'student_id', 'grade', 'group', 'is_active', 'loyverse_id')
    list_filter = ('grade', 'group', 'is_active')
    search_fields = ('user__email', 'user__first_name', 'user__last_name',
                     'student_id', 'loyverse_id')
    raw_id_fields = ('user', 'parents')
    list_select_related = ('user',)
    inlines = [LoyverseProfileInline]

@admin.register(ParentProfile)
class ParentProfileAdmin(ModelAdmin):
    list_display = ('user', 'phone', 'relationship')
    search_fields = ('user__email', 'user__first_name', 'user__last_name', 'phone')
    list_select_related = ('user',)
