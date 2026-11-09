"""The email design system (owner, 2026-11-08: «make the emails professional»).

Every email is built from one structure and rendered twice, HTML and plain
text, with the same content in the same order. These tests pin the parts a
reader relies on, so no email slides back to an unstructured letter.
"""
import pytest
from django.core import mail

from apps.accounts.factories import ParentFactory, StudentProfileFactory, StudentUserFactory
from apps.portal.emailing import (
    EmailContent,
    content_from_text,
    first_name_initial,
    long_date,
    money,
    notification_content,
    render_html,
    render_text,
)
from apps.portal.services import notify, send_email

pytestmark = pytest.mark.django_db


def _content(**kw):
    base = dict(
        title='Compra en cafetería', intro='Carla hizo una compra de $45.00 en la cafetería.',
        category='Cafetería', highlight=('Saldo actual', '$4,180.00'),
        details=[('Alumno', 'Carla Ramos Terrazas'), ('Compra', '$45.00')],
        items=['Acta de nacimiento'], list_title='Falta recibir',
        cta_label='Ver movimientos', cta_url='https://interlaken.edu.mx/portal/cafeteria',
        note='Nota de seguridad.', reason='Recibe este aviso porque…', manage_prefs=True,
    )
    base.update(kw)
    return EmailContent(**base)


class TestHtml:
    def test_every_part_renders_in_order_and_escaped(self, settings):
        settings.FRONTEND_URL = 'https://interlaken.edu.mx'
        html = render_html('Asunto <b>', _content(intro='A & B <script>'), reply_to='info@interlaken.com.mx')
        order = ['Cafetería', 'Compra en cafetería', 'A &amp; B &lt;script&gt;', 'Saldo actual', '$4,180.00',
                 'Alumno', 'Carla Ramos Terrazas', 'Falta recibir', 'Acta de nacimiento', 'Ver movimientos',
                 '¿El botón no funciona?', 'Nota de seguridad.', 'Recibe este aviso porque',
                 'Cambiar qué avisos recibo']
        body = html[html.index('alt="Colegio Interlaken"'):]  # after the hidden preview line
        positions = [body.index(part) for part in order]
        assert positions == sorted(positions)
        assert '<script>' not in html and 'Asunto &lt;b&gt;' in html
        assert 'https://interlaken.edu.mx/assets/email/logo.png' in html and 'alt="Colegio Interlaken"' in html
        assert 'Si responde a este correo, su mensaje llega a info@interlaken.com.mx.' in html

    def test_preview_line_defaults_to_the_intro(self):
        html = render_html('x', _content(preheader=''))
        hidden = html[html.index('display:none'):html.index('</div>', html.index('display:none'))]
        assert 'Carla hizo una compra' in hidden

    def test_short_portal_links_skip_the_fallback_and_staff_get_no_preferences_link(self):
        html = render_html('x', _content(link_fallback=False, manage_prefs=False))
        assert '¿El botón no funciona?' not in html and 'Cambiar qué avisos recibo' not in html


class TestText:
    def test_the_text_part_says_the_same_things(self):
        text = render_text(_content(), reply_to='info@interlaken.com.mx')
        for part in ('CAFETERÍA', 'Compra en cafetería', 'Saldo actual: $4,180.00', 'Alumno: Carla Ramos Terrazas',
                     'Falta recibir', '- Acta de nacimiento', 'Ver movimientos:',
                     'https://interlaken.edu.mx/portal/cafeteria', 'Nota de seguridad.', 'Colegio Interlaken',
                     'Cambiar qué avisos recibe:'):
            assert part in text, part


