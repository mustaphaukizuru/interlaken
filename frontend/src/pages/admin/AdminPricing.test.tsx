import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';

vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn(), loading: vi.fn(() => 't') } }));
vi.mock('@/services/pricingAdminApi', () => ({
  pricingAdminApi: { list: vi.fn(), save: vi.fn(), exportXlsx: vi.fn(), importXlsx: vi.fn() },
}));
vi.mock('@/services/api', () => ({
  contentApi: { getPage: vi.fn(), getPricing: vi.fn(), getSettings: vi.fn(() => new Promise(() => {})) },
  downloadBlob: vi.fn(),
}));

import toast from 'react-hot-toast';
import { pricingAdminApi, type PricingTableKey, type PricingTablePayload } from '@/services/pricingAdminApi';
import { contentApi, downloadBlob } from '@/services/api';
import { renderWithProviders } from '@/test/renderWithProviders';
import { stubViewport } from '@/test/viewport';
import AdminPricing from './AdminPricing';

const table = (key: PricingTableKey, rows: PricingTablePayload['rows']): PricingTablePayload => ({ key, label: key, rows, version: `v-${key}` });
const TABLES: Record<PricingTableKey, PricingTablePayload> = {
  inscripcion: table('inscripcion', [
    { id: 1, is_active: true, modality: 'nuevo_ingreso', section: 'Preescolar', gastos_administrativos: '2500.00', cuota: '6800.00' },
    { id: 2, is_active: true, modality: 'reinscripcion', section: 'Preescolar', gastos_administrativos: '2000.00', cuota: '5760.00' },
  ]),
  colegiaturas: table('colegiaturas', [
    { id: 10, is_active: true, section: 'Primaria', colegiatura: '6450.00' },
    { id: 11, is_active: true, section: 'Secundaria', colegiatura: '6990.00' },
  ]),
  seguros: table('seguros', [{ id: 20, is_active: true, name: 'Credenciales', cost: '350.00' }]),
  extraescolares: table('extraescolares', [{ id: 30, is_active: true, name: 'Karate', levels: 'Primaria', annual_cost: '4200.00' }]),
  estancia: table('estancia', [{ id: 40, is_active: true, schedule: 'Hasta 15:50', service: 'Comida', daily_cost: '150.00', monthly_cost: null, monthly_note: '' }]),
  politicas: table('politicas', [{ id: 50, is_active: true, text: 'Recargo del 5% a partir del día 17.' }, { id: 51, is_active: true, text: 'Becas no acumulables.' }]),
};
const clone = () => JSON.parse(JSON.stringify(TABLES)) as typeof TABLES;

beforeEach(() => {
  vi.clearAllMocks();
  stubViewport(1280);
  vi.mocked(pricingAdminApi.list).mockResolvedValue({ data: { tables: clone() } } as never);
  vi.mocked(contentApi.getPage).mockRejectedValue(new Error('404'));
});

const open = async (route = '/admin/costos?tabla=colegiaturas') => {
  const view = renderWithProviders(<AdminPricing />, { route });
  await screen.findByRole('tabpanel');
  return view;
};
const cell = (name: RegExp | string) => screen.getByRole('textbox', { name });

