import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/services/api', () => ({
  api: { get: vi.fn(), post: vi.fn() },
  contentApi: { getSettings: vi.fn(), adminListPages: vi.fn(), adminListMedia: vi.fn(), adminUpdateMedia: vi.fn() },
}));

import { api, contentApi } from '@/services/api';
import { renderWithProviders } from '@/test/renderWithProviders';
import type { Block } from '../../blocks/registry';
import { PageErrorSummary } from '../PageErrorSummary';
import { IconField } from './IconField';
import { ImageField } from './ImageField';
import { MarkTextField } from './MarkTextField';
import { RichTextEditor } from './RichTextEditor';

const asset = (over: Record<string, unknown> = {}) => ({ id: 42, filename: 'patio.jpg', alt: '', width: 2000, height: 1200, urls: { thumb: '/t/42', original: '/o/42' }, ...over });

beforeEach(() => {
  vi.mocked(contentApi.getSettings).mockResolvedValue({ data: {} } as never);
  vi.mocked(contentApi.adminListPages).mockResolvedValue({ data: [] } as never);
  vi.mocked(contentApi.adminListMedia).mockResolvedValue({ data: { count: 0, results: [] } } as never);
});

describe('IconField', () => {
  it('shows icons by Spanish name, searches, moves with arrows and closes with Escape', async () => {
    const onChange = vi.fn();
    renderWithProviders(<IconField id="i" label="Ícono" value="Users" onChange={onChange} />);
    const trigger = screen.getByRole('button', { name: /Ícono: Personas/ });
    await userEvent.click(trigger);
    const dialog = await screen.findByRole('dialog', { name: /Elegir ícono/ });
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Buscar ícono' }), 'pago');
    const grid = within(dialog).getByRole('list', { name: 'Íconos' });
    expect(within(grid).getByRole('button', { name: /Moneda/ })).toBeInTheDocument();
    expect(within(grid).queryByRole('button', { name: /Personas/ })).not.toBeInTheDocument();
    const first = within(grid).getAllByRole('button')[0];
    first.focus();
    fireEvent.keyDown(grid, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(within(grid).getAllByRole('button')[1]);
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
    await userEvent.click(trigger);
    await userEvent.click(await screen.findByRole('button', { name: /Birrete/ }));
    expect(onChange).toHaveBeenCalledWith('GraduationCap');
  });
});

describe('ImageField', () => {
  function Harness({ initial = null as number | string | null, minWidth = 1600 }) {
    const [v, setV] = useState<number | string | null>(initial);
    return <ImageField id="img" label="Foto" value={v} onChange={setV} minWidth={minWidth} altError={v ? 'Falta la descripción de la imagen (texto alternativo). Sin ella no se puede publicar.' : undefined} />;
  }

  it('uploads in place with progress, then asks for the alt text right there', async () => {
    let finish: (v: unknown) => void = () => undefined;
    vi.mocked(api.post).mockImplementation(((_url: string, _form: FormData, cfg: { onUploadProgress: (e: { loaded: number; total: number }) => void }) => {
      cfg.onUploadProgress({ loaded: 50, total: 100 });
      return new Promise((r) => { finish = r; });
    }) as never);
    vi.mocked(api.get).mockResolvedValue({ data: asset() } as never);
    renderWithProviders(<Harness />);
    const file = new File(['x'], 'patio.jpg', { type: 'image/jpeg' });
    await userEvent.upload(document.querySelector('input[type="file"]') as HTMLInputElement, file);
    expect(await screen.findByRole('progressbar', { name: 'Subiendo patio.jpg' })).toHaveAttribute('aria-valuenow', '50');
    finish({ data: asset() });
    const alt = await screen.findByLabelText(/Descripción de la foto/);
    await waitFor(() => expect(document.activeElement).toBe(alt));
    expect(screen.getByText(/Sin ella no se puede publicar/)).toBeInTheDocument();
    expect(screen.getByText('2000 × 1200 px')).toBeInTheDocument();
    vi.mocked(contentApi.adminUpdateMedia).mockResolvedValue({ data: asset({ alt: 'Patio' }) } as never);
    await userEvent.type(alt, 'Patio');
    await userEvent.tab();
    await waitFor(() => expect(contentApi.adminUpdateMedia).toHaveBeenCalledWith(42, { alt: 'Patio' }));
    expect(screen.queryByText(/Sin ella no se puede publicar/)).not.toBeInTheDocument();
  });

  it('rejects files over the limits like «Medios» and warns when a photo is too small for its place', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: asset({ width: 640, height: 480, alt: 'Patio' }) } as never);
    renderWithProviders(<Harness initial={42} />);
    expect(await screen.findByText(/mide 640 px de ancho; aquí se recomienda al menos 1600 px/)).toBeInTheDocument();
    const pdf = new File(['x'], 'doc.pdf', { type: 'application/pdf' });
    fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [pdf] } });
    expect(await screen.findByText('Solo imágenes JPG, PNG, WebP o GIF.')).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });
});

