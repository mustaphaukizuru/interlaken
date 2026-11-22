"""Phase 9 (email): borderless blocks, the purple bulletproof button, the
90-character preview, Outlook-safe line breaks, the notice-only blocks, the
D13 subjects and the render_emails preview command.

Fake data only; nothing here sends a real email (locmem backend).
"""
import re
from datetime import timedelta
from decimal import Decimal

import pytest
from django.core import mail
from django.core.management import CommandError, call_command
from django.utils import timezone

from apps.accounts.factories import ParentFactory, StudentProfileFactory, StudentUserFactory
from apps.portal.emailing import (
    PREHEADER_MAX,
    EmailContent,
    clip,
    logo_url,
    name_initial,
    notification_content,
    person_initial,
    render_html,
    render_text,
)

pytestmark = pytest.mark.django_db

NOTICE_MARKERS = ('<!-- notice:', 'class="notice-')
FAKE_NAMES = ('Carla', 'Ramos', 'Ana', 'Pérez', 'Leo', 'Marta', 'Laura', 'Sofía', 'Roberto')


def _rich(**kw):
    """An email that carries every notice-only block."""
    base = dict(title='Festival de invierno', intro='Primera línea.\nSegunda línea.',
                hero_image_url='https://interlaken.edu.mx/assets/hero.png', hero_image_alt='Festival',
                stats=[('Fecha', '12 dic'), ('Hora', '9:00')],
                cards=[{'title': 'Qué traer', 'text': 'Ropa abrigadora', 'link': 'https://interlaken.edu.mx/x'}],
                cta_label='Ver comunicado', cta_url='https://interlaken.edu.mx/portal')
    base.update(kw)
    return EmailContent(**base)


class TestLayout:
    def test_blocks_are_borderless_and_rounded(self):
        html = render_html('x', _rich(details=[('Alumno', 'Carla R.')], note='Nota.'))
        assert 'border:1px' not in html and 'border-left' not in html and 'border-top' not in html
        assert 'border-radius:16px' not in html and 'border-radius:12px' in html
        assert 'background-color:#F5F4FA' in html  # cream page and tinted blocks

    def test_the_button_is_purple_bulletproof_and_tall_enough_for_outlook(self):
        html = render_html('x', _rich())
        cell = re.search(r'<td class="btn-td"[^>]*>', html).group(0)
        assert 'bgcolor="#401A8E"' in cell and 'border-radius:8px' in cell
        # Outlook desktop: 14 + 20 (line-height) + 14 = 48px of cell padding.
        assert 'mso-padding-alt:14px 28px' in cell
        link = re.search(r'<a class="btn-a"[^>]*>', html).group(0)
        assert 'padding:14px 28px' in link and 'line-height:20px' in link and 'mso-padding-alt:0' in link
        assert '#316F1C' not in html  # the old green button

    def test_line_breaks_survive_outlook(self):
        html = render_html('x', _rich())
        assert 'white-space:pre-line' not in html
        assert 'Primera línea.<br>Segunda línea.' in html

    def test_light_only_with_safe_forced_dark_overrides(self):
        html = render_html('x', _rich())
        assert '<meta name="color-scheme" content="light">' in html
        assert '[data-ogsb] .btn-td' in html and '[data-ogsc] .btn-a' in html
        assert 'prefers-color-scheme: dark' not in html  # no half-dark theme in Apple Mail

    def test_the_logo_has_alt_text_and_an_absolute_url(self, settings):
        settings.FRONTEND_URL = ''
        assert logo_url() == 'https://interlaken.edu.mx/assets/email/logo.png'
        html = render_html('x', _rich())
        assert 'alt="Colegio Interlaken"' in html and 'src="https://interlaken.edu.mx/assets/email/logo.png"' in html


class TestPreheader:
    def test_capped_at_90_characters_on_a_word_boundary(self):
        intro = 'El saldo de cafetería de Carla quedó por debajo del mínimo. Le recomendamos recargar para evitar contratiempos.'
        text = EmailContent(title='t', intro=intro).preheader_text()
        assert len(text) <= PREHEADER_MAX and text.endswith('…')
        assert intro.startswith(text[:-1]) and text[-2] != ' '
        assert not text[:-1].endswith(('recar', 'contratiem'))  # whole words only

    def test_short_text_and_explicit_preheader_are_kept(self):
        assert EmailContent(title='t', intro='Hola.').preheader_text() == 'Hola.'
        assert EmailContent(title='t', intro='x' * 200, preheader='Vista previa').preheader_text() == 'Vista previa'
        assert clip('uno dos\ntres', 90) == 'uno dos tres'

    def test_the_hidden_line_carries_the_capped_text(self):
        html = render_html('x', EmailContent(title='t', intro='palabra ' * 40))
        hidden = html[html.index('display:none'):html.index('</div>', html.index('display:none'))]
        assert 'palabra palabra' in hidden and len(re.sub(r'<[^>]+>|&#\d+;', '', hidden.split('>', 1)[1])) <= PREHEADER_MAX


