import { describe, it, expect } from 'vitest';
import { parseNotice } from './AvisoPrivacidadPage';

// Estructura espejo del texto oficial v2026.3 (encabezados reales, cuerpos
// abreviados): valida la detección de secciones sin duplicar el documento.
const BODY = `ADCE EDUCACION, A.C., mejor conocido como COLEGIO INTERLAKEN, con domicilio en
calle CALLE DE LA BOLA 34, es el responsable del uso y protección de sus datos.

¿PARA QUÉ FINES UTILIZAREMOS SUS DATOS PERSONALES?

• Para llevar a cabo la inscripción del alumno.

¿QUÉ DATOS PERSONALES UTILIZAREMOS PARA ESTOS FINES?

• Datos de identificación
• Datos de contacto

¿CÓMO PUEDE ACCEDER, RECTIFICAR O CANCELAR SUS DATOS PERSONALES, U OPONERSE
A SU USO?

Usted tiene derecho a conocer qué datos personales tenemos de usted (Acceso).

USTED PUEDE REVOCAR SU CONSENTIMIENTO PARA EL USO DE SUS DATOS PERSONALES

Usted puede revocar el consentimiento que nos haya otorgado.

¿CÓMO PUEDE CONOCER LOS CAMBIOS EN ESTE AVISO DE PRIVACIDAD?

Se publicara en la página de internet un anuncio visible por 15 días.`;

describe('parseNotice', () => {
  it('separates the intro and detects every uppercase heading as a section', () => {
    const { intro, sections } = parseNotice(BODY);
    expect(intro).toHaveLength(1);
    expect(intro[0]).toContain('ADCE EDUCACION, A.C.');
    expect(sections.map((s) => s.title)).toEqual([
      '¿PARA QUÉ FINES UTILIZAREMOS SUS DATOS PERSONALES?',
      '¿QUÉ DATOS PERSONALES UTILIZAREMOS PARA ESTOS FINES?',
      // Encabezado de dos líneas → una sola sección con el título unido.
      '¿CÓMO PUEDE ACCEDER, RECTIFICAR O CANCELAR SUS DATOS PERSONALES, U OPONERSE A SU USO?',
      'USTED PUEDE REVOCAR SU CONSENTIMIENTO PARA EL USO DE SUS DATOS PERSONALES',
      '¿CÓMO PUEDE CONOCER LOS CAMBIOS EN ESTE AVISO DE PRIVACIDAD?',
    ]);
    // Cada sección conserva su contenido.
    expect(sections[1].paragraphs[0]).toContain('Datos de identificación');
  });

  it('falls back gracefully on unstructured text (no false headings)', () => {
    const { intro, sections } = parseNotice(
      'Texto plano sin encabezados.\n\nOtro párrafo normal en minúsculas.',
    );
    expect(sections).toHaveLength(0);
    expect(intro).toHaveLength(2);
  });
});
