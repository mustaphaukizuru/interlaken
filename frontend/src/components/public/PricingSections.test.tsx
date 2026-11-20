import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/renderWithProviders';
import { PRICING_COPY, PricingSections, policyMatcher } from './PricingSections';
import { ESTIMATOR_COPY } from '@/components/admissions/estimatorCopy';
import { CostEstimator } from '@/components/admissions/CostEstimator';
import costos from '@/cms/sections/costos';
import admisiones from '@/cms/sections/admisiones';

vi.mock('@/services/api', () => ({ contentApi: { getPricing: vi.fn(), getSettings: vi.fn(() => new Promise(() => {})) } }));
import { contentApi } from '@/services/api';

const BUNDLE = {
  enrollment_fees: [
    { section: 'Preescolar', modality: 'nuevo_ingreso', gastos_administrativos: '2500.00', cuota: '6800.00', order: 1 },
    { section: 'Preescolar', modality: 'reinscripcion', gastos_administrativos: '2000.00', cuota: '5760.00', order: 1 },
  ],
  tuition: [{ section: 'Primaria', inscripcion: null, colegiatura: '6450.00', order: 1 }, { section: 'Lactantes', inscripcion: null, colegiatura: '3900.00', order: 2 }],
  fixed_concepts: [{ name: 'Credenciales', cost: '350.00', mandatory: true, order: 1 }],
  extracurriculars: [{ name: 'Karate', levels: 'Primaria', annual_cost: '4200.00', order: 1 }],
  daycare: [{ schedule: 'Hasta 15:50', service: 'Comida', daily_cost: '150.00', monthly_cost: '2670.00', monthly_note: 'Matutina', order: 1 }],
  policies: [
    { text: 'Las colegiaturas se pagan en 11 mensualidades.', order: 1 },
    { text: 'Los gastos administrativos no tienen devoluciones.', order: 2 },
    { text: 'A partir del día 17 se aplica un RECARGO del 5%.', order: 3 },
  ],
};

beforeEach(() => {
  vi.mocked(contentApi.getPricing).mockResolvedValue({ data: BUNDLE } as never);
});

describe('policy highlighting', () => {
  it('matches the words of the setting, ignoring accents and case (today: recargo, devolución)', () => {
    const today = policyMatcher(PRICING_COPY.policyHighlight);
    expect(today('Los gastos no tienen devoluciones.')).toBe(true);
    expect(today('Devolución al 100%')).toBe(true);
    expect(today('Se aplica un Recargo del 5%')).toBe(true);
    expect(today('Las becas no son acumulables.')).toBe(false);
    expect(policyMatcher('becas,  ')('Las Becas no son acumulables.')).toBe(true);
    expect(policyMatcher('')('recargo')).toBe(false);
  });
});

