import { describe, expect, it } from 'vitest';
import {
  diffRows, emptyRow, estimatorWarning, fromServer, ordered, parseMoney, tableDef, toPayload, validateRows, type EditRow,
} from './model';

const fees = tableDef('inscripcion');
const tuition = tableDef('colegiaturas');
const daycare = tableDef('estancia');

const FEES = fromServer(fees, [
  { id: 1, is_active: true, modality: 'nuevo_ingreso', section: 'Preescolar', gastos_administrativos: '2500.00', cuota: '6800.00' },
  { id: 4, is_active: true, modality: 'reinscripcion', section: 'Preescolar', gastos_administrativos: '2000.00', cuota: '5760.00' },
  { id: 2, is_active: true, modality: 'nuevo_ingreso', section: 'Primaria', gastos_administrativos: '2500.00', cuota: '8800.00' },
  { id: 5, is_active: true, modality: 'reinscripcion', section: 'Primaria', gastos_administrativos: '2000.00', cuota: '7200.00' },
]);
const TUITION = fromServer(tuition, ['Maternal', 'Preescolar', 'Primaria', 'Secundaria'].map((section, i) => ({ id: i + 10, is_active: true, section, colegiatura: `${4000 + i * 1000}.00` })));
const edit = (rows: EditRow[], i: number, patch: Record<string, string>) => rows.map((r, j) => (j === i ? { ...r, values: { ...r.values, ...patch } } : r));

describe('parseMoney (same rules as the API)', () => {
  it.each([
    ['6450', '6450.00'], ['$6,450.5', '6450.50'], [' 6 450 ', '6450.00'], ['0', '0.00'], ['999999.99', '999999.99'],
  ])('%s → %s', (input, out) => expect(parseMoney(input)).toEqual({ value: out }));
  it.each([
    ['-5', 'El monto no puede ser negativo.'], ['mil', 'Escriba un monto, por ejemplo 6450.00.'],
    ['10.505', 'Use como máximo 2 decimales.'], ['1000000', 'El monto máximo es $999,999.99.'],
  ])('%s is refused', (input, error) => expect(parseMoney(input).error).toBe(error));
  it('empty is no amount', () => expect(parseMoney('')).toEqual({ value: null }));
});

describe('validateRows', () => {
  it('marks required, amounts, lengths, formulas and duplicates per modality', () => {
    let rows = edit(FEES, 0, { cuota: '-1' });
    rows = edit(rows, 2, { section: 'Preescolar' });                 // same level twice in nuevo ingreso
    rows = edit(rows, 3, { section: 'x'.repeat(61) });
    rows = [...rows, { ...emptyRow(fees, 'reinscripcion'), values: { ...emptyRow(fees, 'reinscripcion').values, section: '=SUMA(A1)' } }];
    const errs = validateRows(fees, rows);
    expect(errs[rows[0]._key]).toEqual({ cuota: 'El monto no puede ser negativo.' });
    expect(errs[rows[2]._key].section).toMatch(/^Repetido/);
    expect(errs[rows[1]._key]).toBeUndefined();                    // Preescolar reinscripción is another modality
    expect(errs[rows[3]._key].section).toBe('Máximo 60 caracteres.');
    expect(errs[rows[4]._key]).toEqual({ section: 'No puede empezar con «=» ni «@».', gastos_administrativos: 'Este dato es obligatorio.', cuota: 'Este dato es obligatorio.' });
  });

  it('optional amounts may stay empty', () => {
    const rows = fromServer(daycare, [{ id: 1, is_active: true, schedule: '7:10', service: 'Matutina', daily_cost: '70.00', monthly_cost: null, monthly_note: '' }]);
    expect(validateRows(daycare, rows)).toEqual({});
  });
});

