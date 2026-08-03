"""
core/dashboard.py — KPI context for the unfold admin index (IK-ADMIN item 4).

Numbers + deep links only. Charts intentionally do NOT live here — the
operational analytics dashboard is the staff app view (/staff).
"""
from django.urls import reverse
from django.utils import formats, timezone


def dashboard_callback(request, context):
    # Imports at call time so settings can reference this module dotted-path
    # without import-order issues at boot.
    from apps.admissions.models import PreRegistration, Registration, RegistrationDocument
    from apps.core.models import AuditLog
    from apps.legal.models import ArcoRequest
    from apps.payments.models import Payment

    today = timezone.localdate()

    pending_prereg = PreRegistration.objects.filter(
        status=PreRegistration.Status.PENDING).count()
    regs_in_review = Registration.objects.filter(
        status__in=[Registration.Status.SUBMITTED, Registration.Status.REVIEWING]).count()
    docs_in_review = RegistrationDocument.objects.filter(is_verified=False).count()
    payments_today = Payment.objects.filter(
        status=Payment.Status.SUCCESS, completed_at__date=today).count()
    arco_open = ArcoRequest.objects.filter(
        status__in=[ArcoRequest.Status.RECEIVED, ArcoRequest.Status.IN_REVIEW]).count()

    kpis = [
        {
            'title': 'Pre-registros pendientes',
            'value': pending_prereg,
            'icon': 'how_to_reg',
            'link': reverse('admin:admissions_preregistration_changelist')
                    + '?status__exact=pending',
        },
        {
            'title': 'Inscripciones por revisar',
            'value': regs_in_review,
            'icon': 'assignment_turned_in',
            'link': reverse('admin:admissions_registration_changelist')
                    + '?status__in=submitted,reviewing',
        },
        {
            'title': 'Documentos en revisión',
            'value': docs_in_review,
            'icon': 'folder_open',
            'link': reverse('admin:admissions_registrationdocument_changelist')
                    + '?is_verified__exact=0',
        },
        {
            'title': 'Pagos exitosos hoy',
            'value': payments_today,
            'icon': 'payments',
            'link': reverse('admin:payments_payment_changelist')
                    + '?status__exact=success',
        },
        {
            'title': 'Solicitudes ARCO abiertas',
            'value': arco_open,
            'icon': 'gavel',
            'link': reverse('admin:legal_arcorequest_changelist')
                    + '?status__in=received,in_review',
        },
    ]

    # Recent audit events — actor_label is a snapshot, so no join is needed.
    audit_rows = [
        [
            formats.date_format(timezone.localtime(entry.created_at),
                                'SHORT_DATETIME_FORMAT'),
            entry.get_action_display(),
            entry.object_type,
            entry.object_id,
            entry.actor_label,
            entry.context,
        ]
        for entry in AuditLog.objects.only(
            'created_at', 'action', 'object_type', 'object_id',
            'actor_label', 'context')[:8]
    ]

    context.update({
        'kpis': kpis,
        'audit_table': {
            'headers': ['Fecha', 'Acción', 'Objeto', 'ID', 'Actor', 'Contexto'],
            'rows': audit_rows,
        },
        'audit_link': reverse('admin:core_auditlog_changelist'),
    })
    return context
