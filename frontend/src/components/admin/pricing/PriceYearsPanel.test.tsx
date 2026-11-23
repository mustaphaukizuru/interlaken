import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/renderWithProviders';
import { PriceYearsPanel } from './PriceYearsPanel';
import { PriceYearsReminder } from './PriceYearsReminder';

vi.mock('@/services/pricingAdminApi', () => ({ pricingAdminApi: { years: vi.fn(), setYears: vi.fn() } }));
vi.mock('@/components/admin/PendingList', () => ({ usePendingCounters: vi.fn() }));
import { pricingAdminApi } from '@/services/pricingAdminApi';
import { usePendingCounters } from '@/components/admin/PendingList';

const Y = new Date().getFullYear();
const SHEET = { fees: Y + 1, tuition: Y + 1, insurance: Y, extras: Y, daycare: Y };

beforeEach(() => {
  localStorage.clear();
  vi.mocked(pricingAdminApi.years).mockResolvedValue({ data: { years: SHEET, admissions_next_from_month: 1 } } as never);
  vi.mocked(pricingAdminApi.setYears).mockResolvedValue({ data: {} } as never);
  vi.mocked(usePendingCounters).mockReturnValue({ data: { precios: 3, precios_anio: Y + 1 } } as never);
});

describe('Año de los precios (Costos y precios)', () => {
  it('names what is missing and publishes it in one confirmed step', async () => {
    renderWithProviders(<PriceYearsPanel />);
    expect(await screen.findByText(`Faltan los precios ${Y + 1} de Seguros y credenciales, Extraescolares y Estancia. Actualice sus cifras en las pestañas de abajo y después publíquelos aquí.`)).toBeInTheDocument();
    expect(screen.getAllByText('Al día')).toHaveLength(2);
    await userEvent.click(screen.getByRole('button', { name: `Publicar precios ${Y + 1} en las 3 secciones` }));
    const dialog = await screen.findByRole('dialog', { name: `¿Publicar los precios ${Y + 1}?` });
    expect(pricingAdminApi.setYears).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: `Publicar precios ${Y + 1}` }));
    expect(pricingAdminApi.setYears).toHaveBeenCalledWith({ insurance: Y + 1, extras: Y + 1, daycare: Y + 1 });
  });

  it('a single section can be published or corrected from its row', async () => {
    renderWithProviders(<PriceYearsPanel />);
    const row = (await screen.findByText('Estancia')).closest('li')!;
    await userEvent.selectOptions(within(row).getByLabelText('Año de los precios de Estancia'), String(Y - 1));
    const dialog = await screen.findByRole('dialog', { name: `¿Publicar los precios ${Y - 1}?` });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    expect(pricingAdminApi.setYears).not.toHaveBeenCalled();
  });
});

describe('dashboard reminder', () => {
  it('asks once a day while prices are missing', async () => {
    const { unmount } = renderWithProviders(<PriceYearsReminder />);
    const dialog = await screen.findByRole('dialog', { name: `Faltan los precios del ciclo ${Y + 1}–${Y + 2}` });
    expect(await within(dialog).findByText('Seguros y credenciales, Extraescolares y Estancia')).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: 'Ir a Costos y precios' })).toHaveAttribute('href', '/admin/costos');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Recordar mañana' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    unmount();
    renderWithProviders(<PriceYearsReminder />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('stays quiet when nothing is missing (and for staff, who get no counter)', () => {
    vi.mocked(usePendingCounters).mockReturnValue({ data: {} } as never);
    renderWithProviders(<PriceYearsReminder />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
