import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/services/api', () => ({
  portalApi: {
    importLoyverse: vi.fn(),
  },
}));

vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn() },
}));

import toast from 'react-hot-toast';
import { ImportLoyverseModal, mergeChanges } from './ImportLoyverseModal';
import { portalApi, type RosterChange } from '@/services/api';

const importLoyverse = vi.mocked(portalApi.importLoyverse);

/** 30 diffs the way the API previews them: 10 grade moves, 10 group letters,
 *  5 renames, 3 code spellings, 2 new pupils' links. */
function thirtyChanges(): RosterChange[] {
  const rows: RosterChange[] = [];
  for (let i = 0; i < 10; i++) {
    rows.push({ matricula: `099${10 + i}`, name: `Alumno Grado ${i}`, field: 'grado',
                before: '3° Primaria', after: '4° Primaria', action: 'actualizar' });
  }
  for (let i = 0; i < 10; i++) {
    rows.push({ matricula: `099${20 + i}`, name: `Alumno Grupo ${i}`, field: 'grupo',
                before: '', after: 'A', action: 'actualizar' });
  }
  for (let i = 0; i < 5; i++) {
    rows.push({ matricula: `099${30 + i}`, name: `Alumno Nombre ${i}`, field: 'nombre',
                before: `Juan Antonio Chavez ${i}`, after: `Juan Pablo Chavez ${i}`, action: 'actualizar' });
  }
  for (let i = 0; i < 3; i++) {
    rows.push({ matricula: `099${40 + i}`, name: `Alumno Codigo ${i}`, field: 'codigo',
                before: `099${40 + i}`, after: `ci099${40 + i}`, action: 'actualizar' });
  }
  for (let i = 0; i < 2; i++) {
    rows.push({ matricula: `099${50 + i}`, name: `Nuevo Alumno ${i}`, field: 'vinculo',
                before: '', after: `uuid-${i}`, action: 'crear' });
  }
  return rows;
}

const report = {
  import: {
    total_customers: 392, candidates: 350, created: 2, updated: 28, unchanged: 320, renamed: 5,
    skipped_non_student: 41, skipped_duplicate: 1, balance_seeded: '0', errors: [],
    skipped: [{ customer_code: '177', name: 'ZP-Jessica Soto', reason: 'correo no tiene la forma ci…@interlaken.com.mx' }],
    changes: thirtyChanges(), commit: false,
  },
  link: { linked: 0, already_linked: 350, unmatched_students: [], changes: [] },
};

const dataRows = () => within(screen.getByRole('table')).getAllByRole('row').slice(1);

describe('ImportLoyverseModal — the preview lists every change per student', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    importLoyverse.mockResolvedValue({ data: report } as never);
  });

  it('renders all 30 diffs with field, antes and después, plus counts per field', async () => {
    render(<ImportLoyverseModal open onClose={() => {}} />);
    expect(await screen.findByRole('table')).toBeInTheDocument();
    expect(dataRows()).toHaveLength(30);

    // A rename shows exactly what the office will see change.
    const rename = dataRows().find((r) => within(r).queryByText('Juan Pablo Chavez 0'))!;
    expect(within(rename).getByText('Juan Antonio Chavez 0')).toBeInTheDocument();
    expect(within(rename).getByText('Nombre')).toBeInTheDocument();
    // A new pupil is labelled as an alta.
    expect(screen.getAllByText(/Alta · Vínculo/)).toHaveLength(2);

    const chips = screen.getByRole('group', { name: /Filtrar por campo/ });
    expect(within(chips).getByRole('button', { name: 'Todos (30)' })).toBeInTheDocument();
    expect(within(chips).getByRole('button', { name: 'Grado (10)' })).toBeInTheDocument();
    expect(within(chips).getByRole('button', { name: 'Nombre (5)' })).toBeInTheDocument();
    expect(within(chips).getByRole('button', { name: 'Código Loyverse (3)' })).toBeInTheDocument();

    // Summary counts and the skip reasons are still there.
    expect(screen.getByText('28')).toBeInTheDocument();
    expect(screen.getByText(/42 cliente\(s\) de Loyverse omitidos/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Importar 30 cambio\(s\)/ })).toBeInTheDocument();
  });

  it('filters by field chip and by the search box', async () => {
    const user = userEvent.setup();
    render(<ImportLoyverseModal open onClose={() => {}} />);
    await screen.findByRole('table');

    await user.click(screen.getByRole('button', { name: 'Grupo (10)' }));
    expect(dataRows()).toHaveLength(10);
    expect(screen.getByText('10 de 30 cambio(s).')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Todos (30)' }));
    await user.type(screen.getByRole('textbox', { name: /Buscar en los cambios/ }), 'ci09941');
    expect(dataRows()).toHaveLength(1);
    expect(within(dataRows()[0]).getByText('Alumno Codigo 1')).toBeInTheDocument();

    await user.clear(screen.getByRole('textbox', { name: /Buscar en los cambios/ }));
    await user.type(screen.getByRole('textbox', { name: /Buscar en los cambios/ }), 'nadie');
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByText('Ningún cambio coincide con la búsqueda')).toBeInTheDocument();
  });

  it('commits with the same call and reports the rename count', async () => {
    const user = userEvent.setup();
    importLoyverse
      .mockResolvedValueOnce({ data: report } as never)
      .mockResolvedValueOnce({ data: { ...report, import: { ...report.import, commit: true } } } as never);
    const onImported = vi.fn();
    render(<ImportLoyverseModal open onClose={() => {}} onImported={onImported} />);
    await user.click(await screen.findByRole('button', { name: /Importar 30 cambio\(s\)/ }));

    await waitFor(() => expect(importLoyverse).toHaveBeenLastCalledWith(true));
    expect(vi.mocked(toast.success)).toHaveBeenCalledWith(
      'Importación: 2 creado(s), 28 actualizado(s), 5 nombre(s); 0 vinculado(s).');
    expect(onImported).toHaveBeenCalled();
  });
});

describe('mergeChanges', () => {
  it('adds the link pass vinculo rows without duplicating what the import already lists', () => {
    const imp: RosterChange[] = [
      { matricula: '1', name: 'A', field: 'vinculo', before: '', after: 'u1', action: 'actualizar' },
    ];
    const link = [
      { matricula: '1', name: 'A', field: 'vinculo' as const, before: '', after: 'u1' },
      { matricula: '2', name: 'B', field: 'vinculo' as const, before: '', after: 'u2' },
      { matricula: '3', name: 'C' },                    // pre-2026-09-24 shape: no field
    ];
    expect(mergeChanges(imp, link).map((c) => c.matricula)).toEqual(['1', '2']);
    expect(mergeChanges(imp, link)[1]).toMatchObject({ field: 'vinculo', after: 'u2', action: 'actualizar' });
  });
});
