"""
whatsapp/tests.py — webhook handshake, signature enforcement, and Tier 2 booking.

Outbound Cloud API sends are patched out (creds are unset in tests anyway, so
``services._post`` is already a no-op), leaving the focus on: the GET handshake
echoes the challenge, an unsigned POST is rejected, and a signed POST whose
payload taps a slot creates a ``Booking(source=whatsapp)``.
"""
import hashlib
import hmac
import json
from datetime import timedelta
from unittest import mock

from django.test import override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.bookings.models import AvailabilitySlot, Booking

APP_SECRET = 'test-app-secret'
VERIFY_TOKEN = 'test-verify-token'


def _sign(body: bytes) -> str:
    return 'sha256=' + hmac.new(APP_SECRET.encode(), body, hashlib.sha256).hexdigest()


def _message_payload(sender, reply_id):
    """A Cloud API webhook body for an interactive list reply tapping a slot."""
    return {
        'object': 'whatsapp_business_account',
        'entry': [{
            'changes': [{
                'value': {
                    'messaging_product': 'whatsapp',
                    'contacts': [{'profile': {'name': 'Ana López'}, 'wa_id': sender}],
                    'messages': [{
                        'from': sender,
                        'type': 'interactive',
                        'interactive': {
                            'type': 'list_reply',
                            'list_reply': {'id': reply_id, 'title': 'Visita'},
                        },
                    }],
                },
                'field': 'messages',
            }],
        }],
    }


@override_settings(WHATSAPP_APP_SECRET=APP_SECRET, WHATSAPP_VERIFY_TOKEN=VERIFY_TOKEN)
class WhatsAppWebhookTests(APITestCase):
    def setUp(self):
        self.url = reverse('whatsapp-webhook')
        self.slot = AvailabilitySlot.objects.create(
            visit_type='open_class',
            date=timezone.now().date() + timedelta(days=4),
            start_time='10:00', end_time='11:00', capacity=20, location='Campus',
        )

    # ── GET handshake ─────────────────────────────────────────────────────────
    def test_verify_handshake_echoes_challenge(self):
        r = self.client.get(self.url, {
            'hub.mode': 'subscribe',
            'hub.verify_token': VERIFY_TOKEN,
            'hub.challenge': '31415',
        })
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.content.decode(), '31415')

    def test_verify_handshake_rejects_bad_token(self):
        r = self.client.get(self.url, {
            'hub.mode': 'subscribe',
            'hub.verify_token': 'wrong',
            'hub.challenge': '31415',
        })
        self.assertEqual(r.status_code, 403)

    # ── POST signature enforcement ────────────────────────────────────────────
    def test_unsigned_post_is_rejected(self):
        body = json.dumps(_message_payload('5215500000000', 'book_slot:1'))
        r = self.client.post(self.url, data=body, content_type='application/json')
        self.assertEqual(r.status_code, 403)

    def test_tampered_signature_is_rejected(self):
        body = json.dumps(_message_payload('5215500000000', 'book_slot:1')).encode()
        r = self.client.post(
            self.url, data=body, content_type='application/json',
            HTTP_X_HUB_SIGNATURE_256='sha256=deadbeef',
        )
        self.assertEqual(r.status_code, 403)

    # ── POST booking flow ─────────────────────────────────────────────────────
    @mock.patch('apps.whatsapp.services.send_text')
    def test_signed_post_books_slot_and_replies(self, mock_send_text):
        sender = '5215512345678'
        body = json.dumps(_message_payload(sender, f'book_slot:{self.slot.id}')).encode()
        r = self.client.post(
            self.url, data=body, content_type='application/json',
            HTTP_X_HUB_SIGNATURE_256=_sign(body),
        )
        self.assertEqual(r.status_code, 200, r.content)

        booking = Booking.objects.get(slot=self.slot)
        self.assertEqual(booking.source, Booking.Source.WHATSAPP)
        self.assertEqual(booking.parent_phone, sender)
        self.assertEqual(booking.parent_name, 'Ana López')
        self.assertEqual(booking.status, Booking.Status.CONFIRMED)
        # A confirmation reply was sent in-channel.
        self.assertTrue(mock_send_text.called)

    @mock.patch('apps.whatsapp.services.send_slot_list')
    def test_text_message_offers_slots(self, mock_send_list):
        sender = '5215512345678'
        payload = {
            'object': 'whatsapp_business_account',
            'entry': [{'changes': [{'value': {
                'contacts': [{'profile': {'name': 'Ana'}, 'wa_id': sender}],
                'messages': [{'from': sender, 'type': 'text', 'text': {'body': 'hola'}}],
            }}]}],
        }
        body = json.dumps(payload).encode()
        r = self.client.post(
            self.url, data=body, content_type='application/json',
            HTTP_X_HUB_SIGNATURE_256=_sign(body),
        )
        self.assertEqual(r.status_code, 200)
        self.assertTrue(mock_send_list.called)

    def test_status_callback_is_ignored(self):
        # Delivery/read receipts carry no 'messages' — must not error.
        payload = {'entry': [{'changes': [{'value': {'statuses': [{'status': 'read'}]}}]}]}
        body = json.dumps(payload).encode()
        r = self.client.post(
            self.url, data=body, content_type='application/json',
            HTTP_X_HUB_SIGNATURE_256=_sign(body),
        )
        self.assertEqual(r.status_code, 200)
        self.assertFalse(Booking.objects.exists())