describe('PricingSections copy', () => {
  it('keeps today\'s headers and labels by default', async () => {
    renderWithProviders(<PricingSections />);
    const fees = await screen.findByRole('table', { name: 'Nuevo ingreso: gastos administrativos y inscripción por nivel' });
    expect(within(fees).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Nivel', 'Gastos administrativos', 'Inscripción']);
    expect(screen.getAllByText('/ mes')).toHaveLength(2);
    expect(screen.getByText('/ año')).toBeInTheDocument();
    expect(screen.getByText('$2,670.00 /mes (matutina)')).toBeInTheDocument();
    expect(screen.getByText(/devoluciones/)).toHaveClass('font-medium');
    expect(screen.getByText(/RECARGO/)).toHaveClass('font-medium');
    expect(screen.getByText(/11 mensualidades\./)).toHaveClass('text-muted');
  });

  it('shows the edited headers, labels and highlight words', async () => {
    renderWithProviders(<PricingSections copy={{
      colLevel: 'Sección', colAdmin: 'Gastos de admisión', colNew: 'Cuota nueva', colReturning: 'Cuota de regreso',
      perMonth: 'al mes', perYear: 'al año', daycareMonthly: 'mensual', policyHighlight: 'mensualidades',
    }} />);
    const fees = await screen.findByRole('table', { name: 'Nuevo ingreso: gastos de admisión y cuota nueva por sección' });
    expect(within(fees).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Sección', 'Gastos de admisión', 'Cuota nueva']);
    await userEvent.click(screen.getByRole('button', { name: 'Alumnos Interlaken' }));
    expect(screen.getByRole('columnheader', { name: 'Cuota de regreso' })).toBeInTheDocument();
    expect(screen.getAllByText('al mes')).toHaveLength(2);
    expect(screen.getByText('al año')).toBeInTheDocument();
    expect(screen.getByText('$2,670.00 mensual (matutina)')).toBeInTheDocument();
    expect(screen.getByText(/11 mensualidades\./)).toHaveClass('font-medium');
    expect(screen.getByText(/devoluciones/)).toHaveClass('text-muted');
  });

  it('shows the edited error message', async () => {
    vi.mocked(contentApi.getPricing).mockRejectedValue(new Error('x'));
    renderWithProviders(<PricingSections copy={{ errorTitle: 'Sin conexión', errorText: 'Vuelva más tarde.' }} />);
    expect(await screen.findByText('Sin conexión')).toBeInTheDocument();
    expect(screen.getByText('Vuelva más tarde.')).toBeInTheDocument();
  });
});

describe('estimator copy', () => {
  it('shows the edited labels, levels and notes; the figures still come from the price tables', async () => {
    renderWithProviders(<CostEstimator copy={{
      cardTitle: 'Calcule su cuota', sections: [{ label: 'Lactantes' }, { label: 'Primaria' }], startSection: 'Primaria',
      newTag: 'Primera vez', tuitionLabel: 'Mensualidad', perMonth: 'al mes', notes: [{ text: 'Precios con IVA incluido.', tone: 'amber' }],
      allLabel: 'Todos los precios', allHref: '/admisiones/costos#tablas',
    }} />);
    expect(await screen.findByText('$6,450.00')).toBeInTheDocument();           // Primaria, the start level
    expect(screen.getByRole('heading', { name: 'Calcule su cuota' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Primera vez' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('button', { name: 'Maternal' })).not.toBeInTheDocument();
    expect(screen.getByText('Mensualidad')).toBeInTheDocument();
    expect(screen.getByText('al mes')).toBeInTheDocument();
    expect(screen.getByText('Precios con IVA incluido.')).toBeInTheDocument();
    expect(screen.queryByText(/4 parcialidades/)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Todos los precios/ })).toHaveAttribute('href', '/admisiones/costos#tablas');
    await userEvent.click(screen.getByRole('button', { name: 'Lactantes' }));
    expect(await screen.findByText('$3,900.00')).toBeInTheDocument();
    expect(screen.getAllByText('SIN COSTO')).toHaveLength(2);                    // no inscripción row for Lactantes
  });
});

describe('section specs', () => {
  const fieldKeys = (type: string) => (costos.sections.concat(admisiones.sections).find((s) => s.type === type)?.fields ?? []).map((f) => f.key);

  it('every label of the price tables and the estimator is editable, with today\'s text as default', () => {
    const prices = costos.sections.find((s) => s.type === 'costos.prices')!;
    for (const key of Object.keys(PRICING_COPY)) expect(fieldKeys('costos.prices'), key).toContain(key);
    expect(prices.defaults).toMatchObject(PRICING_COPY);
    const estimator = admisiones.sections.find((s) => s.type === 'admisiones.estimator')!;
    for (const key of Object.keys(ESTIMATOR_COPY)) expect(fieldKeys('admisiones.estimator'), key).toContain(key);
    expect(estimator.defaults).toMatchObject(ESTIMATOR_COPY);
  });

  it('both sections open «Costos y precios» instead of the old «Ajustes, Costos» hint', () => {
    for (const type of ['costos.prices', 'admisiones.estimator']) {
      const spec = costos.sections.concat(admisiones.sections).find((s) => s.type === type)!;
      expect(spec.fields[0]).toMatchObject({ kind: 'action', label: 'Editar precios', actionHref: '/admin/costos' });
      expect(spec.description).not.toMatch(/Ajustes, Costos/);
    }
    const prices = costos.sections.find((s) => s.type === 'costos.prices')!;
    const groups = new Set(prices.fields.map((f) => f.group).filter(Boolean));
    expect([...groups]).toEqual(['Cómo se paga', 'Inscripción y reinscripción', 'Colegiaturas', 'Seguros y credenciales', 'Extraescolares', 'Estancia', 'Políticas de pago', 'Nota al final de las tablas', 'Llamado final', 'Si no hay precios o no cargan']);
  });
});
