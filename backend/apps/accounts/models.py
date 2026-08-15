"""
accounts/models.py — Custom User + Role system for Colegio Interlaken
"""
from django.contrib.auth.models import AbstractBaseUser, BaseUserManager, PermissionsMixin
from django.db import models
from django.utils import timezone


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
    parents       = models.ManyToManyField(User, related_name='children', blank=True,
                                           limit_choices_to={'role': User.Role.PARENT})
    enrollment_date = models.DateField(null=True, blank=True)
    is_active     = models.BooleanField(default=True)

    class Meta:
        verbose_name = 'Perfil de Alumno'
        indexes = [
            models.Index(fields=['loyverse_id']),
            models.Index(fields=['is_active', 'loyverse_id']),
        ]

    def __str__(self):
        return f'{self.user.full_name} — {self.grade} {self.group}'


class ParentProfile(models.Model):
    """Extended profile for parent/guardian users."""
    user          = models.OneToOneField(User, on_delete=models.CASCADE, related_name='parent_profile')
    phone         = models.CharField(max_length=20, blank=True)
    relationship  = models.CharField(max_length=50, default='Padre/Madre')  # Padre, Madre, Tutor

    class Meta:
        verbose_name = 'Perfil de Padre/Tutor'

    def __str__(self):
        return f'{self.user.full_name}'


class PasswordResetToken(models.Model):
    """One-time password reset / account-activation token (hashed at rest)."""
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='password_reset_tokens')
    token_hash = models.CharField(max_length=64, db_index=True)
    expires_at = models.DateTimeField()
    used_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'ResetToken(user={self.user_id}, used={bool(self.used_at)})'


class NotificationPreference(models.Model):
    """Per-user channel toggles for portal.services.notify()."""
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='notif_prefs')
    email_enabled = models.BooleanField(default=True)
    in_app_enabled = models.BooleanField(default=True)
    push_enabled = models.BooleanField(default=True)
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
