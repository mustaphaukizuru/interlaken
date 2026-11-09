"""
accounts/notify_email.py — a family's personal email for notifications.

Owner, 2026-10-20: "Every notification goes to the student's email, but if
parents want to receive it on their personal email, is it possible?" Family
logins are usually the student's school address (``ci09938@interlaken.com.mx``),
so a parent may add one personal address. It receives every email the account
receives, **once confirmed**: the address gets a signed link (valid 3 days)
and only a confirmed address is ever mailed, so nobody can route a family's
notifications to a mailbox they do not own.

Owner, 2026-11-08: the link must work **without signing in**. A parent opens
it on their own phone, where they are signed out or signed into another
account (their own Padre/Tutor login): the signed token alone proves they own
the mailbox, and it names the account it belongs to. The link opens a public
page that shows what is being confirmed and asks for one click (POST), so an
email scanner that pre-opens links cannot confirm by itself. Adding the
address never creates an account and never gives access to the portal.

    GET    /accounts/me/notify-email/             {email, verified}
    PUT    /accounts/me/notify-email/             {email} → sends the link
    DELETE /accounts/me/notify-email/             stop using it
    GET    /accounts/notify-email/confirm/?token= what the link confirms (public)
    POST   /accounts/notify-email/confirm/        {token} → confirmed (public)
    POST   /accounts/me/notify-email/verify/      {token} (old links; same as confirm)

Allowed although family profiles are locked (bitácora punto 10): it adds a
delivery address and changes nothing the school owns. Audited.
"""
from __future__ import annotations

from datetime import datetime, timedelta
from datetime import timezone as dt_timezone

from django.conf import settings
from django.core import signing
from django.utils import timezone
from django.utils.decorators import method_decorator
from rest_framework import permissions, serializers, status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.audit import record
from apps.core.exceptions import error_body
from apps.core.ratelimit import ratelimit

SALT = 'accounts.notify-email'
MAX_AGE = 3 * 24 * 3600

READY, CONFIRMED, EXPIRED, INVALID, SUPERSEDED = 'ready', 'confirmed', 'expired', 'invalid', 'superseded'


def make_token(user) -> str:
    return signing.dumps({'u': user.pk, 'e': (user.notify_email or '').lower()}, salt=SALT)


def confirm_url(token: str) -> str:
    frontend = (getattr(settings, 'FRONTEND_URL', '') or '').rstrip('/')
    return f'{frontend}/confirmar-correo?token={token}'


def _state(user) -> dict:
    return {'email': user.notify_email or '', 'verified': bool(user.notify_email
                                                                 and user.notify_email_verified_at)}


def mask_email(email: str) -> str:
    """«mustaphaukizuru@gmail.com» → «mu…@gmail.com» (a forwarded link reveals little)."""
    name, _, domain = (email or '').partition('@')
    if not domain:
        return ''
    return f'{name[:2]}…@{domain}'


def account_label(user) -> dict:
    """Who the avisos are about, as a parent recognizes it and with little exposed.

    A student account reads «Carla R.» with grade and group; any other
    account reads by the holder's first name.
    """
    from apps.portal.emailing import first_name_initial

    profile = getattr(user, 'student_profile', None)
    name = first_name_initial(user.full_name) or 'su cuenta'
    if profile is not None:
        grade = (profile.grade or '').strip()
        group = (profile.group or '').strip()
        detail = ' · '.join(x for x in (grade, f'Grupo {group}' if group else '') if x)
        return {'name': name, 'detail': detail, 'is_student': True}
    return {'name': name, 'detail': '', 'is_student': False}


def _issued_at(token: str) -> datetime | None:
    try:
        return datetime.fromtimestamp(signing.b62_decode(token.split(':')[-2]), tz=dt_timezone.utc)
    except Exception:
        return None


def resolve(token: str) -> tuple[str, object | None, dict]:
    """``(state, user, payload)`` for a link, without changing anything.

    The signature is checked first; expiry is computed separately so an
    expired link can still say whose it was (and how to get a new one).
    """
    from .models import User

    try:
        payload = signing.loads(token or '', salt=SALT)
    except signing.BadSignature:
        return INVALID, None, {}
    user = User.objects.filter(pk=payload.get('u'), is_active=True).select_related('student_profile').first()
    if user is None:
        return INVALID, None, {}
    email = (payload.get('e') or '').lower()
    if not email or email != (user.notify_email or '').lower():
        return SUPERSEDED, user, payload
    if user.notify_email_verified_at:
        return CONFIRMED, user, payload
    issued = _issued_at(token)
    if issued is None or timezone.now() - issued > timedelta(seconds=MAX_AGE):
        return EXPIRED, user, payload
    return READY, user, payload


def confirmation_email(user, token: str):
    """The confirmation email: who it is about, what will arrive, one button, no sign-in."""
    from apps.portal.emailing import EmailContent, long_date

    who = account_label(user)
    about = f"{who['name']}" + (f" ({who['detail']})" if who['detail'] else '')
    issued = _issued_at(token) or timezone.now()
    expires = long_date(issued + timedelta(seconds=MAX_AGE), with_time=True)
    whose = f"de {who['name']}" if who['is_student'] else 'de su cuenta'
    content = EmailContent(
        category='Avisos del portal',
        title=f"Confirme este correo para recibir los avisos {whose}",
        intro=(f'Desde el Portal de Familias del Colegio Interlaken se pidió que una copia de los avisos '
               f'{whose} llegue también a este correo. Confírmelo con un clic; no necesita iniciar sesión.'),
        preheader=f'Un clic para recibir aquí los avisos {whose}. El enlace vence en 3 días.',
        details=[
            ('Alumno' if who['is_student'] else 'Cuenta', about),
            ('Avisos que recibirá', 'Compras y recargas de cafetería, saldo bajo y comunicados del colegio'),
            ('El enlace vence', expires),
        ],
        cta_label='Confirmar este correo',
        cta_url=confirm_url(token),
        note=('Esto solo agrega una copia de los avisos: no crea una cuenta ni da acceso al portal. '
              'Si usted no lo pidió, ignore este mensaje; sin su confirmación no recibirá ningún aviso.'),
        reason='Recibe este correo porque esta dirección se escribió en el Portal de Familias del Colegio Interlaken.',
    )
    return f"Confirme su correo para los avisos {whose}", content


