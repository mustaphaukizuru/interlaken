import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { ReviewDialog } from './ReviewDialog';
import { GLUED, ONLY_TUITION, PRIVATE_LINK, SEO_ADVICE, report } from './review.fixtures';
import type { ReviewReport } from './types';

function renderDialog(r: ReviewReport | null, over: Partial<Parameters<typeof ReviewDialog>[0]> = {}) {
  const props = {
    open: true, onClose: vi.fn(), pageTitle: 'Costos', report: r, loading: false, error: null, onRetry: vi.fn(),
    onFix: vi.fn(), onJump: vi.fn(), canPublish: true, onPublish: vi.fn(), publishing: false, ...over,
  };
  // No providers needed: rerender keeps the same dialog element.
  const utils = render(<ReviewDialog {...props} />);
  return { ...utils, props, dialog: screen.getByRole('dialog', { name: 'Revisión antes de publicar' }) };
}

describe('ReviewDialog («Revisión antes de publicar»)', () => {
  it('names every slip of the incident, with what visitors would read and the fix', () => {
    const { dialog } = renderDialog(report());
    expect(within(dialog).getByRole('status', { name: '' })).toHaveTextContent('«Costos» todavía no se puede publicar: hay 1 problema por corregir y 3 advertencias.');
    const errors = within(dialog).getByRole('region', { name: /Por corregir \(1\)/ });
    expect(errors).toHaveTextContent('Sección 2 · Costos · Tablas de precios › Llamado final: botón principal');
    expect(errors).toHaveTextContent('La ficha de inscripción es personal');
    expect(within(errors).getByRole('button', { name: 'Cambiar por «Agendar visita»' })).toBeInTheDocument();
    const warnings = within(dialog).getByRole('region', { name: /Advertencias \(3\)/ });
    expect(warnings).toHaveTextContent('Hoy se vería: «Precios 20262026»');
    expect(warnings).toHaveTextContent('Con la corrección quedará: «Precios 2026»');
    expect(within(warnings).getAllByRole('button', { name: 'Vaciar' })).toHaveLength(2);
  });

  it('«Qué cambia» shows the rendered text, before and now, and the stored code', () => {
    const { dialog } = renderDialog(report());
    const changes = within(dialog).getByRole('region', { name: /Qué cambia/ });
    expect(changes).toHaveTextContent('Comparado con lo que el sitio muestra hoy (la versión publicada).');
    const row = changes.querySelector('[data-change-field="daycareSubtitle"]') as HTMLElement;
    expect(row).toHaveTextContent('Estancia: subtítulo');
    expect(within(row).getByText('Precios 2026')).toBeInTheDocument();          // Antes
    expect(within(row).getByText('Precios 20262026')).toBeInTheDocument();      // Ahora, as visitors read it
    expect(row).toHaveTextContent('Guardado como: Precios 2026{{anio}}');
    expect(changes.querySelector('[data-change-field="feesLabel"]')).toHaveTextContent('(vacío)');
  });

  it('quick fixes and «Ir al campo» hand the issue back', async () => {
    const { dialog, props } = renderDialog(report());
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cambiar por «Agendar visita»' }));
    expect(props.onFix).toHaveBeenCalledWith(PRIVATE_LINK);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Quitar {{anio}}' }));
    expect(props.onFix).toHaveBeenLastCalledWith(GLUED);
    await userEvent.click(within(dialog).getAllByRole('button', { name: /Ir al campo/ })[1]);
    expect(props.onJump).toHaveBeenCalledWith(GLUED);
  });

  it('«Publicar» needs no errors, then «Entiendo las advertencias»', async () => {
    const { dialog, rerender, props } = renderDialog(report());
    const publish = () => within(dialog).getByRole('button', { name: /^Publicar$/ });
    expect(publish()).toBeDisabled();
    expect(within(dialog).queryByRole('checkbox', { name: 'Entiendo las advertencias' })).not.toBeInTheDocument();
    expect(dialog).toHaveTextContent('Corrija el problema marcado en rojo para poder publicar.');

    const onlyWarnings = report({ errors: [], warnings: [GLUED, ONLY_TUITION], suggestions: [SEO_ADVICE] });
    rerender(<ReviewDialog {...props} report={onlyWarnings} />);
    expect(publish()).toBeDisabled();
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Entiendo las advertencias' }));
    expect(publish()).toBeEnabled();
    await userEvent.click(publish());
    expect(props.onPublish).toHaveBeenCalledWith([GLUED.key, ONLY_TUITION.key]);

    // A new warning after the tick: the tick no longer counts.
    rerender(<ReviewDialog {...props} report={report({ errors: [], warnings: [GLUED] })} />);
    expect(within(dialog).getByRole('checkbox', { name: 'Entiendo las advertencias' })).not.toBeChecked();
    expect(publish()).toBeDisabled();
  });

  it('suggestions never ask for the tick', async () => {
    const { dialog, props } = renderDialog(report({ errors: [], warnings: [], suggestions: [SEO_ADVICE], changes: [] }));
    expect(dialog).toHaveTextContent('«Costos»: todo en orden, lista para publicar.');
    expect(dialog).toHaveTextContent('Sugerencias (1)');
    expect(dialog).toHaveTextContent('No hay cambios: el borrador es igual a lo que muestra el sitio.');
    await userEvent.click(within(dialog).getByRole('button', { name: /^Publicar$/ }));
    expect(props.onPublish).toHaveBeenCalledWith([]);
  });

  it('staff ask for approval instead, and «Descartar cambios» asks first', async () => {
    const onRequest = vi.fn();
    const onConfirm = vi.fn();
    const { dialog } = renderDialog(report({ errors: [] }), { canPublish: false, onRequest, discard: { onConfirm, busy: false, version: 4 } });
    expect(within(dialog).queryByRole('button', { name: /^Publicar$/ })).not.toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: /Solicitar aprobación/ }));
    expect(onRequest).toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: /Descartar cambios/ }));
    const confirm = await screen.findByRole('dialog', { name: '¿Descartar los cambios sin publicar?' });
    expect(confirm).toHaveTextContent('(versión 4)');
    await userEvent.click(within(confirm).getByRole('button', { name: 'Descartar cambios' }));
    expect(onConfirm).toHaveBeenCalled();
  });

  it('passes axe (serious and critical)', async () => {
    const { container } = renderDialog(report({ suggestions: [SEO_ADVICE] }));
    const violations = (await axe(container)).violations.filter((v) => ['serious', 'critical'].includes(v.impact ?? ''));
    expect(violations).toEqual([]);
  });
});

