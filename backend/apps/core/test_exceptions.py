"""
apps.core.exceptions — one error shape: DRF's {detail} / field dicts are kept,
Django ValidationError becomes a 400, stray {'error'} bodies are folded into
{detail} (with the legacy alias while LEGACY_ERROR_KEY is on), and every cap
answers 413 with the es-MX message.
"""

import pytest
from django.core.exceptions import ValidationError as DjangoValidationError
from django.urls import reverse
from rest_framework.exceptions import APIException, NotFound
from rest_framework.exceptions import ValidationError as DRFValidationError
from rest_framework.test import APIRequestFactory
from rest_framework.views import APIView

from apps.core import exceptions
from apps.core.exceptions import PayloadTooLarge, cap_message, error_body, error_response, handler


def _ctx():
    view = APIView()
    view.request = APIRequestFactory().get("/x/")
    return {"view": view, "request": view.request}


class TestHandler:
    def test_drf_detail_shape_is_kept(self):
        resp = handler(NotFound("No existe."), _ctx())
        assert resp.status_code == 404 and resp.data == {"detail": "No existe."}

    def test_drf_field_dict_is_kept(self):
        resp = handler(DRFValidationError({"amount": ["Monto no válido."]}), _ctx())
        assert resp.status_code == 400 and resp.data == {"amount": ["Monto no válido."]}

    def test_django_validation_error_becomes_400(self):
        resp = handler(DjangoValidationError("Estado no válido."), _ctx())
        assert resp.status_code == 400 and resp.data == {"detail": "Estado no válido."}
        resp = handler(DjangoValidationError({"status": ["Estado no válido."]}), _ctx())
        assert resp.data == {"status": ["Estado no válido."]}

    def test_error_key_is_folded_into_detail(self):
        resp = handler(APIException({"error": "algo salió mal", "code": "x7"}), _ctx())
        assert resp.status_code == 500
        assert resp.data["detail"] == "algo salió mal" and resp.data["code"] == "x7"
        assert resp.data.get("error") in (None, "algo salió mal")  # alias only while flagged

    def test_unhandled_exception_passes_through(self):
        assert handler(RuntimeError("x"), _ctx()) is None

    def test_payload_too_large(self):
        exc = PayloadTooLarge(500)
        assert exc.status_code == 413
        assert str(exc.detail) == "Acote los filtros: el límite es 500 filas."
        assert str(PayloadTooLarge(detail="Divida el archivo.").detail) == "Divida el archivo."
        assert (
            cap_message(2000, verb="Divida el archivo")
            == "Divida el archivo: el límite es 2,000 filas."
        )


class TestErrorResponse:
    def test_body_carries_detail_and_extras(self, monkeypatch):
        monkeypatch.setattr(exceptions, "LEGACY_ERROR_KEY", False)
        assert error_body("No.", missing=["a"]) == {"detail": "No.", "missing": ["a"]}
        resp = error_response("No.", 404)
        assert resp.status_code == 404 and resp.data == {"detail": "No."}

    def test_legacy_alias_while_the_flag_is_on(self, monkeypatch):
        monkeypatch.setattr(exceptions, "LEGACY_ERROR_KEY", True)
        assert error_body("No.") == {"detail": "No.", "error": "No."}


@pytest.mark.django_db
class TestEndpointsUseDetail:
    """The ad-hoc {'error': ...} bodies now answer with {detail} (grep '{\\'error\\'' in apps)."""

    def test_import_students_without_file(self, admin_client):
        resp = admin_client.post(reverse("import-students"), {}, format="multipart")
        assert resp.status_code == 400
        assert resp.data["detail"].startswith("Adjunte un archivo")

    def test_google_token_without_credential(self, api_client):
        resp = api_client.post(reverse("google-token"), {}, format="json")
        assert resp.status_code == 400
        assert resp.data["detail"] == "credential required"
