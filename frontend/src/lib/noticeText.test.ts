import { describe, expect, it } from 'vitest';
import { fromEditable, noticeProblems, parseNotice, toEditable } from './noticeText';

// Dummy text with the official notice's shape (no real data).
const BODY = [
  'Texto de prueba del responsable,\ncon un salto de línea.',
  '¿PARA QUÉ FINES UTILIZAREMOS SUS DATOS DE PRUEBA?',
  'Párrafo uno del primer apartado.',
  '• Viñeta uno\n• Viñeta dos',
  '¿QUÉ DATOS PERSONALES UTILIZAREMOS EN LA PRUEBA?',
  'Párrafo del segundo apartado.',
  '¿CÓMO PUEDE ACCEDER, RECTIFICAR O CANCELAR\nSUS DATOS DE PRUEBA?',
  'Párrafo del tercer apartado.',
].join('\n\n');

describe('privacy notice text (console editor)', () => {
  it('round-trips into exactly what the public page reads', () => {
    const editable = toEditable(BODY);
    expect(editable.sections).toHaveLength(3);
    // Shown the way the page shows it; stored in capitals.
    expect(editable.sections[0].title).toBe('¿para qué fines utilizaremos sus datos de prueba?');
    expect(parseNotice(fromEditable(editable))).toEqual(parseNotice(BODY));
  });

  it('a new part written in lower case is stored as a heading the page recognises', () => {
    const editable = toEditable(BODY);
    editable.sections.push({ title: 'Cambios a este aviso de prueba', text: 'Nuevo párrafo.\n\n\n\nOtro párrafo.' });
    const parsed = parseNotice(fromEditable(editable));
    expect(parsed.sections).toHaveLength(4);
    expect(parsed.sections[3]).toEqual({ title: 'CAMBIOS A ESTE AVISO DE PRUEBA', paragraphs: ['Nuevo párrafo.', 'Otro párrafo.'] });
  });

  it('flags what would make the page read the text differently', () => {
    const editable = toEditable(BODY);
    editable.sections[0].title = 'Corto';
    editable.sections[1].text = 'Bien.\n\nESTE PÁRRAFO ESTÁ TODO EN MAYÚSCULAS';
    const problems = noticeProblems(editable);
    expect(problems.sections[0].title).toMatch(/15 letras/);
    expect(problems.sections[1].text).toMatch(/mayúsculas/);
    expect(problems.blocking).toBe(true);
    expect(noticeProblems(toEditable(BODY)).blocking).toBe(false);
    expect(noticeProblems({ intro: 'x', sections: [] }).structure).toMatch(/texto corrido/);
    expect(noticeProblems({ intro: '', sections: [] }).blocking).toBe(true);
  });
});
