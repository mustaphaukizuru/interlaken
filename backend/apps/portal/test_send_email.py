"""portal.services.send_email must log failures instead of swallowing silently."""
from unittest.mock import patch

import pytest

from apps.portal.services import send_email

pytestmark = pytest.mark.django_db


class TestSendEmailLogging:
    def test_logs_and_returns_false_on_smtp_error(self, caplog):
        with patch(
            'apps.portal.services.send_mail',
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
        with patch('apps.portal.services.send_mail', return_value=1) as mocked:
            assert send_email('Asunto', 'Cuerpo', ['a@test.mx']) is True
            mocked.assert_called_once()
            assert mocked.call_args.kwargs['fail_silently'] is False
