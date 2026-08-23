"""
accounts/models.py — Custom User + Role system for Colegio Interlaken
"""
from django.contrib.auth.models import AbstractBaseUser, BaseUserManager, PermissionsMixin
from django.db import models
from django.utils import timezone

from apps.core.fields import EncryptedTextField


class UserManager(BaseUserManager):
    def create_user(self, email, password=None, **extra_fields):
        if not email:
            raise ValueError('Email is required')
        email = self.normalize_email(email)
        user = self.model(email=email, **extra_fields)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_superuser(self, email, password, **extra_fields):
        extra_fields.setdefault('is_staff', True)
        extra_fields.setdefault('is_superuser', True)
        extra_fields.setdefault('role', User.Role.ADMIN)
        return self.create_user(email, password, **extra_fields)


class User(AbstractBaseUser, PermissionsMixin):
    class Role(models.TextChoices):
        ADMIN   = 'admin',   'Administrador'
        PARENT  = 'parent',  'Padre/Tutor'
        STUDENT = 'student', 'Alumno'
        STAFF   = 'staff',   'Personal'

    # Core fields
    email      = models.EmailField(unique=True)
    first_name = models.CharField(max_length=100)
    last_name  = models.CharField(max_length=100)
    role       = models.CharField(max_length=20, choices=Role.choices, default=Role.PARENT)
    avatar     = models.URLField(blank=True)          # Google profile picture
    avatar_file = models.FileField(upload_to='avatars/', blank=True, null=True)  # uploaded photo (P1-F2), 256px WebP

    # Status
    is_active  = models.BooleanField(default=True)
    is_staff   = models.BooleanField(default=False)
    date_joined = models.DateTimeField(default=timezone.now)
    last_login  = models.DateTimeField(null=True, blank=True)

    # Google OAuth
    google_id   = models.CharField(max_length=200, blank=True, unique=True, null=True)

    # WhatsApp
    whatsapp    = models.CharField(max_length=20, blank=True)

    objects = UserManager()

    USERNAME_FIELD  = 'email'
    REQUIRED_FIELDS = ['first_name', 'last_name']

    class Meta:
        verbose_name = 'Usuario'
        verbose_name_plural = 'Usuarios'
        ordering = ['last_name', 'first_name']
        indexes = [
            models.Index(fields=['role', 'is_active']),
        ]

    def __str__(self):
        return f'{self.full_name} ({self.email})'

    @property
    def full_name(self):
        return f'{self.first_name} {self.last_name}'.strip()

    @property
    def is_admin(self):
        return self.role == self.Role.ADMIN

    @property
    def is_parent(self):
        return self.role == self.Role.PARENT

    @property
    def is_student(self):
        return self.role == self.Role.STUDENT


class StudentProfile(models.Model):
    """Extended profile for student users."""
    user          = models.OneToOneField(User, on_delete=models.CASCADE, related_name='student_profile')
    student_id    = models.CharField(max_length=20, unique=True)        # School ID / card number
    grade         = models.CharField(max_length=20)                     # e.g. "3° Primaria"
    group         = models.CharField(max_length=5, blank=True)          # e.g. "A"
    loyverse_id   = models.CharField(max_length=100, blank=True)        # Loyverse customer ID
    registration  = models.OneToOneField('admissions.Registration', null=True, blank=True, on_delete=models.SET_NULL,
                                         related_name='student_profile')  # origin when converted (P4-1)
    parents       = models.ManyToManyField(User, related_name='children', blank=True,
                                           limit_choices_to={'role': User.Role.PARENT})
    enrollment_date = models.DateField(null=True, blank=True)
    is_active     = models.BooleanField(default=True)

    # Extended file (BACKLOG P1-A2). Medical fields are sensitive personal data:
    # encrypted at rest (same as admissions.Registration) and only serialized for
    # admins and the student's own family (see StudentProfileSerializer).
    birth_date      = models.DateField(null=True, blank=True, verbose_name='Fecha de nacimiento')
    curp            = models.CharField(max_length=20, blank=True, verbose_name='CURP')
    emergency_name  = models.CharField(max_length=200, blank=True)
    emergency_phone = models.CharField(max_length=20, blank=True)
    emergency_rel   = models.CharField(max_length=50, blank=True)
    blood_type      = EncryptedTextField(blank=True, default='')
    allergies       = EncryptedTextField(blank=True, default='')
    medical_notes   = EncryptedTextField(blank=True, default='')

    class Status(models.TextChoices):
        ACTIVE = 'active', 'Activo'
        ON_LEAVE = 'on_leave', 'Baja temporal'
        GRADUATED = 'graduated', 'Egresado'
        WITHDRAWN = 'withdrawn', 'Baja definitiva'

    # Lifecycle (BACKLOG P1-A7). ``is_active`` mirrors ``status == active`` so
    # every existing ``is_active`` filter (cafetería sync, comunicados) keeps
    # working; ``apply_status()`` also toggles the student's own login.
    status        = models.CharField(max_length=12, choices=Status.choices, default=Status.ACTIVE,
                                     db_index=True)

    def apply_status(self, status: str) -> list[str]:
        """Set ``status`` + derived flags; returns the profile fields to save.

        The student's own User (school-email family login) is deactivated when
        the student is not active, so the account cannot log in; guardians keep
        their access because they may have other children.
        """
        self.status = status
        self.is_active = status == self.Status.ACTIVE
        user = self.user
        if user.role == User.Role.STUDENT and user.is_active != self.is_active:
            user.is_active = self.is_active
            user.save(update_fields=['is_active'])
        return ['status', 'is_active']

    class Meta:
        verbose_name = 'Perfil de Alumno'
        indexes = [
            models.Index(fields=['loyverse_id']),
            models.Index(fields=['is_active', 'loyverse_id']),
        ]

    def __str__(self):
        return f'{self.user.full_name} — {self.grade} {self.group}'

    @property
    def age(self):
        if not self.birth_date:
            return None
        today = timezone.localdate()
        return today.year - self.birth_date.year - (
            (today.month, today.day) < (self.birth_date.month, self.birth_date.day))


