"""
payments/billing.py — the cardholder data Banorte (Cybersource) requires.

Banorte's Payworks 2.0 runs every card payment through Cybersource fraud
screening, and manual v1.8 marks these ``billTo*`` variables as required for
every transaction. Until 2026-10-20 the app sent none of them, and Banorte
reported "Estado" (``billToState``) arriving null during certification.

- ``CardholderSerializer`` validates what the family types in the top-up wizard:
  lengths from the manual, the state as one of Banorte's 32 two-letter codes,
  a 5-digit postal code, a 10-to-15-digit phone, an email.
- ``billto_params`` maps it to the Payworks variable names, folding every value
  to Banorte's allowed characters (no accents, no ``# , ( ) / : ;`` ...) and
  adding the payer's IP (``billToIpAddress``, required since manual v1.6). An
  optional value left empty is simply not sent: the manual forbids blank
  variables.
- ``BillingProfile`` keeps the last data a family used, encrypted at rest, so
  the next top-up is pre-filled. It is never shown to staff.
"""
from __future__ import annotations

import json
import re

from django.db import models
from django.utils import timezone
from rest_framework import serializers

from apps.core.fields import EncryptedTextField

from .gateways.banorte_crypto import clean_text

# Banorte's official two-letter state codes (sent to the school 2026-10-20).
STATES: dict[str, str] = {
    'AG': 'Aguascalientes', 'BC': 'Baja California', 'BS': 'Baja California Sur',
    'CM': 'Campeche', 'CS': 'Chiapas', 'CH': 'Chihuahua', 'CO': 'Coahuila',
    'CL': 'Colima', 'DF': 'Ciudad de México', 'DG': 'Durango', 'EM': 'Estado de México',
    'GT': 'Guanajuato', 'GR': 'Guerrero', 'HG': 'Hidalgo', 'JA': 'Jalisco',
    'MI': 'Michoacán', 'MO': 'Morelos', 'NA': 'Nayarit', 'NL': 'Nuevo León',
    'OA': 'Oaxaca', 'PU': 'Puebla', 'QT': 'Querétaro', 'QR': 'Quintana Roo',
    'SL': 'San Luis Potosí', 'SI': 'Sinaloa', 'SO': 'Sonora', 'TB': 'Tabasco',
    'TM': 'Tamaulipas', 'TL': 'Tlaxcala', 'VC': 'Veracruz', 'YC': 'Yucatán',
    'ZA': 'Zacatecas',
}

# field → (Payworks variable, max length per manual v1.8, required)
FIELDS: dict[str, tuple[str, int, bool]] = {
    'first_name': ('billToFirstName', 60, True),
    'last_name': ('billToLastName', 60, True),
    'street': ('billToStreet', 40, True),
    'street_number': ('billToStreetNumber', 6, True),
    'street_number_2': ('billToStreetNumbe2', 10, False),   # sic, Banorte's spelling
    'colonia': ('billToStreet2Col', 30, True),
    'municipio': ('billToStreet2Del', 30, True),
    'city': ('billToCity', 50, True),
    'state': ('billToState', 2, True),
    'postal_code': ('billToPostalCode', 10, True),
    'phone': ('billToPhoneNumber', 15, True),
    'email': ('billToEmail', 100, True),
}


def _digits(value) -> str:
    return re.sub(r'\D', '', str(value or ''))


class CardholderSerializer(serializers.Serializer):
    """The card owner's data as the family types it (Spanish errors)."""

    first_name = serializers.CharField(max_length=60)
    last_name = serializers.CharField(max_length=60)
    street = serializers.CharField(max_length=40)
    street_number = serializers.CharField(max_length=6)
    street_number_2 = serializers.CharField(max_length=10, required=False, allow_blank=True, default='')
    colonia = serializers.CharField(max_length=30)
    municipio = serializers.CharField(max_length=30)
    city = serializers.CharField(max_length=50)
    state = serializers.CharField(max_length=2)
    postal_code = serializers.CharField(max_length=10)
    phone = serializers.CharField(max_length=20)
    email = serializers.EmailField(max_length=100)

    def validate_state(self, value):
        code = str(value or '').strip().upper()
        if code not in STATES:
            raise serializers.ValidationError('Elija el estado de la lista.')
        return code

    def validate_postal_code(self, value):
        digits = _digits(value)
        if len(digits) != 5:
            raise serializers.ValidationError('El código postal tiene 5 dígitos.')
        return digits

    def validate_phone(self, value):
        digits = _digits(value)
        if not 10 <= len(digits) <= 15:
            raise serializers.ValidationError('Escriba un teléfono de 10 dígitos (solo números).')
        return digits

    def validate(self, attrs):
        # A value Banorte would receive empty after folding (only symbols) is
        # as good as missing: say so here instead of a bank error later.
        errors = {}
        for field, (_, max_len, required) in FIELDS.items():
            if field in ('state', 'postal_code', 'phone', 'email'):
                continue
            folded = clean_text(attrs.get(field, ''), max_len)
            if required and not folded:
                errors[field] = ['Escriba este dato con letras o números.']
            attrs[field] = str(attrs.get(field, '') or '').strip()
        if errors:
            raise serializers.ValidationError(errors)
        attrs['email'] = attrs['email'].strip().lower()
        return attrs


def billto_params(data: dict, *, ip: str = '') -> dict:
    """Payworks ``billTo*`` variables from validated cardholder ``data``."""
    out = {'billToCountry': 'MX'}
    for field, (key, max_len, _) in FIELDS.items():
        value = data.get(field, '')
        if field == 'email':
            value = str(value or '').strip()[:max_len]
        elif field in ('state', 'postal_code', 'phone'):
            value = str(value or '').strip()[:max_len]
        else:
            value = clean_text(value, max_len)
        if value:
            out[key] = value
    ip = str(ip or '').strip()
    if ip:
        out['billToIpAddress'] = ip[:45]
    return out


class BillingProfile(models.Model):
    """The cardholder data a family last paid with (pre-fills the next top-up).

    One per user, stored as encrypted JSON: an address and phone are personal
    data that only the family and Banorte need.
    """

    user = models.OneToOneField('accounts.User', on_delete=models.CASCADE,
                                related_name='billing_profile')
    data = EncryptedTextField(blank=True)
    updated_at = models.DateTimeField(default=timezone.now)

    class Meta:
        app_label = 'payments'
        verbose_name = 'Datos del titular de la tarjeta'
        verbose_name_plural = 'Datos de titulares de tarjeta'

    def as_dict(self) -> dict:
        try:
            value = json.loads(self.data or '{}')
        except ValueError:
            return {}
        return value if isinstance(value, dict) else {}

    @classmethod
    def remember(cls, user, data: dict) -> None:
        clean = {k: data.get(k, '') for k in FIELDS}
        cls.objects.update_or_create(
            user=user, defaults={'data': json.dumps(clean, ensure_ascii=False),
                                 'updated_at': timezone.now()})
