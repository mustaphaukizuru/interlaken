"""
A family adds another child itself, without the office (2026-11-13).

    GET  /accounts/me/family/          the children this login sees + whether it may add one
    POST /accounts/me/family/add/      {student}  (school email or matrícula) → sends a code
    POST /accounts/me/family/confirm/  {student, code} → links the child to the family

Proof of the relationship: a 6-digit code goes to the other child's mailboxes
(its school address, which the family reads, plus its confirmed personal
address and its guardians' addresses). Typing the code back links the child
to every child this login already sees (``accounts.families.link_students``),
so either login then sees all of them.

Safety: only a hash is stored, the code lives 15 minutes, five wrong tries
spend it, a family may ask for 5 codes an hour and a child may receive 3 an
hour (no inbox flooding), every code sent and every link is audited, and after
the link every account that gains access is told, «si usted no hizo este
cambio, avise al colegio». The office can undo it from Familias («Quitar»).
"""
from __future__ import annotations

import hashlib
import hmac
import secrets
from datetime import timedelta

from django.conf import settings
from django.db import transaction
from django.utils import timezone
from django.utils.decorators import method_decorator
from rest_framework import permissions, serializers, status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.audit import record
from apps.core.exceptions import error_body
from apps.core.matricula import is_ci_code, normalize_matricula
from apps.core.ratelimit import ratelimit

from .families import FamilyError, link_students, plan_link, student_summary
from .family import family_students
from .models import FamilyLinkCode, StudentProfile, User
from .notify_email import mask_email
from .recipients import email_recipients

CODE_TTL = timedelta(minutes=15)
MAX_ATTEMPTS = 5
MAX_CODES_PER_CHILD_HOUR = 3


class FamilyLogin(permissions.BasePermission):
    """A family account: a Padre/Tutor login or a child's own school-email login."""
    message = 'Solo las cuentas de familia pueden agregar hijos.'

    def has_permission(self, request, view):
        user = request.user
        return bool(user and user.is_authenticated
                    and user.role in (User.Role.PARENT, User.Role.STUDENT))


def _hash(code: str, requester_id: int, student_id: int) -> str:
    raw = f'{settings.SECRET_KEY}:{requester_id}:{student_id}:{code}'.encode()
    return hashlib.sha256(raw).hexdigest()


def _children(user) -> list[dict]:
    qs = (family_students(user).select_related('user', 'family')
          .order_by('user__first_name', 'pk'))
    return [student_summary(s) for s in qs]


def find_child(term: str) -> StudentProfile | None:
    """The child a family names: its school email or its matrícula (ci09932 too)."""
    term = (term or '').strip()
    if not term:
        return None
    base = StudentProfile.objects.select_related('user', 'family')
    if '@' in term:
        return base.filter(user__email__iexact=term).first()
    code = normalize_matricula(term) if is_ci_code(term) else term
    return base.filter(student_id__iexact=code).first()


class _StudentIn(serializers.Serializer):
    student = serializers.CharField(max_length=254, error_messages={
        'blank': 'Escriba el correo escolar o la matrícula de su otro hijo.',
        'required': 'Escriba el correo escolar o la matrícula de su otro hijo.'})


class _ConfirmIn(_StudentIn):
    code = serializers.RegexField(r'^\s*\d{3}\s?\d{3}\s*$', error_messages={
        'invalid': 'Escriba los 6 números del código.', 'blank': 'Escriba el código.',
        'required': 'Escriba el código.'})


def _bad(message: str, code: str = 'invalid', http=status.HTTP_400_BAD_REQUEST) -> Response:
    return Response(error_body(message, code=code), status=http)


def _check_child(user, child: StudentProfile | None):
    """``(child, error Response | None)``: may this login add this child?"""
    if child is None:
        return None, _bad('No encontramos a ningún alumno con ese correo o matrícula. '
                          'Revíselo o pida ayuda al colegio.', 'not_found')
    if child.user.archived_at or child.status != StudentProfile.Status.ACTIVE:
        return None, _bad('Ese alumno no está activo en el colegio. Pida ayuda al colegio.', 'inactive')
    mine = list(family_students(user).values_list('pk', flat=True))
    if child.pk in mine:
        return None, _bad(f'{child.user.first_name or child.user.full_name} ya aparece en su cuenta.',
                          'already_linked')
    if not mine:
        return None, _bad('Su cuenta todavía no tiene un alumno. Pida ayuda al colegio.', 'no_children')
    try:
        plan_link([*mine, child.pk])
    except FamilyError as exc:
        return None, _bad(str(exc), 'refused')
    return child, None


