"""
core/phones.py: one rule for the phone and WhatsApp numbers people type.

A number may hold digits plus the usual ``+``, spaces, dashes and parentheses,
and has 10 to 15 digits: 10 for a Mexican number, 12 or 13 with the country
code («52 1 55…»), at most 15 (the international maximum). Letters used to
reach the database («55 1234 abcd»), and the WhatsApp sender then failed.

The value is kept as typed (only trimmed): the dialers and the WhatsApp sender
already read the digits out of it. The frontend mirror is
``frontend/src/lib/validators.ts`` (``phoneProblem``).

Records saved before this rule may hold other values. ``check_phone(value,
current=…)`` accepts the value the record already has, so a stored legacy
number never blocks saving another field of the same form.
"""

from __future__ import annotations

import re

from rest_framework import serializers

PHONE_MIN_DIGITS = 10
PHONE_MAX_DIGITS = 15
_ALLOWED = re.compile(r"^[0-9+\s()\-]+$")

MSG_PHONE_CHARS = "Escriba solo números; puede usar espacios, guiones, paréntesis y el signo +."
MSG_PHONE_LENGTH = f"El número debe tener de {PHONE_MIN_DIGITS} a {PHONE_MAX_DIGITS} dígitos."


def phone_digits(value) -> str:
    return re.sub(r"\D", "", str(value or ""))


def phone_problem(value) -> str | None:
    """The es-MX message for a typed number, or None when it is fine (blank too:
    whether the field is required is the caller's rule)."""
    text = str(value or "").strip()
    if not text:
        return None
    if not _ALLOWED.match(text):
        return MSG_PHONE_CHARS
    if not PHONE_MIN_DIGITS <= len(phone_digits(text)) <= PHONE_MAX_DIGITS:
        return MSG_PHONE_LENGTH
    return None


def check_phone(value, *, current=None) -> str:
    """The trimmed number, or ``serializers.ValidationError``.

    ``current`` is what the record already holds: sending it back unchanged
    (a form that posts every field) is always accepted.
    """
    text = str(value or "").strip()
    if current is not None and text == str(current or "").strip():
        return text
    problem = phone_problem(text)
    if problem:
        raise serializers.ValidationError(problem)
    return text