describe('AdminPricing', () => {
  it('edits like a spreadsheet, marks the tab, summarises old → new and saves the whole table', async () => {
    const u = userEvent.setup();
    const saved = clone().colegiaturas;
    saved.rows[0].colegiatura = '6700.00';
    vi.mocked(pricingAdminApi.save).mockResolvedValue({ data: { tables: { colegiaturas: { ...saved, version: 'v2' } }, counts: {} } } as never);
    await open();
    const primaria = cell('Colegiatura mensual, Primaria');
    expect(primaria).toHaveValue('6,450.00');                       // formatted while not editing
    await u.click(primaria);
    expect(primaria).toHaveValue('6450.00');                        // raw while editing
    await u.keyboard('6700{Enter}');
    expect(cell('Colegiatura mensual, Secundaria')).toHaveFocus();  // Enter goes down
    expect(primaria).toHaveValue('6,700.00');
    expect(screen.getByText(/antes/).textContent).toBe('antes $6,450.00');
    expect(screen.getByRole('tab', { name: /Colegiaturas.*1 cambio sin guardar/ })).toBeInTheDocument();

    await u.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    const dialog = await screen.findByRole('dialog', { name: 'Revise los cambios antes de guardar' });
    expect(within(dialog).getByText('$6,450.00')).toHaveClass('line-through');
    expect(within(dialog).getByText('$6,700.00')).toBeInTheDocument();
    await u.click(within(dialog).getByRole('button', { name: 'Guardar 1 cambio' }));
    await waitFor(() => expect(pricingAdminApi.save).toHaveBeenCalledWith({
      colegiaturas: { version: 'v-colegiaturas', rows: [
        { id: 10, is_active: true, section: 'Primaria', colegiatura: '6700.00' },
        { id: 11, is_active: true, section: 'Secundaria', colegiatura: '6990.00' },
      ] },
    }, 'editor'));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Precios guardados. El sitio ya muestra los cambios.'));
    expect(screen.queryByRole('button', { name: 'Guardar cambios' })).not.toBeInTheDocument();
    expect(screen.queryByText(/antes/)).not.toBeInTheDocument();
  });

  it('shows a problem next to the cell and does not open the summary', async () => {
    const u = userEvent.setup();
    await open();
    await u.clear(cell('Colegiatura mensual, Secundaria'));
    await u.type(cell('Colegiatura mensual, Secundaria'), '-5');
    expect(cell('Colegiatura mensual, Secundaria')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('El monto no puede ser negativo.')).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(toast.error).toHaveBeenCalledWith('Corrija los datos marcados antes de guardar.');
    expect(screen.getByRole('tab', { name: /Colegiaturas.*1 dato por corregir/ })).toBeInTheDocument();
    expect(pricingAdminApi.save).not.toHaveBeenCalled();
  });

  it('adds, duplicates, hides, reorders and deletes (with confirmation) rows', async () => {
    const u = userEvent.setup();
    await open();
    await u.click(screen.getByRole('button', { name: 'Agregar sección' }));
    await u.keyboard('Bachillerato');
    await u.tab();
    await u.keyboard('7500');
    await u.click(screen.getByRole('button', { name: 'Duplicar: Primaria' }));
    const copy = screen.getAllByRole('textbox', { name: 'Sección, Primaria' })[1];
    expect(copy).toHaveAttribute('aria-invalid', 'true');            // same name twice
    await u.clear(copy);
    await u.type(copy, 'Primaria vespertina');
    expect(copy).not.toHaveAttribute('aria-invalid');
    await u.click(screen.getByRole('switch', { name: 'Visible en el sitio: Secundaria' }));
    await u.click(screen.getAllByRole('button', { name: 'Bajar: Primaria' })[0]);
    await u.click(screen.getByRole('button', { name: 'Eliminar: Secundaria' }));
    const confirm = await screen.findByRole('dialog', { name: 'Eliminar fila' });
    expect(confirm).toHaveTextContent('Se eliminará «Secundaria» de Colegiaturas al guardar');
    await u.click(within(confirm).getByRole('button', { name: 'Eliminar fila' }));
    expect(screen.queryByRole('textbox', { name: 'Sección, Secundaria' })).not.toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    const dialog = await screen.findByRole('dialog', { name: 'Revise los cambios antes de guardar' });
    expect(within(dialog).getAllByText('Nueva fila')).toHaveLength(2);
    expect(within(dialog).getByText('Se elimina')).toBeInTheDocument();
    expect(within(dialog).getByText('$7,500.00')).toBeInTheDocument();
  });

  it('shows a concurrent edit and reloads that table', async () => {
    const u = userEvent.setup();
    vi.mocked(pricingAdminApi.save).mockRejectedValue({ response: { status: 409, data: { code: 'version_conflict', tables: ['colegiaturas'], detail: 'x' } } });
    await open();
    await u.click(cell('Colegiatura mensual, Primaria'));
    await u.keyboard('1');
    await u.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await u.click(await screen.findByRole('button', { name: 'Guardar 1 cambio' }));
    const dialog = await screen.findByRole('dialog', { name: 'Otra persona cambió los precios' });
    const fresh = clone();
    fresh.colegiaturas.rows[0].colegiatura = '6600.00';
    vi.mocked(pricingAdminApi.list).mockResolvedValue({ data: { tables: fresh } } as never);
    await u.click(within(dialog).getByRole('button', { name: 'Recargar esas tablas' }));
    await waitFor(() => expect(cell('Colegiatura mensual, Primaria')).toHaveValue('6,600.00'));
    expect(screen.queryByRole('button', { name: 'Guardar cambios' })).not.toBeInTheDocument();
  });

  it('puts the API\'s per-row errors next to their cells', async () => {
    const u = userEvent.setup();
    vi.mocked(pricingAdminApi.save).mockRejectedValue({ response: { status: 400, data: { code: 'invalid_rows', detail: 'Revise', errors: { colegiaturas: [{ row: 1, field: 'section', label: 'Sección', message: 'Esta fila ya no existe; recargue la página.' }] } } } });
    await open();
    await u.click(cell('Colegiatura mensual, Primaria'));
    await u.keyboard('1');
    await u.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await u.click(await screen.findByRole('button', { name: 'Guardar 1 cambio' }));
    expect(await screen.findByText('Esta fila ya no existe; recargue la página.')).toBeInTheDocument();
    expect(cell('Sección, Secundaria')).toHaveAttribute('aria-invalid', 'true');
  });

  it('groups Inscripción by modality and keeps each modality together', async () => {
    await open('/admin/costos');
    expect(screen.getByRole('heading', { name: 'Nuevo ingreso', level: 3 })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Reinscripción (alumnos Interlaken)', level: 3 })).toBeInTheDocument();
    expect(screen.getByRole('table', { name: /Nuevo ingreso: celdas editables/ })).toHaveTextContent('Inscripción');
    expect(screen.getByRole('table', { name: /Reinscripción \(alumnos Interlaken\): celdas editables/ })).toHaveTextContent('Reinscripción');
  });

  it('marks the policies the site highlights', async () => {
    await open('/admin/costos?tabla=politicas');
    const rows = screen.getAllByRole('row').slice(1);
    expect(within(rows[0]).getByText('Destacada')).toBeInTheDocument();
    expect(within(rows[1]).queryByText('Destacada')).not.toBeInTheDocument();
  });

  it('stacks each row as a card with visible labels on a phone', async () => {
    stubViewport(390);
    await open();
    expect(screen.queryByRole('table', { name: /celdas editables/ })).not.toBeInTheDocument();
    const list = screen.getByRole('list', { name: 'Colegiaturas' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(within(list).getAllByText('Colegiatura mensual')).toHaveLength(2);
  });

  it('imports a workbook: shows each change, loads it into the editor, saves it as an import', async () => {
    const u = userEvent.setup();
    const rows = clone().colegiaturas.rows;
    rows[0].colegiatura = '6890.00';
    vi.mocked(pricingAdminApi.importXlsx).mockResolvedValue({ data: { tables: { colegiaturas: { sheet: 'Colegiaturas', rows, errors: [] } }, ignored_sheets: ['Instrucciones'] } } as never);
    vi.mocked(pricingAdminApi.save).mockResolvedValue({ data: { tables: {}, counts: {} } } as never);
    await open();
    await u.click(screen.getByRole('button', { name: 'Importar Excel' }));
    const dialog = await screen.findByRole('dialog', { name: 'Importar precios desde Excel' });
    await u.upload(dialog.querySelector('input[type=file]') as HTMLInputElement, new File(['x'], 'precios.xlsx'));
    expect(await within(dialog).findByText('$6,890.00')).toBeInTheDocument();
    expect(within(dialog).getByText(/No vienen en el archivo y no se tocan: Inscripción y reinscripción/)).toBeInTheDocument();
    await u.click(within(dialog).getByRole('button', { name: 'Cargar 1 cambio en el editor' }));
    expect(cell('Colegiatura mensual, Primaria')).toHaveValue('6,890.00');
    expect(screen.getByText('(desde Excel)')).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await u.click(await screen.findByRole('button', { name: 'Guardar 1 cambio' }));
    await waitFor(() => expect(pricingAdminApi.save).toHaveBeenCalledWith(expect.anything(), 'import'));
  });

  it('refuses an import with errors', async () => {
    const u = userEvent.setup();
    vi.mocked(pricingAdminApi.importXlsx).mockResolvedValue({ data: { tables: { colegiaturas: { sheet: 'Colegiaturas', rows: [], errors: [{ row: 0, line: 3, field: 'colegiatura', label: 'Colegiatura mensual', message: 'Escriba un monto, por ejemplo 6450.00.' }] } }, ignored_sheets: [] } } as never);
    await open();
    await u.click(screen.getByRole('button', { name: 'Importar Excel' }));
    const dialog = await screen.findByRole('dialog', { name: 'Importar precios desde Excel' });
    await u.upload(dialog.querySelector('input[type=file]') as HTMLInputElement, new File(['x'], 'precios.xlsx'));
    expect(await within(dialog).findByText('Fila 3, Colegiatura mensual: Escriba un monto, por ejemplo 6450.00.')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Cargar en el editor' })).toBeDisabled();
  });

  it('exports the saved prices to Excel', async () => {
    const u = userEvent.setup();
    vi.mocked(pricingAdminApi.exportXlsx).mockResolvedValue({ data: new Blob(['x']) } as never);
    await open();
    await u.click(screen.getByRole('button', { name: 'Exportar Excel' }));
    await waitFor(() => expect(downloadBlob).toHaveBeenCalledWith(expect.any(Blob), expect.stringMatching(/^precios_\d{4}-\d{2}-\d{2}\.xlsx$/)));
  });

  it('asks before leaving with unsaved changes, and discards on request', async () => {
    const u = userEvent.setup();
    await open();
    await u.click(cell('Colegiatura mensual, Primaria'));
    await u.keyboard('1{Tab}');
    await u.click(screen.getByRole('link', { name: 'Páginas › Costos' }));
    expect(await screen.findByRole('dialog', { name: 'Cambios sin guardar' })).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: 'Cancelar' }));
    await u.click(screen.getByRole('button', { name: /Descartar/ }));
    await u.click(within(await screen.findByRole('dialog', { name: 'Descartar los cambios' })).getByRole('button', { name: 'Descartar cambios' }));
    expect(cell('Colegiatura mensual, Primaria')).toHaveValue('6,450.00');
  });

  it('previews the real public tables with the figures being edited', async () => {
    const u = userEvent.setup();
    await open();
    await u.click(cell('Colegiatura mensual, Primaria'));
    await u.keyboard('7123{Tab}');
    await waitFor(() => expect(document.getElementById('pricing-preview')).toHaveTextContent('$7,123.00'), { timeout: 5000 });
  });

  it('passes axe', async () => {
    const { container } = await open();
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    const violations = (await axe(container)).violations.filter((v) => ['serious', 'critical'].includes(v.impact ?? ''));
    expect(violations).toEqual([]);
  });
});
