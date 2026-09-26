import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn(), loading: vi.fn(() => 't'), dismiss: vi.fn() } }));
vi.mock('@/services/AdminContentApi', () => ({
  calendarAdminApi: { list: vi.fn(), export: vi.fn(), bulk: vi.fn(), import: { template: vi.fn(), upload: vi.fn() } },
  calendarIcsUrl: () => 'https://interlaken.edu.mx/api/v1/content/calendar.ics',
}));
vi.mock('@/services/api', () => ({
  contentApi: { adminDeleteCalendar: vi.fn(), adminCreateCalendar: vi.fn(), adminUpdateCalendar: vi.fn() },
  downloadBlob: vi.fn(),
}));

import toast from 'react-hot-toast';
import { calendarAdminApi } from '@/services/AdminContentApi';
import { renderWithProviders } from '@/test/renderWithProviders';
import { stubViewport } from '@/test/viewport';
import AdminCalendar from './AdminCalendar';

const list = vi.mocked(calendarAdminApi.list);
const bulk = vi.mocked(calendarAdminApi.bulk);
const EVENTS = [
  { id: 7, title: 'Examen bimestral', kind: 'exam', kind_label: 'Evaluaciones', start_date: '2026-10-05', end_date: null, level: 'primaria', description: '', is_published: false },
];

beforeEach(() => {
  vi.clearAllMocks();
  stubViewport(1280);
  list.mockResolvedValue({ data: { count: 1, next: null, previous: null, results: EVENTS } } as never);
});

describe('AdminCalendar', () => {
  it('maps URL filters to the API and shows dates as DD/MM/YYYY', async () => {
    renderWithProviders(<AdminCalendar />, { route: '/admin/calendario?tipo=exam&nivel=primaria&publicado=0&desde=2026-10-01&hasta=2026-10-31&orden=-start' });
    const row = await screen.findByRole('row', { name: /Examen bimestral/ });
    expect(within(row).getByText('05/10/2026')).toBeInTheDocument();
    expect(within(row).getByText('Borrador')).toBeInTheDocument();
    expect(list).toHaveBeenCalledWith({
      page: 1, q: undefined, kind: 'exam', level: 'primaria', published: '0', from: '2026-10-01', to: '2026-10-31', ordering: '-start',
    });
  });

  it('copies the public .ics link', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderWithProviders(<AdminCalendar />, { route: '/admin/calendario' });
    await screen.findByText('Examen bimestral');
    await user.click(screen.getByRole('button', { name: /Copiar liga .ics/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('https://interlaken.edu.mx/api/v1/content/calendar.ics'));
    expect(vi.mocked(toast.success)).toHaveBeenCalled();
  });

  it('opens the import dialog with the expected headers', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AdminCalendar />, { route: '/admin/calendario' });
    await screen.findByText('Examen bimestral');
    await user.click(screen.getByRole('button', { name: /^Importar$/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('titulo')).toBeInTheDocument();
    expect(within(dialog).getByText('publicado')).toBeInTheDocument();
    expect(within(dialog).getByText(/DD\/MM\/AAAA/)).toBeInTheDocument();
  });

  it('bulk publish goes through the dry-run plan', async () => {
    const user = userEvent.setup();
    bulk.mockResolvedValue({ data: { action: 'publish', requested: 1, ok: 1, failed: [], skipped: [], dry_run: true } } as never);
    renderWithProviders(<AdminCalendar />, { route: '/admin/calendario' });
    await screen.findByText('Examen bimestral');
    await user.click(screen.getByRole('checkbox', { name: 'Seleccionar evento Examen bimestral' }));
    await user.click(within(screen.getByRole('region', { name: 'Acciones en lote' })).getByRole('button', { name: 'Publicar' }));
    expect(await screen.findByRole('button', { name: 'Publicar (1)' })).toBeEnabled();
    expect(bulk).toHaveBeenCalledWith(expect.objectContaining({ action: 'publish', ids: [7], dry_run: true }));
  });
});