class ParentProfile(models.Model):
    """Extended profile for parent/guardian users."""
    user          = models.OneToOneField(User, on_delete=models.CASCADE, related_name='parent_profile')
    phone         = models.CharField(max_length=20, blank=True)
    relationship  = models.CharField(max_length=50, default='Padre/Madre')  # Padre, Madre, Tutor

    class Meta:
        verbose_name = 'Perfil de Padre/Tutor'

    def __str__(self):
        return f'{self.user.full_name}'


class NotificationPreference(models.Model):
    """Per-user channel toggles for portal.services.notify()."""
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='notif_prefs')
    email_enabled = models.BooleanField(default=True)
    in_app_enabled = models.BooleanField(default=True)
    push_enabled = models.BooleanField(default=True)
    # Per-category toggles (BACKLOG P1-C4). Channel toggles above are the master
    # switches; a category off silences every channel for that category.
    # Warnings (emergencies, low balance) cannot be silenced.
    cat_cafeteria = models.BooleanField('Cafetería', default=True)
    cat_payment = models.BooleanField('Pagos', default=True)
    cat_info = models.BooleanField('Comunicados y avisos', default=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'Preferencias de notificación'

    def __str__(self):
        return f'NotifPrefs({self.user_id})'

    @classmethod
    def for_user(cls, user):
        """Return prefs, creating defaults if missing."""
        prefs, _ = cls.objects.get_or_create(user=user)
        return prefs

    CATEGORY_FIELD = {'cafeteria': 'cat_cafeteria', 'payment': 'cat_payment', 'info': 'cat_info'}

    def allows(self, notif_type: str) -> bool:
        """False when the user muted this category; warnings are never muted."""
        field = self.CATEGORY_FIELD.get(notif_type)
        return True if field is None else bool(getattr(self, field, True))


class PasswordRequest(models.Model):
    """A family's request for a (new) password, received by WhatsApp, email,
    phone or in person (BACKLOG P1-A4 / AE5).

    Self-service reset does not exist; this row is the traceable record of
    "who asked, through which channel, who verified them and who set the
    password". Resolving it runs the same admin set-password flow.
    """

    class Channel(models.TextChoices):
        WHATSAPP = 'whatsapp', 'WhatsApp'
        EMAIL = 'email', 'Correo'
        PHONE = 'phone', 'Teléfono'
        IN_PERSON = 'in_person', 'Presencial'

    class Status(models.TextChoices):
        OPEN = 'open', 'Pendiente'
        RESOLVED = 'resolved', 'Resuelta'
        REJECTED = 'rejected', 'Rechazada'

    user = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL,
                             related_name='password_requests')
    requested_email = models.EmailField(blank=True)
    requester_name = models.CharField(max_length=150, blank=True)
    channel = models.CharField(max_length=12, choices=Channel.choices, default=Channel.WHATSAPP)
    note = models.CharField(max_length=300, blank=True)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.OPEN, db_index=True)
    created_by = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL,
                                   related_name='+')
    created_at = models.DateTimeField(auto_now_add=True)
    resolved_by = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL,
                                    related_name='+')
    resolved_at = models.DateTimeField(null=True, blank=True)
    delivered_via = models.CharField(max_length=12, choices=Channel.choices, blank=True)

    class Meta:
        ordering = ['-created_at']
        verbose_name = 'Solicitud de contraseña'
        verbose_name_plural = 'Solicitudes de contraseña'

    def __str__(self):
        return f'PasswordRequest({self.requested_email or self.user_id}, {self.status})'


from .security import LoginEvent, TotpDevice  # noqa: E402,F401
