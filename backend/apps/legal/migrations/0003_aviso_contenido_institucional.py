# Data migration: publica la versión 2026.2 del Aviso de Privacidad con el
# contenido institucional del sitio anterior del colegio (responsable, datos
# tratados, finalidades, transferencias a autoridades educativas y mecanismo
# ARCO). El texto debe pasar por revisión del abogado antes del go-live.
from datetime import date

from django.db import migrations

BODY = """\
ADCE EDUCACIÓN, A.C., mejor conocido como COLEGIO INTERLAKEN, con domicilio en
Calle de la Bola 34, Tlalnepantla, Estado de México, C.P. 54020, y sitio web
https://interlaken.edu.mx, es el responsable del uso y protección de sus datos
personales conforme a la Ley Federal de Protección de Datos Personales en
Posesión de los Particulares (LFPDPPP).

DATOS PERSONALES QUE TRATAMOS
Para las finalidades descritas en este aviso recabamos: datos de
identificación, datos de contacto, características físicas, datos laborales
del padre, madre o tutor, y datos académicos del alumno o la alumna.

FINALIDADES DEL TRATAMIENTO
Los datos personales se utilizan para: (1) la inscripción y gestión del alumno
en los sistemas escolares del colegio (Servoescolar y SESWEB), incluyendo
control académico, administrativo y de cobranza; y (2) el registro del alumno
ante la Secretaría de Educación Pública (SEP) para la emisión de documentación
oficial.

TRANSFERENCIAS
Con fundamento en la normatividad educativa, y sin que se requiera su
consentimiento, los datos se comparten con: la Secretaría de Educación del
Estado de México y con Servicios Educativos Integrados al Estado de México
(SEIEM), exclusivamente para cumplir los requerimientos de la SEP —boletas
oficiales y estadística nacional—.

DERECHOS ARCO
Usted puede ejercer en todo momento sus derechos de Acceso, Rectificación,
Cancelación u Oposición (ARCO), así como revocar su consentimiento, a través
de cualquiera de estos medios:
• Teléfono: (55) 5379-1188
• Correo electrónico: colegio@interlaken.com.mx
• Directamente en las oficinas administrativas del colegio
El Departamento Administrativo dará trámite a su solicitud en los mismos
medios de contacto.

CAMBIOS AL AVISO DE PRIVACIDAD
Cualquier modificación a este aviso se anunciará en nuestro sitio web y se
comunicará por escrito; las modificaciones permanecerán visibles durante al
menos 15 días.
"""


def publish_v2026_2(apps, schema_editor):
    PrivacyNoticeVersion = apps.get_model('legal', 'PrivacyNoticeVersion')
    if PrivacyNoticeVersion.objects.filter(version='2026.2').exists():
        return
    PrivacyNoticeVersion.objects.filter(is_active=True).update(is_active=False)
    PrivacyNoticeVersion.objects.create(
        version='2026.2',
        title='Aviso de Privacidad',
        body=BODY,
        effective_date=date(2026, 7, 9),
        is_active=True,
    )


def rollback_v2026_2(apps, schema_editor):
    PrivacyNoticeVersion = apps.get_model('legal', 'PrivacyNoticeVersion')
    PrivacyNoticeVersion.objects.filter(version='2026.2').delete()
    prev = PrivacyNoticeVersion.objects.order_by('-effective_date').first()
    if prev:
        prev.is_active = True
        prev.save(update_fields=['is_active'])


class Migration(migrations.Migration):
    dependencies = [
        ('legal', '0002_arcorequest'),
    ]

    operations = [
        migrations.RunPython(publish_v2026_2, rollback_v2026_2),
    ]
