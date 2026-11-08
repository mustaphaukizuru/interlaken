import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { AuditTimeline } from './AuditTimeline';
import type { AuditLogEntry } from '@/types';

const entry = (over: Partial<AuditLogEntry>): AuditLogEntry => ({
  id: 1, actor: 3, actor_label: 'paola@interlaken.com.mx', action: 'update', action_display: 'Modificación',
  object_type: 'accounts.studentprofile', object_id: '7', context: '', changes: {}, created_at: '2026-11-08T16:00:00Z',
  ...over,
} as AuditLogEntry);

const items = () => screen.getAllByRole('listitem').filter((li) => li.parentElement?.tagName === 'OL');

describe('AuditTimeline', () => {
  it('reads each change as a short sentence with office labels', () => {
    render(<AuditTimeline entries={[
      entry({ id: 1, changes: { grade: ['1° Primaria', '2° Primaria'], status: ['active', 'withdrawn'], via: 'portal' }, context: 'portal: edición de alumno' }),
      entry({ id: 2, action: 'delete', actor_label: '', created_at: '2026-11-07T10:00:00Z', changes: { outcome: 'erased', reason: 'sin historial' } }),
    ]} />);
    expect(screen.getByText('Grado: 1° Primaria → 2° Primaria')).toBeInTheDocument();
    expect(screen.getByText(/^Estado: .+ → .+$/)).toBeInTheDocument();
    // Fields the office does not read (via, internal keys) are left out.
    expect(screen.queryByText(/via/)).toBeNull();
    // The screen that made the change, in its own words.
    expect(screen.getByText('Edición de alumno')).toBeInTheDocument();
    expect(screen.getByText('Eliminación')).toBeInTheDocument();
    expect(screen.getByText('Motivo: sin historial')).toBeInTheDocument();
    // A row without an actor was the system (a sync or a scheduled job).
    expect(screen.getByText('· Sistema')).toBeInTheDocument();
  });

  it('folds the rows one archive wrote into a single entry named «Archivo»', () => {
    render(<AuditTimeline entries={[
      entry({ id: 30, action: 'delete', created_at: '2026-11-08T17:31:02Z', context: 'bulk:accounts.studentprofile:delete',
        changes: { outcome: 'archived', reason: 'tiene saldo en cafetería', status: ['active', 'withdrawn'], archived: [false, true], is_active: [true, false], sessions_revoked: 0 } }),
      entry({ id: 29, action: 'update', created_at: '2026-11-08T17:31:01Z', context: 'student.personal', changes: { is_active: [true, false], status: ['active', 'withdrawn'] } }),
      entry({ id: 28, action: 'permission', object_type: 'accounts.user', object_id: '40', created_at: '2026-11-08T17:31:01Z', context: 'account.permission', changes: { is_active: [true, false] } }),
      entry({ id: 20, created_at: '2026-11-08T15:00:00Z', context: 'student.personal', changes: { group: ['B', 'A'] } }),
    ]} />);

    const [archive, earlier] = items();
    expect(items()).toHaveLength(2);
    expect(within(archive).getByText('Archivo')).toBeInTheDocument();
    expect(within(archive).queryByText('Eliminación')).toBeNull();
    // Each change once, however many rows repeated it; no "Sesiones cerradas: 0", no raw tags.
    expect(within(archive).getAllByText(/^Estado: /)).toHaveLength(1);
    expect(within(archive).getAllByText(/^Puede entrar: /)).toHaveLength(1);
    expect(within(archive).getByText('Motivo: tiene saldo en cafetería')).toBeInTheDocument();
    expect(within(archive).queryByText(/Sesiones cerradas/)).toBeNull();
    expect(within(archive).queryByText(/bulk:|student\.personal|Ficha del alumno/)).toBeNull();

    expect(within(earlier).getByText('Cambio')).toBeInTheDocument();
    expect(within(earlier).getByText('Ficha del alumno')).toBeInTheDocument();
  });

  it('a restore reads «Restauración»; the activity feed names what each entry is about', () => {
    render(<AuditTimeline entries={[
      entry({ id: 5, object_label: 'Ana Ríos', changes: { outcome: 'restored', archived: [true, false] } }),
      entry({ id: 4, object_label: 'Beto Ruiz', created_at: '2026-11-08T15:59:59Z', changes: { group: ['A', 'B'] } }),
    ]} />);
    // Different subjects stay apart even a second apart.
    expect(items()).toHaveLength(2);
    expect(screen.getByText('Restauración')).toBeInTheDocument();
    expect(screen.getByText('Ana Ríos')).toBeInTheDocument();
    expect(screen.getByText('Beto Ruiz')).toBeInTheDocument();
  });

  it('automated rows read «Sistema»; the actor can be left out of a personal feed', () => {
    const { rerender } = render(<AuditTimeline entries={[entry({ actor_label: 'system:sync_roster', changes: { group: ['A', 'B'] } })]} />);
    expect(screen.getByText('· Sistema')).toBeInTheDocument();
    rerender(<AuditTimeline showActor={false} entries={[entry({ changes: { group: ['A', 'B'] } })]} />);
    expect(screen.queryByText(/paola@/)).toBeNull();
  });

  it('shows the empty message when there is nothing yet', () => {
    render(<AuditTimeline entries={[]} empty="Este expediente no tiene cambios registrados todavía." />);
    expect(screen.getByText('Este expediente no tiene cambios registrados todavía.')).toBeInTheDocument();
  });
});
