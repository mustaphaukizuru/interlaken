import { StrictMode, useState } from 'react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/services/api', () => ({
  api: { get: vi.fn(), post: vi.fn() },
  contentApi: {
    getSettings: vi.fn(),
    adminListPages: vi.fn(),
    adminListForms: vi.fn(),
    adminListMedia: vi.fn(),
    adminUpdateMedia: vi.fn(),
  },
}));

import { contentApi } from '@/services/api';
import { renderWithProviders } from '@/test/renderWithProviders';
import { registerBlockSpecs, type Block, type BlockSpec } from '../blocks/registry';
import '../sections/costos';
import '../sections/galeria';
import { BlockForm } from './BlockForm';
import { requestFieldFocus } from './fieldFocus';
import type { CmsFieldError } from './validation';

const TEST_SPEC: BlockSpec = {
  type: 'prueba.form', label: 'Prueba · Formulario', description: '', group: 'prueba',
  fields: [
    { key: 'title', label: 'Título', kind: 'text', required: true, group: 'Encabezado' },
    { key: 'subtitle', label: 'Subtítulo', kind: 'text', group: 'Encabezado' },
    { key: 'cta', label: 'Botón', kind: 'link' },
    { key: 'items', label: 'Tarjetas', kind: 'items', group: 'Tarjetas', item: [
      { key: 'name', label: 'Nombre', kind: 'text', required: true },
      { key: 'href', label: 'Enlace', kind: 'href' },
    ] },
  ],
  defaults: {},
};

beforeAll(() => registerBlockSpecs([TEST_SPEC]));
beforeEach(() => {
  vi.mocked(contentApi.getSettings).mockResolvedValue({ data: {} } as never);
  vi.mocked(contentApi.adminListPages).mockResolvedValue({ data: [] } as never);
  vi.mocked(contentApi.adminListForms).mockResolvedValue({ data: [{ slug: 'encuesta', title: 'Encuesta de padres', is_published: false }] } as never);
});

/** BlockForm with the props kept in state, like the editor does. */
function Harness({ initial, serverErrors, onProps }: { initial: Block; serverErrors?: CmsFieldError[]; onProps?: (p: Record<string, unknown>) => void }) {
  const [block, setBlock] = useState(initial);
  return <BlockForm block={block} serverErrors={serverErrors} onChange={(props) => { setBlock({ ...block, props }); onProps?.(props); }} />;
}

const byId = (id: string) => document.getElementById(id) as HTMLInputElement;

describe('BlockForm groups (C4)', () => {
  it('renders the price tables as named groups with counts and remembers what is open', async () => {
    const { unmount } = renderWithProviders(<Harness initial={{ id: 'p', type: 'costos.prices', props: {} }} />);
    const first = screen.getByRole('button', { name: /Cómo se paga/ });
    const fees = screen.getByRole('button', { name: /^Inscripción y reinscripción/ });
    expect(first).toHaveAttribute('aria-expanded', 'true');
    expect(fees).toHaveAttribute('aria-expanded', 'false');
    expect(fees).toHaveTextContent('10 de 11'); // «aviso de precios pendientes» is empty for Inscripción
    // «Editar precios» (the tables branch's action) sits above the groups.
    expect(screen.getByText(/Las cifras, los niveles y las políticas se editan/)).toBeInTheDocument();
    await userEvent.click(fees);
    expect(fees).toHaveAttribute('aria-expanded', 'true');
    expect(JSON.parse(localStorage.getItem('cms-field-groups') ?? '{}')['costos.prices']['Inscripción y reinscripción']).toBe(true);
    unmount();
    renderWithProviders(<Harness initial={{ id: 'p', type: 'costos.prices', props: {} }} />);
    expect(screen.getByRole('button', { name: /^Inscripción y reinscripción/ })).toHaveAttribute('aria-expanded', 'true');
  });

  it('a collapsed group shows how many fields need fixing', () => {
    renderWithProviders(<Harness initial={{ id: 't', type: 'prueba.form', props: { title: 'x', items: [{ name: '' }] } }} />);
    const g = screen.getByRole('button', { name: /^Tarjetas/ });
    expect(g).toHaveAttribute('aria-expanded', 'false');
    expect(g).toHaveTextContent(/1\s*campo por corregir/);
  });
});