class TestSend:
    def test_structured_email_is_multipart_and_both_parts_match(self):
        mail.outbox.clear()
        assert send_email('Compra en cafetería', 'texto plano', ['mama@test.mx'], content=_content())
        m = mail.outbox[-1]
        assert 'Alumno: Carla Ramos Terrazas' in m.body and 'texto plano' not in m.body
        assert 'Carla Ramos Terrazas' in m.alternatives[0][0]

    def test_wording_the_school_edits_keeps_its_text_part(self):
        mail.outbox.clear()
        send_email('Documentos', 'Estimado Juan, falta: CURP', ['p@test.mx'], content=_content(),
                   text_from_content=False)
        assert mail.outbox[-1].body == 'Estimado Juan, falta: CURP'

    def test_plain_text_callers_get_the_same_design(self):
        c = content_from_text('Aviso', 'Primer párrafo.\n\nSegundo párrafo.\n\nColegio Interlaken')
        assert c.intro == 'Primer párrafo.' and c.paragraphs == ['Segundo párrafo.']  # signature dropped
        mail.outbox.clear()
        send_email('Aviso', 'Primer párrafo.\n\nSegundo párrafo.', ['x@test.mx'])
        html = mail.outbox[-1].alternatives[0][0]
        assert 'Primer párrafo.' in html and 'email/logo.png' in html


class TestNotifications:
    def test_family_notice_carries_category_card_button_and_preferences(self):
        parent = ParentFactory(email='papa@test.mx')
        mail.outbox.clear()
        notify(parent, 'cafeteria', 'Compra en cafetería', 'Texto en la app', fanout=False,
               details=[('Alumno', 'Ana')], highlight=('Saldo actual', '$10.00'),
               intro='Ana hizo una compra de $5.00 en la cafetería.')
        m = mail.outbox[-1]
        html = m.alternatives[0][0]
        assert 'Cafetería' in html and 'Ver movimientos' in html and '/portal/cafeteria' in html
        assert 'Cambiar qué avisos recibo' in html and 'Saldo actual' in html
        assert 'Ana hizo una compra' in m.body and 'Texto en la app' not in m.body

    def test_staff_notice_points_to_the_console(self):
        staff = ParentFactory(role='staff')
        c = notification_content(user=staff, notif_type='info', title='Página lista', message='Revise')
        assert c.cta_label == 'Abrir la consola' and c.cta_url.endswith('/admin') and not c.manage_prefs

    def test_comunicado_links_to_its_notification(self):
        parent = ParentFactory()
        c = notification_content(user=parent, notif_type='info', title='Suspensión', message='No hay clases',
                                 comunicado=True, url='/portal/notificaciones/7')
        assert c.category == 'Comunicado' and c.cta_label == 'Ver comunicado' and c.cta_url.endswith('/portal/notificaciones/7')

    def test_a_student_purchase_email_reaches_the_guardian_with_the_card(self):
        from decimal import Decimal

        from apps.cafeteria.models import CafeteriaTransaction
        from apps.cafeteria.services import _notify_purchase

        parent = ParentFactory(email='mama@test.mx')
        student = StudentProfileFactory(user=StudentUserFactory(first_name='Carla', last_name='Ramos'),
                                        parents=[parent])
        tx = CafeteriaTransaction.objects.create(student=student, transaction_type='purchase', amount=Decimal('45.00'),
                                                 description='Torta', balance_after=Decimal('100.00'),
                                                 loyverse_receipt_id='t-1')
        mail.outbox.clear()
        _notify_purchase(tx)
        m = next(m for m in mail.outbox if 'mama@test.mx' in m.to)
        assert 'Carla hizo una compra de $45.00 en la cafetería.' in m.body
        assert 'Saldo actual: $100.00' in m.body and 'Detalle: Torta' in m.body


class TestHelpers:
    def test_formatting(self):
        from datetime import date
        assert money(4180) == '$4,180.00' and money('-5') == '-$5.00'
        assert long_date(date(2026, 11, 11)) == '11 de noviembre de 2026'
        assert first_name_initial('Carla Ramos Terrazas') == 'Carla R.' and first_name_initial('Ana') == 'Ana'
