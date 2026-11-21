"""
admissions/document_models.py — the documents each school level asks for (Fase 4).

* ``RequiredDocument``: one row per document of the school's list (the 2027
  flyers), with the levels that ask for it, what to bring on paper and whether
  the family uploads it (``upload``) or it is the online ficha (``ficha``,
  satisfied once the ficha is sent, never uploaded). Edited by Admisiones in
  the console; the public «Documentación» page, the family's upload page, the
  staff checklist, the pipeline and the reminder all read this one list.
* ``RegistrationDocumentState``: what the office marks by hand on one
  registration's document: «Entregado en físico» or «No aplica».

The computed status of each document lives in ``admissions.required_docs``.
Kept in their own module (imported at the end of ``models.py``) so the other
admissions branches can grow ``models.py`` without touching these.
"""

from django.conf import settings
from django.db import models
from django.utils import timezone

LEVEL_CHOICES = (
    ("preescolar", "Preescolar"),
    ("primaria", "Primaria"),
    ("secundaria", "Secundaria"),
)
LEVEL_CODES = tuple(code for code, _ in LEVEL_CHOICES)


class RequiredDocument(models.Model):
    """A document of the admissions list, for one or more school levels."""

    class Kind(models.TextChoices):
        UPLOAD = "upload", "Se sube en línea"
        FICHA = "ficha", "Ficha de inscripción (en línea)"

    key = models.SlugField(max_length=50, unique=True, verbose_name="Clave")
    name = models.CharField(max_length=200, verbose_name="Nombre")
    description = models.CharField(max_length=500, blank=True, verbose_name="Descripción")
    physical_note = models.CharField(max_length=200, blank=True, verbose_name="En físico")
    # Level codes (LEVEL_CODES) that ask for it; «Maternal» is preescolar.
    levels = models.JSONField(default=list, blank=True, verbose_name="Niveles")
    kind = models.CharField(
        max_length=10, choices=Kind.choices, default=Kind.UPLOAD, verbose_name="Tipo"
    )
    multiple_files = models.BooleanField(default=False, verbose_name="Permite varios archivos")
    # Official online procedure (gob.mx), shown on the public «Documentación» page.
    link_url = models.URLField(max_length=300, blank=True, verbose_name="Enlace al trámite oficial")
    link_label = models.CharField(max_length=80, blank=True, verbose_name="Texto del enlace")
    active = models.BooleanField(default=True, verbose_name="Activo")
    order = models.PositiveIntegerField(default=0, verbose_name="Orden")
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Documento requerido"
        verbose_name_plural = "Documentos requeridos"
        ordering = ["order", "id"]

    def __str__(self):
        return self.name

    def applies_to(self, level: str) -> bool:
        """True when ``level`` asks for it. An unknown level ('') gets only the
        documents every level asks for (never another level's certificate)."""
        levels = set(self.levels or ())
        if level:
            return level in levels
        return set(LEVEL_CODES) <= levels


class RegistrationDocumentState(models.Model):
    """«Entregado en físico» / «No aplica» set by the office on one document."""

    class State(models.TextChoices):
        ENTREGADO_FISICO = "entregado_fisico", "Entregado en físico"
        NO_APLICA = "no_aplica", "No aplica"

    registration = models.ForeignKey(
        "admissions.Registration", on_delete=models.CASCADE, related_name="document_states"
    )
    required_document = models.ForeignKey(
        RequiredDocument, on_delete=models.CASCADE, related_name="states"
    )
    state = models.CharField(max_length=20, choices=State.choices, verbose_name="Estado")
    note = models.CharField(max_length=300, blank=True, verbose_name="Nota")
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Estado manual de documento"
        verbose_name_plural = "Estados manuales de documentos"
        constraints = [
            models.UniqueConstraint(
                fields=["registration", "required_document"], name="adm_doc_state_unique"
            ),
        ]

    def __str__(self):
        return f"{self.required_document} · {self.get_state_display()} ({self.registration_id})"
