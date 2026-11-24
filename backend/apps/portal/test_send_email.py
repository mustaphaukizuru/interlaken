"""portal.services.send_email must log failures instead of swallowing silently."""
from unittest.mock import patch

import pytest

from apps.portal.services import send_email

pytestmark = pytest.mark.django_db


class TestSendEmailLogging:
    def test_logs_and_returns_false_on_smtp_error(self, caplog):
        with patch(
            'django.core.mail.EmailMultiAlternatives.send',
            side_effect=OSError('smtp down'),
        ):
            with caplog.at_level('ERROR'):
                ok = send_email('Asunto', 'Cuerpo', ['a@test.mx'])
        assert ok is False
        assert any('Email send failed' in r.message for r in caplog.records)

    def test_empty_recipients_is_noop(self):
        assert send_email('Asunto', 'Cuerpo', []) is False
        assert send_email('Asunto', 'Cuerpo', ['']) is False

    def test_success_returns_true(self):
        with patch('django.core.mail.EmailMultiAlternatives.send', return_value=1) as mocked:
            assert send_email('Asunto', 'Cuerpo', ['a@test.mx']) is True
            mocked.assert_called_once()
            assert mocked.call_args.kwargs['fail_silently'] is False


class TestTransientSmtpRetry:
    """QA 2026-11-24: the school's SMTP server sometimes drops a connection
    («Connection unexpectedly closed: The read operation timed out») and four
    family emails were lost in two weeks. One retry on a fresh connection."""

    def test_a_dropped_connection_is_retried_once_and_delivers(self, caplog):
        import smtplib
        with patch('django.core.mail.EmailMultiAlternatives.send',
                   side_effect=[smtplib.SMTPServerDisconnected('Connection unexpectedly closed'), 1]) as mocked, \
                patch('apps.portal.services.time.sleep') as slept:
            with caplog.at_level('WARNING'):
                assert send_email('Recarga registrada', 'Cuerpo', ['a@test.mx']) is True
        assert mocked.call_count == 2
        slept.assert_called_once()
        assert any('Email send retry' in r.message for r in caplog.records)

    def test_a_timeout_twice_is_logged_as_failed_after_one_retry(self, caplog):
        with patch('django.core.mail.EmailMultiAlternatives.send',
                   side_effect=TimeoutError('The read operation timed out')) as mocked, \
                patch('apps.portal.services.time.sleep'):
            with caplog.at_level('ERROR'):
                assert send_email('Compra en cafetería', 'Cuerpo', ['a@test.mx']) is False
        assert mocked.call_count == 2
        assert any('Email send failed' in r.message for r in caplog.records)

    def test_a_refused_recipient_is_not_retried(self):
        import smtplib
        with patch('django.core.mail.EmailMultiAlternatives.send',
                   side_effect=smtplib.SMTPRecipientsRefused({'a@test.mx': (550, b'no')})) as mocked, \
                patch('apps.portal.services.time.sleep') as slept:
            assert send_email('Asunto', 'Cuerpo', ['a@test.mx']) is False
        assert mocked.call_count == 1
        slept.assert_not_called()
