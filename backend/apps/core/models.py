"""
Core models: public-facing site data (contact form submissions).
"""
from django.db import models


class ContactMessage(models.Model):
    """A message sent from the public Contacto form."""
    name       = models.CharField('Nombre', max_length=120)
    email      = models.EmailField('Correo')
    subject    = models.CharField('Asunto', max_length=200)
    message    = models.TextField('Mensaje')
    is_handled = models.BooleanField('Atendido', default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        verbose_name = 'Mensaje de contacto'
        verbose_name_plural = 'Mensajes de contacto'

    def __str__(self):
        return f'{self.name} — {self.subject}'