describe('ReviewDialog: a suggestion with a quick fix (QA 2026-11-23)', () => {
  const HERO: ReviewReport['suggestions'][number] = {
    level: 'warning', code: 'hero_repeats_header', key: 'hero_repeats_header:h:primary', acknowledge: false,
    block_index: 0, block_id: 'h', block_label: 'Inicio · Portada',
    message: 'Sección 1 (Inicio · Portada), campo «Botón principal»: repite un botón del encabezado.',
    field: 'primary', field_label: 'Botón principal', field_message: 'Repite un botón del encabezado.',
    value: { label: 'Agendar visita', href: '/agendar-visita' }, preview: 'Agendar visita',
    fix: { kind: 'restore', label: 'Usar «Proceso de admisión»', value: { label: 'Proceso de admisión', href: '/admisiones' }, preview: 'Proceso de admisión' },
  };

  it('shows the fix button, open, and applies it; publishing needs no tick', async () => {
    const { dialog, props } = renderDialog(report({ errors: [], warnings: [], suggestions: [HERO], changes: [] }));
    const fix = within(dialog).getByRole('button', { name: 'Usar «Proceso de admisión»' });
    expect(fix).toBeVisible();
    await userEvent.click(fix);
    expect(props.onFix).toHaveBeenCalledWith(HERO);
    expect(within(dialog).queryByRole('checkbox', { name: 'Entiendo las advertencias' })).not.toBeInTheDocument();
  });

  it('a suggestion without a fix stays a plain line, closed', () => {
    const { dialog } = renderDialog(report({ errors: [], warnings: [], suggestions: [SEO_ADVICE], changes: [] }));
    expect(dialog.querySelector('details')).not.toHaveAttribute('open');
    expect(within(dialog).queryByRole('button', { name: /Usar/ })).not.toBeInTheDocument();
  });
});
