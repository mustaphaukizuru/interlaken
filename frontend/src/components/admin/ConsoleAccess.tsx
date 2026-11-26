import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MailCheck, MailWarning, ShieldCheck } from 'lucide-react';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Modal } from '@/components/ui/Modal';
import { StaffAccessFields, type StaffAccess } from '@/components/admin/StaffAccessFields';
import { useDirtyCloseGuard, useReportDirty } from '@/hooks/useDirtyCloseGuard';
import { adminKeys } from '@/hooks/queries/keys';
import { STAFF_ENTITY } from '@/hooks/queries/staff';
import { invalidateStudents } from '@/hooks/queries/studentKeys';
import { apiErrorMessage } from '@/lib/apiErrors';
import { AREA_LABEL } from '@/lib/areaCatalog';
import type { AreaKey } from '@/lib/areas';
import { portalApi } from '@/services/api';
import type { User } from '@/types';

/**
 * Console access of a «Personal del colegio» cafetería login (owner,
 * 2026-11-25). The office gives the console to the login the person already
 * has (their wallet, Loyverse card and history stay), or takes it away again.
 * Admins only: the API refuses everyone else (Usuarios is admin-only).
 */

/** The login a staff wallet belongs to, as these dialogs name it. */
export interface ConsolePerson {
  userId: number;
  name: string;
  email: string;
}

/** «Consola» on the Personal list: who of the staff also uses the console. */
export function ConsoleAccessCell({ user }: { user: Pick<User, 'role' | 'staff_title' | 'staff_areas'> }) {
  if (user.role === 'admin') {
    return (
      <span className="block">
        <span className="block text-sm font-medium text-ink">Administrador</span>
        <span className="block text-xs text-muted">Toda la consola</span>
      </span>
    );
  }
  if (user.role === 'staff') {
    const areas = (user.staff_areas ?? []).map((a) => AREA_LABEL[a as AreaKey] ?? a);
    return (
      <span className="block">
        <span className="block text-sm font-medium text-ink">{user.staff_title || 'Consola'}</span>
        <span className="block text-xs text-muted">{areas.length ? areas.join(', ') : 'Sin áreas de la consola'}</span>
      </span>
    );
  }
  // A parent who also works here keeps the family login for their children.
  return <span className="text-xs text-subtle">{user.role === 'parent' ? 'Entra como familia' : 'Solo cafetería'}</span>;
}

function useRefresh() {
  const qc = useQueryClient();
  return () => Promise.all([
    invalidateStudents(qc),
    qc.invalidateQueries({ queryKey: adminKeys.entity(STAFF_ENTITY) }),
  ]);
}

const EMPTY: StaffAccess = { staff_title: '', staff_areas: [] };

/** «Dar acceso a la consola»: pick a puesto (or areas), then one email tells the person. */
export function GrantConsoleAccessModal({ person, initial, onClose, onDone }: {
  person: ConsolePerson | null;
  /** Areas already chosen elsewhere (Usuarios «Nuevo usuario»). */
  initial?: StaffAccess;
  onClose: () => void;
  onDone?: () => void;
}) {
  const guard = useDirtyCloseGuard(onClose);
  return (
    <>
      <Modal open={!!person} onClose={guard.requestClose} title="Dar acceso a la consola" maxWidth={560}>
        {person && (
          <GrantForm key={person.userId} person={person} initial={initial ?? EMPTY} onClose={onClose}
            onCancel={guard.requestClose} onDirty={guard.reportDirty} onDone={onDone} />
        )}
      </Modal>
      {guard.dialog}
    </>
  );
}

function GrantForm({ person, initial, onClose, onCancel, onDirty, onDone }: {
  person: ConsolePerson; initial: StaffAccess; onClose: () => void; onCancel: () => void;
  onDirty: (dirty: boolean) => void; onDone?: () => void;
}) {
  const [access, setAccess] = useState<StaffAccess>(initial);
  const refresh = useRefresh();
  useReportDirty(access.staff_areas.join() !== initial.staff_areas.join() || access.staff_title !== initial.staff_title, onDirty);
  const grant = useMutation({
    mutationFn: () => portalApi.grantConsoleAccess(person.userId, access),
    onSuccess: ({ data }) => {
      void refresh();
      toast.success(`${person.name || person.email} ya puede entrar a la consola.`);
      if (!data.invite_email_sent) {
        toast(`No se pudo enviar el correo de aviso: dígale que entre con «Continuar con Google» usando ${person.email}.`, { duration: 8000 });
      }
      onDone?.();
      onClose();
    },
    onError: (e: unknown) => toast.error(apiErrorMessage(e, 'No se pudo dar el acceso.')),
  });
  const none = access.staff_areas.length === 0;
  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (!none) grant.mutate(); }}>
      <p className="text-sm text-muted">
        <ShieldCheck className="mr-1 inline h-4 w-4 text-purple" aria-hidden="true" />
        <strong className="text-ink">{person.name || person.email}</strong> entrará a la consola con su misma
        cuenta (<span className="break-all">{person.email}</span>), con «Continuar con Google». Conserva su cuenta de
        cafetería, su saldo y su historial.
      </p>
      <StaffAccessFields value={access} onChange={setAccess} idPrefix={`grant-${person.userId}`} />
      <p className="flex items-start gap-2 text-xs text-subtle">
        <MailCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <span>Le enviaremos un correo avisándole, sin contraseña. Si su correo no es de Google, después genere una contraseña temporal en Usuarios.</span>
      </p>
      {none && (
        <p role="status" className="flex items-start gap-2 text-xs text-warning">
          <MailWarning className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>Elija un puesto o al menos un área.</span>
        </p>
      )}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="secondary" onClick={onCancel} className="min-h-[44px]">Cancelar</Button>
        <Button type="submit" loading={grant.isPending} disabled={none} className="min-h-[44px]">Dar acceso</Button>
      </div>
    </form>
  );
}

/** «Quitar acceso a la consola»: back to a cafetería-only login. */
export function RemoveConsoleAccessDialog({ person, onClose, onDone }: {
  person: ConsolePerson | null; onClose: () => void; onDone?: () => void;
}) {
  const refresh = useRefresh();
  const remove = useMutation({
    mutationFn: (p: ConsolePerson) => portalApi.removeConsoleAccess(p.userId),
    onSuccess: (_r, p) => {
      void refresh();
      toast.success(`${p.name || p.email} ya no entra a la consola. Su cuenta de cafetería sigue igual.`);
      onDone?.();
      onClose();
    },
    onError: (e: unknown) => toast.error(apiErrorMessage(e, 'No se pudo quitar el acceso.')),
  });
  return (
    <ConfirmDialog
      open={!!person}
      onClose={() => { if (!remove.isPending) onClose(); }}
      onConfirm={() => person && remove.mutate(person)}
      title="Quitar acceso a la consola"
      message={`${person?.name || person?.email || ''} ya no podrá entrar a la consola y se cerrarán sus sesiones. Su cuenta de cafetería, su saldo y su historial no cambian.`}
      confirmLabel="Quitar acceso"
      loading={remove.isPending}
    />
  );
}