class TestFamilies:
    def test_a_transactional_email_never_renders_notice_blocks(self):
        content = _rich()  # family defaults to «transactional»
        html, text = render_html('x', content), render_text(content)
        for marker in NOTICE_MARKERS:
            assert marker not in html
        assert 'hero.png' not in html and 'Qué traer' not in html and '12 dic' not in html
        assert 'Qué traer' not in text and '12 dic' not in text and '[Imagen' not in text

    def test_a_notice_renders_them_capped(self):
        cards = [{'title': f'Tarjeta {i}', 'text': 'x'} for i in range(5)]
        content = _rich(family='notice', cards=cards, stats=[('a', '1'), ('b', '2'), ('c', '3'), ('d', '4')])
        html, text = render_html('x', content), render_text(content)
        assert '<!-- notice:hero -->' in html and 'alt="Festival"' in html
        assert html.count('class="notice-card"') == 3 and 'Tarjeta 3' not in html
        assert '<!-- notice:stats -->' in html and 'width="33%"' in html and '>4<' not in html
        assert 'Tarjeta 0' in text and 'Fecha: 12 dic' not in text and 'a: 1' in text

    def test_comunicados_are_notices_and_emergencies_are_urgent_transactional(self):
        parent = ParentFactory()
        comunicado = notification_content(user=parent, notif_type='info', title='Festival', message='x',
                                          comunicado=True)
        assert comunicado.family == 'notice' and comunicado.category == 'Comunicado'
        emergency = notification_content(user=parent, notif_type='warning', title='Suspensión', message='x',
                                         comunicado=True, url='/portal/notificaciones/9')
        assert emergency.category == 'Aviso importante' and emergency.tone == 'warning'
        assert emergency.family == 'transactional' and emergency.cta_label == 'Ver aviso'
        html = render_html('Suspensión', emergency)
        assert 'Aviso importante' in html and '>Comunicado<' not in html

    def test_an_emergency_broadcast_email_says_aviso_importante(self, settings):
        from apps.portal.services import emergency_broadcast

        settings.FRONTEND_URL = 'https://interlaken.edu.mx'
        ParentFactory(email='familia@test.mx')
        mail.outbox.clear()
        emergency_broadcast(title='Suspensión de clases', message='Hoy no hay clases.', audience='parents')
        m = next(m for m in mail.outbox if 'familia@test.mx' in m.to)
        assert 'AVISO IMPORTANTE' in m.body and 'COMUNICADO' not in m.body
        assert 'Aviso importante' in m.alternatives[0][0]


class TestNames:
    def test_first_name_and_first_surname_initial(self):
        assert name_initial('Ana María', 'Pérez Gil') == 'Ana P.'
        assert name_initial('Leo', '') == 'Leo' and name_initial('', 'Ramos Terrazas') == 'Ramos T.'
        user = StudentUserFactory.build(first_name='Carla', last_name='Ramos Terrazas')
        assert person_initial(user) == 'Carla R.' and person_initial(None) == ''

    def test_a_purchase_email_names_the_child_by_first_name_and_initial(self):
        from apps.cafeteria.models import CafeteriaTransaction
        from apps.cafeteria.services import _notify_purchase

        parent = ParentFactory(email='mama@test.mx')
        student = StudentProfileFactory(user=StudentUserFactory(first_name='Carla', last_name='Ramos Terrazas'),
                                        parents=[parent])
        tx = CafeteriaTransaction.objects.create(student=student, transaction_type='purchase',
                                                 amount=Decimal('45.00'), description='Torta',
                                                 balance_after=Decimal('100.00'), loyverse_receipt_id='p9-1')
        mail.outbox.clear()
        _notify_purchase(tx)
        m = next(m for m in mail.outbox if 'mama@test.mx' in m.to)
        assert 'Alumno: Carla R.' in m.body and 'Ramos Terrazas' not in m.body
        assert 'Ramos Terrazas' not in m.alternatives[0][0]
        # D13: the amount and the balance stay in the body, never in the subject.
        assert '$45.00' in m.body and 'Saldo actual: $100.00' in m.body
        assert '$' not in m.subject and 'Carla' not in m.subject


