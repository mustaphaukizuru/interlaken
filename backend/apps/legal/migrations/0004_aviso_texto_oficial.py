# Data migration: publica la versión 2026.3 del Aviso de Privacidad con el
# TEXTO OFICIAL completo entregado por el cliente (2026-07-09), reemplazando
# el resumen de la 0003. Único cambio editorial: corrección del tipográfico
# "electróncio" → "electrónico". La tabla de transferencias se linealiza para
# render de texto plano.
from datetime import date

from django.db import migrations

BODY = """\
ADCE EDUCACION, A.C., mejor conocido como COLEGIO INTERLAKEN, con domicilio en
calle CALLE DE LA BOLA 34, colonia RESIDENCIAL EL DORADO, ciudad TLALNEPANTLA,
municipio o delegación TLALNEPANTLA, c.p. 54020, en la entidad de ESTADO DE
MEXICO, país MEXICO, y portal de internet https://interlaken.com.mx, es el
responsable del uso y protección de sus datos personales, y al respecto le
informamos lo siguiente:

¿PARA QUÉ FINES UTILIZAREMOS SUS DATOS PERSONALES?

Los datos personales que recabamos de usted, los utilizaremos para las
siguientes finalidades que son necesarias para el servicio que solicita:

• Para llevar a cabo la inscripción del alumno en nuestro sistema escolar
  Servoescolar y en nuestro sistema escolar por Internet SESWEB
• Para llevar a cabo la inscripción del alumno ante la Secretaria de
  Educación Pública

¿QUÉ DATOS PERSONALES UTILIZAREMOS PARA ESTOS FINES?

Para llevar a cabo las finalidades descritas en el presente aviso de
privacidad, utilizaremos los siguientes datos personales:

• Datos de identificación
• Datos de contacto
• Datos sobre características físicas
• Datos laborales
• Datos académicos

¿CON QUIÉN COMPARTIMOS SU INFORMACIÓN PERSONAL Y PARA QUÉ FINES?

Le informamos que sus datos personales son compartidos dentro del país con
las siguientes personas, empresas, organizaciones o autoridades distintas a
nosotros, para los siguientes fines:

• Secretaria de Educación del Estado de México — Finalidad: cumplir con los
  requerimientos de la Secretaria de Educación Pública para que ellos puedan
  elaborar boletas oficiales y estadísticas nacionales. Requiere del
  consentimiento: No.
• Servicios Educativos Integrados al Estado de México — Finalidad: cumplir
  con los requerimientos de la Secretaria de Educación Pública para que ellos
  puedan elaborar boletas oficiales y estadísticas nacionales. Requiere del
  consentimiento: No.

¿CÓMO PUEDE ACCEDER, RECTIFICAR O CANCELAR SUS DATOS PERSONALES, U OPONERSE
A SU USO?

Usted tiene derecho a conocer qué datos personales tenemos de usted, para qué
los utilizamos y las condiciones del uso que les damos (Acceso). Asimismo, es
su derecho solicitar la corrección de su información personal en caso de que
esté desactualizada, sea inexacta o incompleta (Rectificación); que la
eliminemos de nuestros registros o bases de datos cuando considere que la
misma no está siendo utilizada adecuadamente (Cancelación); así como oponerse
al uso de sus datos personales para fines específicos (Oposición). Estos
derechos se conocen como derechos ARCO.

Para el ejercicio de cualquiera de los derechos ARCO, usted deberá presentar
la solicitud respectiva a través del siguiente medio: Llamando al número
telefónico (5255) 53791188 o enviando un correo electrónico a
colegio@interlaken.com.mx. Para conocer el procedimiento y requisitos para el
ejercicio de los derechos ARCO, ponemos a su disposición el siguiente medio:
Directamente en las oficinas del Colegio.

Los datos de contacto de la persona o departamento de datos personales, que
está a cargo de dar trámite a las solicitudes de derechos ARCO, son los
siguientes:

a) Nombre de la persona o departamento de datos personales: Departamento
   Administrativo
b) Domicilio: calle Calle de la Bola 34, colonia Residencial el Dorado,
   ciudad Tlalnepantla, municipio o delegación Tlalnepantla, c.p. 54020, en
   la entidad de Estado de México, país México
c) Correo electrónico: colegio@interlaken.com.mx
d) Número telefónico: (5255) 53791188

USTED PUEDE REVOCAR SU CONSENTIMIENTO PARA EL USO DE SUS DATOS PERSONALES

Usted puede revocar el consentimiento que, en su caso, nos haya otorgado para
el tratamiento de sus datos personales. Sin embargo, es importante que tenga
en cuenta que no en todos los casos podremos atender su solicitud o concluir
el uso de forma inmediata, ya que es posible que por alguna obligación legal
requiramos seguir tratando sus datos personales. Asimismo, usted deberá
considerar que para ciertos fines, la revocación de su consentimiento
implicará que no le podamos seguir prestando el servicio que nos solicitó, o
la conclusión de su relación con nosotros.

Para revocar su consentimiento deberá presentar su solicitud a través del
siguiente medio: A través del teléfono (5255) 53791188 o enviando un correo
electrónico a colegio@interlaken.com.mx.

Para conocer el procedimiento y requisitos para la revocación del
consentimiento, ponemos a su disposición el siguiente medio: Directamente en
las oficinas del Colegio.

¿CÓMO PUEDE LIMITAR EL USO O DIVULGACIÓN DE SU INFORMACIÓN PERSONAL?

Con objeto de que usted pueda limitar el uso y divulgación de su información
personal, le ofrecemos los siguientes medios: Enviando un correo electrónico
a colegio@interlaken.com.mx y solicitándolo telefónicamente en el
(5255) 53791188.

¿CÓMO PUEDE CONOCER LOS CAMBIOS EN ESTE AVISO DE PRIVACIDAD?

El presente aviso de privacidad puede sufrir modificaciones, cambios o
actualizaciones derivadas de nuevos requerimientos legales; de nuestras
propias necesidades por los productos o servicios que ofrecemos; de nuestras
prácticas de privacidad; de cambios en nuestro modelo de negocio, o por otras
causas.

Nos comprometemos a mantenerlo informado sobre los cambios que pueda sufrir
el presente aviso de privacidad, a través de: Por medio de la pagina de
internet https://interlaken.com.mx/11aviso.php y por medio escrito a cada uno
de los usuarios.

El procedimiento a través del cual se llevarán a cabo las notificaciones
sobre cambios o actualizaciones al presente aviso de privacidad es el
siguiente: Se publicara en la página de internet un anuncio que estara
visible por 15 días informando de los cambios, así mismo se enviará un
comunicado escrito a cada alumno para que sea firmado por el Padre de
Familia.
"""


def publish_v2026_3(apps, schema_editor):
    PrivacyNoticeVersion = apps.get_model('legal', 'PrivacyNoticeVersion')
    if PrivacyNoticeVersion.objects.filter(version='2026.3').exists():
        return
    PrivacyNoticeVersion.objects.filter(is_active=True).update(is_active=False)
    PrivacyNoticeVersion.objects.create(
        version='2026.3',
        title='Aviso de Privacidad',
        body=BODY,
        effective_date=date(2026, 7, 9),
        is_active=True,
    )


def rollback_v2026_3(apps, schema_editor):
    PrivacyNoticeVersion = apps.get_model('legal', 'PrivacyNoticeVersion')
    PrivacyNoticeVersion.objects.filter(version='2026.3').delete()
    prev = PrivacyNoticeVersion.objects.order_by('-effective_date').first()
    if prev:
        prev.is_active = True
        prev.save(update_fields=['is_active'])


class Migration(migrations.Migration):
    dependencies = [
        ('legal', '0003_aviso_contenido_institucional'),
    ]

    operations = [
        migrations.RunPython(publish_v2026_3, rollback_v2026_3),
    ]
