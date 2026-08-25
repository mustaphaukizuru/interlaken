"""
core/flags.py — parsing of human-entered booleans.

The Loyverse import/link admin flows each carried their own identical copy of
this, so widening the accepted vocabulary only ever fixed one of them.
"""


def truthy(value) -> bool:
    """True for the affirmative tokens an admin form or query string can send."""
    return str(value).lower() in ('1', 'true', 'si', 'sí', 'on', 'yes')