class TestSubjects:
    def test_family_link_code_subject_carries_no_name_and_no_code(self):
        from apps.accounts.family_self import _code_email

        child = StudentProfileFactory(user=StudentUserFactory(first_name='Olivia', last_name='Prueba Uno'))
        subject, content = _code_email(child, ParentFactory(email='mama@test.mx'), '482915')
        assert subject == 'Su código para vincular a sus hijos'
        assert 'Olivia' not in subject and '482' not in subject
        assert content.highlight == ('Código', '482 915')  # the code stays in the body
        assert '482' not in content.preheader_text()  # nor in the inbox preview
        assert 'Prueba Uno' not in render_text(content)

    def test_notify_email_confirmation_subject_carries_no_name(self):
        from apps.accounts.notify_email import confirmation_email, make_token

        user = StudentUserFactory(first_name='Carla', last_name='Ramos', notify_email='papa@test.mx')
        subject, _content = confirmation_email(user, make_token(user))
        assert subject == 'Confirme su correo para recibir avisos'

    def test_the_invitation_shows_the_real_expiry_date(self, settings):
        from apps.admissions.models import Registration
        from apps.admissions.services import email_invite
        from apps.portal.emailing import long_date

        settings.FRONTEND_URL = 'https://interlaken.edu.mx'
        expires = timezone.now() + timedelta(days=3)
        reg = Registration(child_first_name='Ana', child_last_name='Pérez', parent1_name='Marta',
                           parent1_email='marta@test.mx', grade_applying='2', cycle='2027-2028',
                           invite_expires_at=expires)
        mail.outbox.clear()
        assert email_invite(reg, 'https://interlaken.edu.mx/pre-registro?rid=1&token=x')
        m = mail.outbox[-1]
        assert m.subject == 'Invitación de inscripción'
        assert f'El enlace vence: {long_date(expires)}' in m.body
        assert long_date(timezone.now() + timedelta(days=14)) not in m.body


class TestRenderEmails:
    def test_every_sample_renders_small_complete_and_d13_clean(self):
        from apps.portal.management.commands.render_emails import (
            MAX_HTML_BYTES,
            MAX_SUBJECT,
            build_samples,
        )

        mail.outbox.clear()
        samples = build_samples()
        assert not mail.outbox  # nothing was sent
        groups = {s.group for s in samples}
        assert {'Notificaciones', 'Comunicados', 'Admisiones', 'Visitas', 'Cuenta'} <= groups
        assert len({s.slug for s in samples}) == len(samples)
        for s in samples:
            html, text = s.html(), s.text()
            assert html and len(html.encode('utf-8')) < MAX_HTML_BYTES, s.slug
            assert text.strip() and s.content.title in text, s.slug
            if s.checked_subject:
                assert len(s.subject) <= MAX_SUBJECT, (s.slug, s.subject)
                assert not any(name in s.subject for name in FAKE_NAMES), (s.slug, s.subject)
                assert '$' not in s.subject and not re.search(r'\d{3} ?\d{3}', s.subject), s.slug
            if s.content.family == 'transactional':
                for marker in NOTICE_MARKERS:
                    assert marker not in html, (s.slug, marker)
        by_slug = {s.slug: s for s in samples}
        assert '<!-- notice:cards -->' in by_slug['comunicado-con-bloques'].html()
        assert 'Aviso importante' in by_slug['aviso-urgente'].html()

    def test_the_command_writes_html_and_text_files(self, tmp_path, settings):
        settings.DEBUG = True
        mail.outbox.clear()
        call_command('render_emails', '--out', str(tmp_path))
        assert not mail.outbox
        assert (tmp_path / 'index.html').exists()
        html = (tmp_path / 'cafeteria-compra.html').read_text(encoding='utf-8')
        text = (tmp_path / 'cafeteria-compra.txt').read_text(encoding='utf-8')
        assert html.startswith('<!doctype html>') and text.startswith('Asunto: Compra en cafetería')
        assert len(list(tmp_path.glob('*.html'))) > 20

    def test_the_command_refuses_without_debug(self, tmp_path, settings):
        settings.DEBUG = False
        with pytest.raises(CommandError, match='DEBUG'):
            call_command('render_emails', '--out', str(tmp_path))
        assert not list(tmp_path.iterdir())
        call_command('render_emails', '--out', str(tmp_path), '--force')
        assert (tmp_path / 'index.html').exists()