describe('MarkTextField', () => {
  function Harness({ marks, initial }: { marks: ('bold' | 'link')[]; initial: string }) {
    const [v, setV] = useState(initial);
    return <MarkTextField id="m" label="Párrafos" value={v} onChange={setV} marks={marks} />;
  }

  it('writes **negritas** from the toolbar and previews it', async () => {
    renderWithProviders(<Harness marks={['bold']} initial="Lee y Produce impulsa la lectura." />);
    const ta = screen.getByRole('textbox', { name: /Párrafos/ }) as HTMLTextAreaElement;
    ta.focus();
    ta.setSelectionRange(0, 13);
    await userEvent.click(screen.getByRole('button', { name: 'Negritas' }));
    expect(ta.value).toBe('**Lee y Produce** impulsa la lectura.');
    const preview = screen.getByRole('group', { name: 'Vista previa de Párrafos' });
    expect(within(preview).getByText('Lee y Produce').tagName).toBe('STRONG');
    expect(screen.queryByRole('button', { name: 'Enlace' })).not.toBeInTheDocument();
  });

  it('writes [texto](/ruta) from the link picker', async () => {
    renderWithProviders(<Harness marks={['link']} initial="Vea Contacto." />);
    const ta = screen.getByRole('textbox', { name: /Párrafos/ }) as HTMLTextAreaElement;
    ta.focus();
    ta.setSelectionRange(4, 12);
    await userEvent.click(screen.getByRole('button', { name: 'Enlace' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /^Contacto/ }));
    expect(ta.value).toBe('Vea [Contacto](/contacto).');
  });
});

describe('RichTextEditor', () => {
  it('has a formatting toolbar and stores sanitizer-safe HTML', async () => {
    const onChange = vi.fn();
    renderWithProviders(<RichTextEditor id="r" label="Contenido" value="<p>Hola</p>" onChange={onChange} />);
    const toolbar = screen.getByRole('toolbar', { name: 'Formato de Contenido' });
    for (const name of ['Negritas', 'Cursiva', 'Subtítulo', 'Lista con viñetas', 'Lista numerada', 'Enlace']) expect(within(toolbar).getByRole('button', { name })).toBeInTheDocument();
    const box = screen.getByRole('textbox', { name: /Contenido/ });
    expect(box.innerHTML).toBe('<p>Hola</p>');
    box.innerHTML = '<div><b>Hola</b> <span style="color:red">mundo</span></div>';
    fireEvent.input(box);
    expect(onChange).toHaveBeenLastCalledWith('<p><strong>Hola</strong> <span>mundo</span></p>');
  });
});

describe('PageErrorSummary', () => {
  it('lists the fields to fix by section and field name, and jumps to each', async () => {
    const onJump = vi.fn();
    const blocks: Block[] = [
      { id: 'a', type: 'hero', props: { title: '' } },
      { id: 'b', type: 'hero', props: { title: '' }, hidden: true },
      { id: 'c', type: 'cta_band', props: { title: 'x', cta: { label: 'Ir', href: 'contacto' } } },
    ];
    renderWithProviders(<PageErrorSummary blocks={blocks} serverErrors={[{ block_id: 'c', field: 'title', message: 'Del servidor.' }]} onJump={onJump} />);
    expect(screen.getByRole('heading', { name: 'Antes de publicar, corrija 3 campos' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /1\. Portada \(hero\) › Título/ }));
    expect(onJump).toHaveBeenCalledWith('a', 'title');
    expect(screen.getByRole('button', { name: /3\. Llamado a la acción › Botón/ })).toBeInTheDocument();
    expect(screen.getByText('Del servidor.')).toBeInTheDocument();
  });

  it('renders nothing when every field is fine', () => {
    const { container } = renderWithProviders(<PageErrorSummary blocks={[{ id: 'a', type: 'hero', props: { title: 'Hola' } }]} onJump={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});
