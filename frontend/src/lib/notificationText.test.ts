import { describe, expect, it } from 'vitest';
import { linkify, listItemParts, notifPreview, parseMessage } from './notificationText';

// The shape of the 07:30 staff report (topup_apply_report), invented names.
const STAFF_REPORT = [
  'Recargas pagadas con tarjeta que aún no están en el saldo de cafetería (total $550.00):',
  '',
  '- Emilia Torres Vega · cliente Loyverse C-0042 · $350.00 · folio 812 · pagada 18/11 07:10 · se aplica 19/11 07:30',
  '- Joaquín Torres Vega · cliente Loyverse C-0057 · $200.00 · folio 815 · se aplica 19/11 07:30 · VENCIDA · SIN VERIFICAR: verifique en MultiCobros antes de cargarla (número de control 4471093)',
  '',
  'Las marcadas SIN VERIFICAR: antes de cargarlas, búsquelas en MultiCobros por su número de control y confírmelas en Cafetería → POS Loyverse → «Por aplicar» → «Verificar en MultiCobros» (referencia y monto). La app no suma al saldo una recarga sin verificar.',
].join('\n');

describe('parseMessage', () => {
  it('splits paragraphs on blank lines and keeps single line breaks inside one', () => {
    expect(parseMessage('Primera línea.\nSegunda línea.\n\nOtro párrafo.')).toEqual([
      { kind: 'paragraph', lines: ['Primera línea.', 'Segunda línea.'] },
      { kind: 'paragraph', lines: ['Otro párrafo.'] },
    ]);
  });

  it('reads "- " and "• " lines as a list', () => {
    expect(parseMessage('Avisos:\n- uno\n• dos')).toEqual([
      { kind: 'paragraph', lines: ['Avisos:'] },
      { kind: 'list', items: ['uno', 'dos'] },
    ]);
  });

  it('reads short «Etiqueta: valor» lines as label/value rows', () => {
    const blocks = parseMessage('Autor: Óscar Mejía\nPágina: Admisiones 2027\nEnlace: https://interlaken.edu.mx/admisiones');
    expect(blocks).toEqual([{
      kind: 'fields',
      rows: [
        { label: 'Autor', value: 'Óscar Mejía' },
        { label: 'Página', value: 'Admisiones 2027' },
        { label: 'Enlace', value: 'https://interlaken.edu.mx/admisiones' },
      ],
    }]);
  });

  it('keeps a long sentence that happens to contain a colon as prose', () => {
    const blocks = parseMessage(STAFF_REPORT);
    expect(blocks.map((b) => b.kind)).toEqual(['paragraph', 'list', 'paragraph']);
    expect(blocks[1]).toMatchObject({ kind: 'list' });
    expect((blocks[1] as { items: string[] }).items).toHaveLength(2);
  });

  it('never turns a one-line message into a label/value row', () => {
    expect(parseMessage('Gasto en cafetería el lunes: Ana: $57.00 en 2 compras.')).toEqual([
      { kind: 'paragraph', lines: ['Gasto en cafetería el lunes: Ana: $57.00 en 2 compras.'] },
    ]);
  });

  it('ignores lowercase or punctuated "labels" mid-sentence', () => {
    const blocks = parseMessage('hola: esto es texto\nEstimadas familias, recuerden: mañana no hay clases');
    expect(blocks).toEqual([{ kind: 'paragraph', lines: ['hola: esto es texto', 'Estimadas familias, recuerden: mañana no hay clases'] }]);
  });

  it('handles empty and Windows line endings', () => {
    expect(parseMessage('')).toEqual([]);
    expect(parseMessage(null)).toEqual([]);
    expect(parseMessage('a\r\n\r\nb')).toEqual([
      { kind: 'paragraph', lines: ['a'] },
      { kind: 'paragraph', lines: ['b'] },
    ]);
  });
});

describe('notifPreview', () => {
  it('shows the opening paragraph of a long report, ending in an ellipsis when a list follows', () => {
    expect(notifPreview(STAFF_REPORT)).toBe('Recargas pagadas con tarjeta que aún no están en el saldo de cafetería (total $550.00)…');
  });

  it('collapses line breaks and drops list markers', () => {
    expect(notifPreview('- uno\n- dos')).toBe('uno · dos');
    expect(notifPreview('Línea uno\nlínea dos')).toBe('Línea uno línea dos');
  });

  it('caps very long text', () => {
    const long = 'palabra '.repeat(80);
    const out = notifPreview(long, 60);
    expect(out.length).toBeLessThanOrEqual(60);
    expect(out.endsWith('…')).toBe(true);
  });
});

describe('listItemParts', () => {
  it('keeps the first part as the item and flags ALL-CAPS details', () => {
    const parts = listItemParts('Joaquín Torres · $200.00 · VENCIDA · SIN VERIFICAR: verifique en MultiCobros');
    expect(parts.main).toBe('Joaquín Torres');
    expect(parts.details).toEqual([
      { text: '$200.00' },
      { flag: 'VENCIDA', text: '' },
      { flag: 'SIN VERIFICAR', text: 'verifique en MultiCobros' },
    ]);
  });

  it('leaves a plain bullet alone', () => {
    expect(listItemParts('La cafetería permanecerá cerrada.')).toEqual({ main: 'La cafetería permanecerá cerrada.', details: [] });
  });
});

describe('linkify', () => {
  it('turns URLs and e-mail addresses into links, leaving trailing punctuation as text', () => {
    expect(linkify('Escriba a informes@interlaken.edu.mx o visite https://interlaken.edu.mx/calendario.')).toEqual([
      { kind: 'text', text: 'Escriba a ' },
      { kind: 'link', text: 'informes@interlaken.edu.mx', href: 'mailto:informes@interlaken.edu.mx' },
      { kind: 'text', text: ' o visite ' },
      { kind: 'link', text: 'https://interlaken.edu.mx/calendario', href: 'https://interlaken.edu.mx/calendario' },
      { kind: 'text', text: '.' },
    ]);
  });

  it('adds https:// to a bare www. address', () => {
    expect(linkify('www.interlaken.edu.mx')).toEqual([
      { kind: 'link', text: 'www.interlaken.edu.mx', href: 'https://www.interlaken.edu.mx' },
    ]);
  });

  it('returns plain text untouched', () => {
    expect(linkify('Sin enlaces aquí')).toEqual([{ kind: 'text', text: 'Sin enlaces aquí' }]);
  });
});
