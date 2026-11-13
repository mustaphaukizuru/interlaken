import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { GraduationCap, Info, Pencil, Unlink, UserPlus, UserRound } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useFamilyDissolve, useFamilyRemoveStudent, useFamilyUpdate } from '@/hooks/queries/families';
import { apiErrorMessage, apiFieldErrors } from '@/lib/apiErrors';
import type { FamilyDetail, FamilyLogin, FamilyStudent } from '@/services/familiesApi';
import { gradeLine, initial, lastLoginLabel } from './familyUtils';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Who reaches the family in the portal (each child's school address, any tutor). */
export function LoginList({ logins }: { logins: FamilyLogin[] }) {
  if (!logins.length) {
    return <p className="text-sm text-muted">Ninguna cuenta entra todavía por estos alumnos.</p>;
  }
  return (
    <ul className="divide-y divide-cream">
      {logins.map((l) => {
        const Icon = l.kind === 'student' ? GraduationCap : UserRound;
        return (
          <li key={l.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
            <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-cream text-purple">
              <Icon className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-ink" title={l.email}>{l.email}</p>
              <p className="text-xs text-subtle">
                {l.kind_label}
                {l.linked_to.length ? ` de ${l.linked_to.join(', ')}` : ''} · {lastLoginLabel(l.last_login)}
              </p>
            </div>
            {!l.is_active && <Badge variant="warning">Inactiva</Badge>}
          </li>
        );
      })}
    </ul>
  );
}

function StudentRow({ s, current, onRemove, removing }: {
  s: FamilyStudent;
  current: boolean;
  onRemove: () => void;
  removing: boolean;
}) {
  return (
    <li className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
      <span aria-hidden="true" className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold ${current ? 'bg-purple text-white' : 'bg-cream text-purple'}`}>
        {initial(s.name)}
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {current ? (
            <span className="truncate text-sm font-semibold text-ink">{s.name}</span>
          ) : (
            <Link to={`/admin/alumnos/${s.id}`} className="truncate text-sm font-semibold text-ink hover:text-purple focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40">
              {s.name}
            </Link>
          )}
          {current && <Badge variant="info">Este alumno</Badge>}
          {s.archived ? <Badge>Archivado</Badge> : s.status !== 'active' ? <Badge variant="warning">{s.status_label}</Badge> : null}
        </p>
        <p className="truncate text-xs text-subtle">{gradeLine(s)} · Matrícula {s.student_id}</p>
      </div>
      <Button type="button" variant="ghost" size="sm" onClick={onRemove} loading={removing} disabled={removing}
        aria-label={`Quitar a ${s.name} de la familia`}>
        <Unlink className="h-4 w-4" aria-hidden="true" />
        <span className="hidden sm:inline">Quitar</span>
      </Button>
    </li>
  );
}

interface Props {
  family: FamilyDetail;
  /** Highlights the student whose file shows the panel. */
  currentStudentId?: number;
  onAdd: () => void;
  /** After «Disolver» (or a removal that left one child): the panel's family is gone. */
  onGone?: () => void;
}

/**
 * One family: its children (each opens its file; «Quitar» takes one out) and
 * the accounts that see all of them in the portal. Rename and dissolve live
 * in the card header. Used by the student's Familia tab and the Familias page.
 */
export function FamilyPanel({ family, currentStudentId, onAdd, onGone }: Props) {
  const headingId = useId();
  const [toRemove, setToRemove] = useState<FamilyStudent | null>(null);
  const [dissolving, setDissolving] = useState(false);
  const [editing, setEditing] = useState(false);
  const remove = useFamilyRemoveStudent();
  const dissolve = useFamilyDissolve();
  const n = family.students.length;

  const confirmRemove = () => {
    if (!toRemove) return;
    remove.mutate({ familyId: family.id, studentId: toRemove.id }, {
      onSuccess: (r) => {
        toast.success(r.dissolved
          ? `Familia disuelta: ya no quedaban hermanos con ${toRemove.name.split(' ')[0]}.`
          : `${toRemove.name} ya no está en ${family.name}.`);
        setToRemove(null);
        if (r.dissolved || toRemove.id === currentStudentId) onGone?.();
      },
      onError: (e) => toast.error(apiErrorMessage(e, 'No se pudo quitar al alumno.')),
    });
  };

  const confirmDissolve = () => {
    dissolve.mutate(family.id, {
      onSuccess: () => {
        toast.success(`${family.name} disuelta. Los expedientes y las cuentas no cambian.`);
        setDissolving(false);
        onGone?.();
      },
      onError: (e) => toast.error(apiErrorMessage(e, 'No se pudo disolver la familia.')),
    });
  };

  return (
    <Card
      title={family.name}
      subtitle={`${plural(n, 'hermano', 'hermanos')} · ${plural(family.logins.length, 'cuenta con acceso', 'cuentas con acceso')}`}
      action={(
        <div className="flex flex-wrap justify-end gap-1">
          <Button type="button" variant="secondary" size="sm" onClick={onAdd}>
            <UserPlus className="h-4 w-4" aria-hidden="true" /> Agregar hermano
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(true)} aria-label={`Renombrar ${family.name}`}>
            <Pencil className="h-4 w-4" aria-hidden="true" /> <span className="hidden sm:inline">Renombrar</span>
          </Button>
          {/* Destructive: coral, like every Eliminar/Disolver in the console (Button's ghost would win the text color). */}
          <button type="button" onClick={() => setDissolving(true)} aria-label={`Disolver ${family.name}`}
            className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold text-coral-700 transition duration-150 hover:bg-coral-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-coral-600/30 sm:min-h-[36px]">
            <Unlink className="h-4 w-4" aria-hidden="true" /> <span className="hidden sm:inline">Disolver</span>
          </button>
        </div>
      )}
    >
      {family.notes && <p className="-mt-1 mb-4 rounded-xl bg-cream-2 px-3 py-2 text-sm text-muted">{family.notes}</p>}

      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby={`${headingId}-kids`}>
          <h4 id={`${headingId}-kids`} className="mb-2 text-xs font-semibold uppercase tracking-wide text-subtle">Hermanos</h4>
          <ul className="divide-y divide-cream">
            {family.students.map((s) => (
              <StudentRow key={s.id} s={s} current={s.id === currentStudentId}
                onRemove={() => setToRemove(s)} removing={remove.isPending && remove.variables?.studentId === s.id} />
            ))}
          </ul>
        </section>
        <section aria-labelledby={`${headingId}-logins`}>
          <h4 id={`${headingId}-logins`} className="mb-2 text-xs font-semibold uppercase tracking-wide text-subtle">Cuentas con acceso</h4>
          <LoginList logins={family.logins} />
        </section>
      </div>

      <p className="mt-5 flex gap-2 rounded-xl bg-brand-50 px-3 py-2.5 text-xs text-brand-700">
        <Info className="mt-px h-4 w-4 shrink-0" aria-hidden="true" />
        Con cualquiera de estas cuentas la familia ve en el portal a todos los hermanos: saldo, recargas, movimientos y expediente.
      </p>

      <ConfirmDialog
        open={!!toRemove}
        onClose={() => setToRemove(null)}
        onConfirm={confirmRemove}
        loading={remove.isPending}
        title="Quitar de la familia"
        confirmLabel="Quitar"
        message={toRemove ? (
          <>
            <strong className="text-ink">{toRemove.name}</strong> dejará de aparecer en las cuentas de sus hermanos, y su cuenta dejará de verlos.
            {n <= 2 ? ' Como solo quedaría un alumno, la familia se disuelve.' : ''} Su expediente y su saldo no cambian.
          </>
        ) : ''}
      />

      <ConfirmDialog
        open={dissolving}
        onClose={() => setDissolving(false)}
        onConfirm={confirmDissolve}
        loading={dissolve.isPending}
        title="Disolver familia"
        confirmLabel="Disolver"
        message={<>Los {n} hermanos de <strong className="text-ink">{family.name}</strong> dejarán de verse entre sí en el portal. Sus expedientes, saldos y cuentas no cambian.</>}
      />

      <RenameFamilyModal family={family} open={editing} onClose={() => setEditing(false)} />
    </Card>
  );
}

function RenameFamilyModal({ family, open, onClose }: { family: FamilyDetail; open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Editar familia" maxWidth={440}>
      <RenameForm family={family} onClose={onClose} />
    </Modal>
  );
}

function RenameForm({ family, onClose }: { family: FamilyDetail; onClose: () => void }) {
  const nameId = useId();
  const notesId = useId();
  const [name, setName] = useState(family.name);
  const [notes, setNotes] = useState(family.notes);
  const [error, setError] = useState('');
  const update = useFamilyUpdate();
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) { setError('Escriba el nombre de la familia.'); return; }
        update.mutate({ id: family.id, name: name.trim(), notes: notes.trim() }, {
          onSuccess: () => { toast.success('Familia actualizada.'); onClose(); },
          onError: (err) => setError(apiFieldErrors(err).name || apiErrorMessage(err, 'No se pudo guardar.')),
        });
      }}
    >
      <div>
        <label htmlFor={nameId} className="label">Nombre</label>
        <input id={nameId} className="input-field min-h-[44px] text-base sm:text-sm" maxLength={150} required
          value={name} onChange={(e) => { setName(e.target.value); setError(''); }}
          aria-invalid={!!error} aria-describedby={error ? `${nameId}-err` : undefined} />
        {error && <p id={`${nameId}-err`} className="mt-1 text-xs text-coral-700" role="alert">{error}</p>}
      </div>
      <div>
        <label htmlFor={notesId} className="label">Notas internas <span className="font-normal text-subtle">(opcional)</span></label>
        <textarea id={notesId} className="input-field min-h-[80px] text-base sm:text-sm" maxLength={300}
          value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Por ejemplo: recoge la abuela los viernes." />
        <p className="mt-1 text-xs text-subtle">Solo las ve el colegio.</p>
      </div>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button type="submit" loading={update.isPending} disabled={update.isPending}>Guardar</Button>
      </div>
    </form>
  );
}