describe('diffRows', () => {
  it('lists changed amounts old → new with the column name of the modality', () => {
    const after = edit(FEES, 2, { cuota: '9,000' });
    expect(diffRows(fees, FEES, after)).toEqual([
      { kind: 'changed', rowKey: 'id2', title: 'Primaria', group: 'Nuevo ingreso', fields: [{ key: 'cuota', label: 'Inscripción', before: '$8,800.00', after: '$9,000.00' }], moved: undefined, visibility: undefined },
    ]);
    expect(diffRows(fees, FEES, edit(FEES, 2, { cuota: '8800' }))).toEqual([]);      // same amount, other spelling
  });

  it('grouping the rows by modality is not a change; moving inside a group is', () => {
    expect(diffRows(fees, FEES, ordered(fees, FEES))).toEqual([]);
    const swapped = [FEES[2], FEES[1], FEES[0], FEES[3]];             // Primaria before Preescolar (nuevo ingreso)
    const changes = diffRows(fees, FEES, swapped);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ kind: 'changed', moved: true, fields: [] });
  });

  it('a row moved to the top is the only one that moved', () => {
    const after = [TUITION[3], TUITION[0], TUITION[1], TUITION[2]];
    const changes = diffRows(tuition, TUITION, after);
    expect(changes.map((c) => c.title)).toEqual(['Secundaria']);
  });

  it('new, deleted and hidden rows', () => {
    const added = { ...emptyRow(tuition), values: { section: 'Bachillerato', colegiatura: '7500' } };
    const after = [{ ...TUITION[0], is_active: false }, TUITION[1], TUITION[2], added];
    const changes = diffRows(tuition, TUITION, after);
    expect(changes).toEqual([
      { kind: 'changed', rowKey: 'id10', title: 'Maternal', group: undefined, fields: [], moved: undefined, visibility: 'hidden' },
      { kind: 'added', rowKey: added._key, title: 'Bachillerato', group: undefined, visibility: undefined, fields: [
        { key: 'section', label: 'Sección', before: '', after: 'Bachillerato' }, { key: 'colegiatura', label: 'Colegiatura mensual', before: '', after: '$7,500.00' }] },
      { kind: 'removed', rowKey: 'id13', title: 'Secundaria', group: undefined, fields: [{ key: 'colegiatura', label: 'Colegiatura mensual', before: '$7,000.00', after: '' }] },
    ]);
  });
});

describe('toPayload', () => {
  it('sends each modality together, amounts with 2 decimals and empty optional amounts as null', () => {
    const { rows, keys } = toPayload(fees, edit(FEES, 1, { cuota: '5,800.5' }));
    expect(rows.map((r) => `${r.modality}:${r.section}`)).toEqual(['nuevo_ingreso:Preescolar', 'nuevo_ingreso:Primaria', 'reinscripcion:Preescolar', 'reinscripcion:Primaria']);
    expect(rows[2]).toEqual({ id: 4, is_active: true, modality: 'reinscripcion', section: 'Preescolar', gastos_administrativos: '2000.00', cuota: '5800.50' });
    expect(keys).toEqual(['id1', 'id2', 'id4', 'id5']);
    const d = toPayload(daycare, fromServer(daycare, [{ id: 3, is_active: true, schedule: 'Hasta 18:00', service: 'Multa', daily_cost: '300', monthly_cost: null, monthly_note: '' }]));
    expect(d.rows[0]).toMatchObject({ daily_cost: '300.00', monthly_cost: null, monthly_note: '' });
  });
});

describe('estimatorWarning', () => {
  it('warns when the estimator would not find a level', () => {
    expect(estimatorWarning(tuition, TUITION[0])).toBeNull();
    expect(estimatorWarning(tuition, { ...TUITION[0], values: { section: '1° a 3° de Preescolar' } })).toBeNull();
    expect(estimatorWarning(tuition, { ...TUITION[0], values: { section: 'Bachillerato' } })).toMatch(/no la mostrará/);
    expect(estimatorWarning(tableDef('seguros'), TUITION[0])).toBeNull();
  });
});
