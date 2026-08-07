"""
core/badges.py — pending-count badges for the unfold admin sidebar.

Each callback is referenced by dotted path from UNFOLD['SIDEBAR']['navigation']
and evaluated lazily per request. They return the live queue depth for the
work-list changelists, so staff see where attention is needed before clicking.
"""


def pending_preregistrations(request):
    from apps.admissions.models import PreRegistration
    return PreRegistration.objects.filter(
        status=PreRegistration.Status.PENDING).count()


def documents_in_review(request):
    from apps.admissions.models import RegistrationDocument
    return RegistrationDocument.objects.filter(is_verified=False).count()


def open_arco_requests(request):
    from apps.legal.models import ArcoRequest
    return ArcoRequest.objects.filter(status__in=[
        ArcoRequest.Status.RECEIVED, ArcoRequest.Status.IN_REVIEW]).count()


def unhandled_contact_messages(request):
    from apps.core.models import ContactMessage
    return ContactMessage.objects.filter(is_handled=False).count()