def _code_email(child: StudentProfile, requester, code: str):
    from apps.portal.emailing import EmailContent, long_date

    first = child.user.first_name or child.user.full_name
    expires = long_date(timezone.now() + CODE_TTL, with_time=True)
    pretty = f'{code[:3]} {code[3:]}'
    content = EmailContent(
        category='Portal de Familias',
        title=f'Código para agregar a {first} a su cuenta',
        intro=(f'Desde la cuenta {mask_email(requester.email)} del Portal de Familias se pidió agregar a '
               f'{child.user.full_name} como hermano o hermana. Si fue usted, escriba este código en el portal.'),
        preheader=f'Su código es {pretty}. Vence en 15 minutos.',
        highlight=('Código', pretty),
        details=[('Alumno', f'{child.user.full_name} ({child.grade}{" " + child.group if child.group else ""})'),
                 ('El código vence', expires)],
        note=(f'Si usted no lo pidió, ignore este correo: sin el código nadie puede ver los datos de {first}. '
              'Nunca comparta este código por teléfono ni por WhatsApp.'),
        reason='Recibe este correo porque es el correo escolar o de avisos de este alumno en el Colegio Interlaken.',
    )
    return f'Código para agregar a {first}: {pretty}', content


class MyFamilyView(APIView):
    """The children this family login sees, and whether it can add one."""
    permission_classes = [permissions.IsAuthenticated, FamilyLogin]

    def get(self, request):
        children = _children(request.user)
        return Response({'children': children, 'can_add': bool(children)})


@method_decorator(ratelimit('family-self-add', '5/h', key='user', method='POST'), name='post')
class MyFamilyAddView(APIView):
    """Send the code to the other child's mailboxes."""
    permission_classes = [permissions.IsAuthenticated, FamilyLogin]

    def post(self, request):
        from apps.portal.services import send_email

        data = _StudentIn(data=request.data)
        data.is_valid(raise_exception=True)
        user = request.user
        child, error = _check_child(user, find_child(data.validated_data['student']))
        if error is not None:
            return error
        mailboxes = email_recipients(child.user)
        if not mailboxes:
            return _bad('Ese alumno no tiene un correo donde enviar el código. Pida al colegio que '
                        'los vincule desde la consola.', 'no_mailbox')
        hour_ago = timezone.now() - timedelta(hours=1)
        if FamilyLinkCode.objects.filter(student=child, created_at__gte=hour_ago).count() >= MAX_CODES_PER_CHILD_HOUR:
            return _bad('Ya se enviaron varios códigos para este alumno. Espere una hora o pida ayuda al colegio.',
                        'too_many', status.HTTP_429_TOO_MANY_REQUESTS)

        code = f'{secrets.randbelow(10 ** 6):06d}'
        now = timezone.now()
        with transaction.atomic():
            # A new code replaces any earlier one for the same child.
            FamilyLinkCode.objects.filter(requester=user, student=child, used_at__isnull=True).update(used_at=now)
            FamilyLinkCode.objects.create(requester=user, student=child, code_hash=_hash(code, user.pk, child.pk),
                                          expires_at=now + CODE_TTL)
            record('update', user, {'family_code_sent': child.student_id, 'to': [mask_email(m) for m in mailboxes]},
                   actor=user, context='familia: código enviado')
        subject, content = _code_email(child, user, code)
        sent = send_email(subject=subject, message='', recipients=mailboxes, content=content)
        if not sent:
            return _bad('No se pudo enviar el correo con el código. Inténtelo de nuevo en unos minutos.',
                        'send_failed', status.HTTP_503_SERVICE_UNAVAILABLE)
        return Response({
            'sent_to': [mask_email(m) for m in mailboxes],
            'student': {'name': child.user.full_name, 'first_name': child.user.first_name,
                        'grade': child.grade, 'group': child.group},
            'expires_in_minutes': int(CODE_TTL.total_seconds() // 60),
        })


@method_decorator(ratelimit('family-self-confirm', '20/h', key='user', method='POST'), name='post')
class MyFamilyConfirmView(APIView):
    """Check the code and link the child to the family."""
    permission_classes = [permissions.IsAuthenticated, FamilyLogin]

    def post(self, request):
        data = _ConfirmIn(data=request.data)
        data.is_valid(raise_exception=True)
        user = request.user
        child, error = _check_child(user, find_child(data.validated_data['student']))
        if error is not None:
            return error
        code = ''.join(ch for ch in data.validated_data['code'] if ch.isdigit())
        now = timezone.now()
        with transaction.atomic():
            row = (FamilyLinkCode.objects.select_for_update()
                   .filter(requester=user, student=child, used_at__isnull=True)
                   .order_by('-created_at').first())
            if row is None or row.expires_at <= now:
                return _bad('El código venció o ya se usó. Pida uno nuevo.', 'expired')
            row.attempts += 1
            if not hmac.compare_digest(row.code_hash, _hash(code, user.pk, child.pk)):
                left = MAX_ATTEMPTS - row.attempts
                if left <= 0:
                    row.used_at = now
                row.save(update_fields=['attempts', 'used_at'])
                if left <= 0:
                    return _bad('Demasiados intentos. Pida un código nuevo.', 'locked')
                return _bad(f'El código no coincide. Le quedan {left} '
                            f'{"intento" if left == 1 else "intentos"}.', 'wrong_code')
            row.used_at = now
            row.save(update_fields=['attempts', 'used_at'])
        mine = list(family_students(user).values_list('pk', flat=True))
        try:
            link_students([*mine, child.pk], actor=user, notify=True, by_family=True,
                          context='familia: vinculada por la familia')
        except FamilyError as exc:
            return _bad(str(exc), 'refused')
        return Response({'linked': child.user.full_name, 'children': _children(user)})