describe('BlockForm errors (C3)', () => {
  it('flags an empty required field on blur, then clears it as you type', async () => {
    renderWithProviders(<Harness initial={{ id: 't', type: 'prueba.form', props: { title: '' } }} />);
    const title = byId('f-t-title');
    expect(screen.queryByText('Este campo es obligatorio.')).not.toBeInTheDocument();
    await userEvent.click(title);
    // Tab goes to the data chips (one stop), then out of the field.
    await userEvent.tab();
    expect(screen.queryByText('Este campo es obligatorio.')).not.toBeInTheDocument();
    await userEvent.tab();
    expect(await screen.findByText('Este campo es obligatorio.')).toBeInTheDocument();
    expect(title).toHaveAttribute('aria-invalid', 'true');
    expect(title.getAttribute('aria-describedby')).toContain('f-t-title-error');
    await userEvent.type(title, 'Hola');
    expect(screen.queryByText('Este campo es obligatorio.')).not.toBeInTheDocument();
  });

  it('shows a server error next to its field until that field is edited', async () => {
    const errs: CmsFieldError[] = [{ block_id: 't', field: 'subtitle', message: 'Revise este texto.' }];
    renderWithProviders(<Harness initial={{ id: 't', type: 'prueba.form', props: { title: 'x', subtitle: 'y' } }} serverErrors={errs} />);
    expect(screen.getByText('Revise este texto.')).toBeInTheDocument();
    await userEvent.type(byId('f-t-subtitle'), 'z');
    expect(screen.queryByText('Revise este texto.')).not.toBeInTheDocument();
  });

  it('jumps to a field inside a closed group and a list item, and focuses it', async () => {
    renderWithProviders(<Harness initial={{ id: 't', type: 'prueba.form', props: { title: 'x', items: [{ name: 'a' }, { name: '' }, { name: 'c' }, { name: 'd' }] } }} />);
    expect(screen.getByRole('button', { name: /^Tarjetas/ })).toHaveAttribute('aria-expanded', 'false');
    act(() => requestFieldFocus('t', 'items.1.name'));
    await waitFor(() => expect(document.activeElement).toBe(byId('f-t-items.1.name')));
    expect(screen.getByRole('button', { name: /^Tarjetas/ })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Este campo es obligatorio.')).toBeInTheDocument();
  });

  it('a jump requested before the form exists runs when it mounts (also under StrictMode)', async () => {
    requestFieldFocus('t2', 'items.1.name');
    renderWithProviders(<StrictMode><Harness initial={{ id: 't2', type: 'prueba.form', props: { title: 'x', items: [{ name: 'a' }, { name: '' }, { name: 'c' }, { name: 'd' }] } }} /></StrictMode>);
    await waitFor(() => expect(document.activeElement).toBe(byId('f-t2-items.1.name')));
    expect(screen.getByRole('button', { name: /^Tarjetas/ })).toHaveAttribute('aria-expanded', 'true');
  });
});

describe('BlockForm field kinds (C5)', () => {
  it('picks a link destination by page name and stores the same href', async () => {
    const onProps = vi.fn();
    renderWithProviders(<Harness initial={{ id: 't', type: 'prueba.form', props: { title: 'x', cta: { label: 'Ver', href: '' } } }} onProps={onProps} />);
    await userEvent.click(screen.getByRole('button', { name: /Elegir destino de Destino/ }));
    const dialog = await screen.findByRole('dialog', { name: /a dónde lleva/ });
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Buscar página del sitio' }), 'cost');
    await userEvent.click(within(dialog).getByRole('button', { name: /Costos/ }));
    expect(onProps).toHaveBeenLastCalledWith(expect.objectContaining({ cta: { label: 'Ver', href: '/admisiones/costos' } }));
    expect(screen.getByText('Costos')).toBeInTheDocument();
  });

  it('gallery filters: the key follows the button text and the photos follow the key', async () => {
    const onProps = vi.fn();
    renderWithProviders(<Harness onProps={onProps} initial={{
      id: 'g', type: 'galeria.grid', props: {
        photos: [{ image: '/assets/facade.webp', caption: 'Fachada', category: 'vida' }],
        filters: [{ key: 'todas', label: 'Todas' }, { key: 'vida', label: 'Vida' }],
      },
    }} />);
    // The photo's filter is chosen by name; the key is under «Avanzado».
    expect(screen.getByRole('option', { name: 'Vida' })).toBeInTheDocument();
    expect(screen.getAllByText('Avanzado').length).toBeGreaterThan(0);
    await userEvent.type(byId('f-g-filters.1.label'), ' escolar');
    const last = onProps.mock.calls[onProps.mock.calls.length - 1]?.[0] as { filters: { key: string }[]; photos: { category: string }[] };
    expect(last.filters[1].key).toBe('vida-escolar');
    expect(last.photos[0].category).toBe('vida-escolar');
    // «todas» never changes: it shows every photo.
    await userEvent.type(byId('f-g-filters.0.label'), ' las fotos');
    const after = onProps.mock.calls[onProps.mock.calls.length - 1]?.[0] as { filters: { key: string }[] };
    expect(after.filters[0].key).toBe('todas');
  });

  it('the generic form block offers forms by name, not a slug box', async () => {
    renderWithProviders(<Harness initial={{ id: 'f', type: 'form', props: { form: '' } }} />);
    const select = byId('f-f-form');
    expect(select.tagName).toBe('SELECT');
    expect(within(select).getByRole('option', { name: /Ficha de inscripción/ })).toBeInTheDocument();
    expect(await within(select).findByRole('option', { name: 'Encuesta de padres (no publicado)' })).toBeInTheDocument();
  });
});
