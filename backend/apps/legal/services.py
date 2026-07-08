"""
legal/services.py — capture and resolve consent.

`record_consent` appends an immutable ConsentRecord (always tied to the current
privacy-notice version). `has_consent` / `consent_state` resolve the current
state as "the latest record wins" per purpose.
"""
from .models import ConsentPurpose, ConsentRecord, PrivacyNoticeVersion


def record_consent(*, guardian, purpose, granted, student=None,
                   notice_version=None, context='', ip=None):
    """Append a consent (or revocation) record. Revocation = a new record."""
    notice = notice_version or PrivacyNoticeVersion.current()
    if notice is None:
        raise ValueError('No hay un Aviso de Privacidad vigente para registrar consentimiento.')
    return ConsentRecord.objects.create(
        guardian=guardian,
        student=student,
        notice_version=notice,
        purpose=purpose,
        granted=granted,
        capture_context=context,
        capture_ip=ip,
    )


def has_consent(guardian, purpose, student=None) -> bool:
    """True if the most recent record for this (guardian, purpose[, student]) grants it."""
    qs = ConsentRecord.objects.filter(guardian=guardian, purpose=purpose)
    qs = qs.filter(student=student) if student is not None else qs.filter(student__isnull=True)
    latest = qs.order_by('-captured_at').first()
    return bool(latest and latest.granted)


def consent_state(guardian, student=None) -> dict:
    """Map each purpose → current granted state for the guardian (optionally per student)."""
    return {p.value: has_consent(guardian, p.value, student) for p in ConsentPurpose}


def needs_acceptance(guardian) -> bool:
    """True if the guardian has not accepted the CURRENT notice's core processing.

    Covers both a brand-new account (no records) and a material notice-version
    change (their latest acceptance was under an older version).
    """
    notice = PrivacyNoticeVersion.current()
    if notice is None:
        return False
    latest = (ConsentRecord.objects
              .filter(guardian=guardian,
                      purpose=ConsentPurpose.ACADEMIC_PROCESSING,
                      student__isnull=True)
              .order_by('-captured_at')
              .first())
    return not (latest and latest.granted and latest.notice_version_id == notice.id)


def photo_media_allowed(student) -> bool:
    """Queryable flag for the gallery/CMS: any guardian granted PHOTOS_MEDIA for this student."""
    return any(
        has_consent(guardian, ConsentPurpose.PHOTOS_MEDIA, student)
        for guardian in student.parents.all()
    )


def export_household_data(user) -> dict:
    """Serialize everything held on the requesting household (ARCO Acceso).

    Only the requester's own data and their children's data is included; internal
    secrets (token/session hashes, raw gateway payloads) are deliberately excluded.
    Their children's medical data IS included — the guardian is entitled to it.
    """
    from apps.bookings.models import Booking
    from apps.cafeteria.models import CafeteriaBalance, CafeteriaTransaction
    from apps.finance.models import Invoice
    from apps.payments.models import Payment

    from .models import ArcoRequest

    def _iso(v):
        return v.isoformat() if hasattr(v, 'isoformat') else v

    children = list(user.children.all()) if hasattr(user, 'children') else []

    data = {
        'account': {
            'email': user.email, 'first_name': user.first_name, 'last_name': user.last_name,
            'role': user.role, 'whatsapp': user.whatsapp,
            'date_joined': _iso(user.date_joined),
        },
        'children': [],
        'consents': [
            {'purpose': c.purpose, 'granted': c.granted, 'student_id': c.student_id,
             'notice_version': c.notice_version.version if c.notice_version_id else None,
             'captured_at': _iso(c.captured_at)}
            for c in user.consent_records.select_related('notice_version').all()
        ],
        'payments': [
            {'type': p.payment_type, 'amount': str(p.amount), 'currency': p.currency,
             'status': p.status, 'created_at': _iso(p.created_at)}
            for p in Payment.objects.filter(user=user)
        ],
        'bookings': [
            {'child_name': b.child_name, 'status': b.status, 'created_at': _iso(b.created_at)}
            for b in Booking.objects.filter(parent_email__iexact=user.email)
        ],
        'arco_requests': [
            {'type': a.request_type, 'status': a.status, 'created_at': _iso(a.created_at),
             'statutory_deadline': _iso(a.statutory_deadline)}
            for a in ArcoRequest.objects.filter(requester=user)
        ],
    }

    for child in children:
        balance = CafeteriaBalance.objects.filter(student=child).first()
        data['children'].append({
            'student_id': child.student_id, 'grade': child.grade, 'group': child.group,
            'is_active': child.is_active,
            'cafeteria_balance': str(balance.balance) if balance else None,
            'cafeteria_transactions': [
                {'type': t.transaction_type, 'amount': str(t.amount),
                 'date': _iso(t.date), 'description': t.description}
                for t in CafeteriaTransaction.objects.filter(student=child)
            ],
            'invoices': [
                {'period': i.period, 'amount': str(i.amount), 'status': i.status}
                for i in Invoice.objects.filter(student=child)
            ],
        })

    return data
