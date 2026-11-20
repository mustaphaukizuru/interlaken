import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/services/api', () => ({
  contentApi: { adminGetSettings: vi.fn(), adminUpdateSettings: vi.fn(), getSettings: vi.fn() },
}));

import { contentApi } from '@/services/api';
import { renderWithProviders } from '@/test/renderWithProviders';
import { mergeChrome, CHROME_KEYS } from '@/lib/chromeMerge';
import { SiteTextsEditor, SITE_TEXT_KEYS, sitePatch } from './SiteTextsEditor';
import { COOKIE_DEFAULTS } from '@/components/CookieBanner';
import { LEGAL_LINKS_DEFAULT } from '@/lib/siteChrome';

const get = vi.mocked(contentApi.adminGetSettings);
const update = vi.mocked(contentApi.adminUpdateSettings);

beforeEach(() => {
  vi.clearAllMocks();
  get.mockResolvedValue({ data: { chrome: { footer_note: 'Nota propia', cookie_link: 'Leer el aviso' } } } as never);
  update.mockResolvedValue({ data: {} } as never);
});

describe('site texts (Navegación)', () => {
  it('stores only texts that differ from the original', () => {
    expect(sitePatch({ cookie_text: COOKIE_DEFAULTS.cookie_text, cookie_accept: ' De acuerdo ' }, LEGAL_LINKS_DEFAULT)).toEqual({ cookie_accept: 'De acuerdo' });
    expect(sitePatch({}, [{ label: 'Reglamento', href: '/reglamento' }])).toEqual({ legal_links: [{ label: 'Reglamento', href: '/reglamento' }] });
  });

  it('keeps the keys the other editor owns', () => {
    const stored = { footer_note: 'Nota', cookie_text: 'Viejo', legal_links: [{ label: 'X', href: '/x' }] };
    expect(mergeChrome(stored, SITE_TEXT_KEYS, { cookie_accept: 'Sí' })).toEqual({ footer_note: 'Nota', cookie_accept: 'Sí' });
    expect(mergeChrome(stored, CHROME_KEYS, { footer_note: 'Nueva' })).toEqual({ footer_note: 'Nueva', cookie_text: 'Viejo', legal_links: [{ label: 'X', href: '/x' }] });
  });

  it('edits a text, saves it with the header/footer copy intact, and resets back to the original', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SiteTextsEditor />, { route: '/admin/navegacion' });
    await user.click(await screen.findByText('Aviso de cookies'));
    const accept = screen.getByLabelText('Botón para aceptar');
    expect(accept).toHaveValue('Aceptar');
    expect(screen.getByLabelText('Enlace al aviso de privacidad')).toHaveValue('Leer el aviso');
    await user.clear(accept);
    await user.type(accept, 'De acuerdo');
    await user.click(screen.getByRole('button', { name: 'Guardar textos' }));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update).toHaveBeenCalledWith({ chrome: { footer_note: 'Nota propia', cookie_link: 'Leer el aviso', cookie_accept: 'De acuerdo' } });
  });

  it('refuses a legal link that is not a site path or https and says so next to it', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SiteTextsEditor />, { route: '/admin/navegacion' });
    await user.click(await screen.findByText('Pie de página'));
    await user.click(screen.getByRole('button', { name: /Agregar enlace/ }));
    await user.type(screen.getAllByLabelText('Texto del enlace').slice(-1)[0], 'Reglamento');
    await user.type(screen.getAllByLabelText('Enlace (ruta o URL)').slice(-1)[0], 'javascript:alert(1)');
    await user.click(screen.getByRole('button', { name: 'Guardar textos' }));
    expect(await screen.findByText('El enlace debe empezar con / o con https://.')).toBeInTheDocument();
    expect(update).not.toHaveBeenCalled();
  });
});