class _EmailIn(serializers.Serializer):
    email = serializers.EmailField(max_length=254)


# On the handler, not dispatch(): there DRF has authenticated, so key='user' is this account
# (on dispatch every family shared one bucket: 5 requests an hour for the whole school).
@method_decorator(ratelimit('notify-email', '5/h', key='user', method='PUT'), name='put')
class NotifyEmailView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        return Response(_state(request.user))

    def put(self, request):
        from apps.portal.services import send_email

        from .recipients import is_synthetic_email

        data = _EmailIn(data=request.data)
        data.is_valid(raise_exception=True)
        email = data.validated_data['email'].strip().lower()
        user = request.user
        if email == (user.email or '').lower():
            return Response(error_body('Ese ya es el correo de su cuenta: los avisos ya le llegan ahí.',
                                       code='same_as_account'), status=status.HTTP_400_BAD_REQUEST)
        if is_synthetic_email(email):
            return Response(error_body('Escriba un correo personal.', code='invalid'),
                            status=status.HTTP_400_BAD_REQUEST)
        before = _state(user)
        user.notify_email = email
        user.notify_email_verified_at = None
        user.save(update_fields=['notify_email', 'notify_email_verified_at'])
        record('update', user, {'notify_email': [before['email'], email], 'verified': False},
               actor=user, context='accounts.notify_email')
        token = make_token(user)
        subject, content = confirmation_email(user, token)
        sent = send_email(subject=subject, message='', recipients=[email], content=content)
        return Response({**_state(user), 'sent': bool(sent)})

    def delete(self, request):
        user = request.user
        if user.notify_email:
            record('update', user, {'notify_email': [user.notify_email, '']},
                   actor=user, context='accounts.notify_email')
            user.notify_email = ''
            user.notify_email_verified_at = None
            user.save(update_fields=['notify_email', 'notify_email_verified_at'])
        return Response(_state(user))


MESSAGES = {
    EXPIRED: 'El enlace venció. Pida uno nuevo desde el portal: Mi perfil → Notificaciones → Reenviar enlace.',
    INVALID: 'El enlace no es válido. Ábralo completo desde el correo que recibió.',
    SUPERSEDED: 'Este enlace ya no se usa: después se pidió otro correo para avisos o se quitó.',
}


def _public_view(state: str, user, payload: dict, token: str) -> dict:
    """What the confirmation page may show to whoever holds the link."""
    from .models import User

    body: dict = {'state': state}
    if user is None or state == INVALID:
        return body
    email = (payload.get('e') or '').lower()
    body['account'] = account_label(user)
    body['email'] = mask_email(email)
    if state == READY:
        issued = _issued_at(token)
        body['expires_at'] = (issued + timedelta(seconds=MAX_AGE)).isoformat() if issued else None
    # The mailbox owner learns their own address also has a separate login.
    body['separate_account'] = bool(email) and User.objects.filter(email__iexact=email).exclude(pk=user.pk).exists()
    if state in MESSAGES:
        body['detail'] = MESSAGES[state]
    return body


def _confirm(token: str) -> tuple[int, dict]:
    state, user, payload = resolve(token)
    if state == READY:
        user.notify_email_verified_at = timezone.now()
        user.save(update_fields=['notify_email_verified_at'])
        record('update', user, {'notify_email': user.notify_email, 'verified': True},
               actor_label='enlace de confirmación', context='accounts.notify_email')
        state = CONFIRMED
    if state == CONFIRMED:
        return status.HTTP_200_OK, {**_public_view(CONFIRMED, user, payload, token), **_state(user)}
    return status.HTTP_400_BAD_REQUEST, {**_public_view(state, user, payload, token),
                                         **error_body(MESSAGES[state], code=state)}


@method_decorator(ratelimit('notify-email-confirm-view', '60/h', key='ip', method='GET'), name='dispatch')
@method_decorator(ratelimit('notify-email-confirm', '20/h', key='ip', method='POST'), name='dispatch')
class NotifyEmailConfirmView(APIView):
    """Public: the signed token is the proof; no session needed (or used)."""
    permission_classes = [permissions.AllowAny]
    authentication_classes: list = []

    def get(self, request):
        token = str(request.query_params.get('token') or '')
        state, user, payload = resolve(token)
        return Response(_public_view(state, user, payload, token))

    def post(self, request):
        code, body = _confirm(str(request.data.get('token') or ''))
        return Response(body, status=code)


@method_decorator(ratelimit('notify-email-verify', '20/h', key='ip', method='POST'), name='dispatch')
class NotifyEmailVerifyView(APIView):
    """Links sent before 2026-11-08 post here from the profile page: same as confirm."""
    permission_classes = [permissions.AllowAny]
    authentication_classes: list = []

    def post(self, request):
        code, body = _confirm(str(request.data.get('token') or ''))
        return Response(body, status=code)
