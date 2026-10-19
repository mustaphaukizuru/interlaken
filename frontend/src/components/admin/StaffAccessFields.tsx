import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import toast from 'react-hot-toast';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { portalApi, type StaffUser } from '@/services/api';
import { apiErrorMessage } from '@/lib/apiErrors';
import { AREA_LABEL, AREAS, PUESTOS } from '@/lib/areaCatalog';
import type { AreaKey } from '@/lib/areas';

export interface StaffAccess {
  staff_title: string;
  staff_areas: AreaKey[];
}

const sameAreas = (a: AreaKey[], b: AreaKey[]) => a.length === b.length && a.every((k) => b.includes(k));

/** The puesto whose preset matches these areas, or 'custom'. */
const puestoOf = (areas: AreaKey[]) => PUESTOS.find((p) => sameAreas(p.areas, areas))?.key ?? 'custom';

/**
 * Puesto + console areas of a staff account. Picking a puesto fills the areas
 * (and the title); ticking areas by hand makes it "Personalizado". No areas =
 * no console (a teacher or content editor keeps the staff dashboard only).
 */
export function StaffAccessFields({ value, onChange, idPrefix = 'acc' }: {
  value: StaffAccess; onChange: (next: StaffAccess) => void; idPrefix?: string;
}) {
  const current = puestoOf(value.staff_areas);
  const pick = (key: string) => {
    const p = PUESTOS.find((x) => x.key === key);
    // "Personalizado" keeps what is ticked; the areas below decide.
    if (p) onChange({ staff_title: p.label, staff_areas: [...p.areas] });
  };
  const toggle = (key: AreaKey, on: boolean) => {
    const next = on ? [...value.staff_areas, key] : value.staff_areas.filter((k) => k !== key);
    onChange({ ...value, staff_areas: AREAS.map((a) => a.key).filter((k) => next.includes(k)) });
  };
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor={`${idPrefix}-puesto`}>Puesto</label>
          <select id={`${idPrefix}-puesto`} className="input-field min-h-[44px]" value={current} onChange={(e) => pick(e.target.value)}>
            {PUESTOS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
            <option value="custom">Personalizado</option>
          </select>
        </div>
        <Input
          label="Nombre del puesto"
          maxLength={60}
          placeholder="Ej. Coordinación"
          value={value.staff_title}
          onChange={(e) => onChange({ ...value, staff_title: e.target.value })}
        />
      </div>
      <fieldset>
        <legend className="label">Áreas de la consola</legend>
        <div className="grid gap-1.5">
          {AREAS.map((a) => (
            <label key={a.key} htmlFor={`${idPrefix}-area-${a.key}`} className="grid min-h-[44px] cursor-pointer grid-cols-[auto,1fr] items-start gap-x-2.5 rounded-lg border border-line px-3 py-2 hover:border-purple/40">
              <input
                id={`${idPrefix}-area-${a.key}`}
                type="checkbox"
                aria-labelledby={`${idPrefix}-area-${a.key}-name`}
                aria-describedby={`${idPrefix}-area-${a.key}-desc`}
                className="row-span-2 mt-1 h-4 w-4 rounded border-line text-purple focus:ring-purple/40"
                checked={value.staff_areas.includes(a.key)}
                onChange={(e) => toggle(a.key, e.target.checked)}
              />
              <span id={`${idPrefix}-area-${a.key}-name`} className="text-sm font-semibold text-ink">{a.label}</span>
              <span id={`${idPrefix}-area-${a.key}-desc`} className="text-xs text-muted">{a.description}</span>
            </label>
          ))}
        </div>
        <p className="mt-2 text-xs text-subtle">
          Sin áreas, la cuenta no entra a la consola (docentes y editores de contenido). Usuarios, Ajustes,
          contenido del sitio, Auditoría y ARCO son solo para administradores.
        </p>
      </fieldset>
    </div>
  );
}

/** Puesto and areas as the Personal list shows them. */
export function StaffAccessSummary({ user }: { user: Pick<StaffUser, 'role' | 'staff_title' | 'staff_areas'> }) {
  if (user.role === 'admin') return <span className="text-xs text-muted">Todas las áreas</span>;
  const areas = (user.staff_areas ?? []) as AreaKey[];
  return (
    <span className="block">
      {user.staff_title && <span className="block text-sm font-medium text-ink">{user.staff_title}</span>}
      {areas.length ? (
        <span className="mt-0.5 flex flex-wrap gap-1">
          {areas.map((a) => <Badge key={a} variant="neutral">{AREA_LABEL[a] ?? a}</Badge>)}
        </span>
      ) : <span className="text-xs text-subtle">Sin consola</span>}
    </span>
  );
}

/** «Acceso»: change the puesto and areas of an existing staff account. */
export function StaffAccessModal({ user, onClose, onSaved }: {
  user: StaffUser | null; onClose: () => void; onSaved: () => void;
}) {
  return (
    <Modal open={!!user} onClose={onClose} title="Puesto y áreas de la consola" maxWidth={560}>
      {user && <AccessForm key={user.id} user={user} onClose={onClose} onSaved={onSaved} />}
    </Modal>
  );
}

function AccessForm({ user, onClose, onSaved }: { user: StaffUser; onClose: () => void; onSaved: () => void }) {
  const [value, setValue] = useState<StaffAccess>({
    staff_title: user.staff_title ?? '',
    staff_areas: (user.staff_areas ?? []) as AreaKey[],
  });
  const save = useMutation({
    mutationFn: () => portalApi.updateStaff(user.id, value),
    onSuccess: () => { toast.success('Acceso actualizado. Aplica desde la siguiente acción de la persona.'); onSaved(); onClose(); },
    onError: (e) => toast.error(apiErrorMessage(e, 'No se pudo guardar el acceso.')),
  });
  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      <p className="text-sm text-muted">
        <ShieldCheck className="mr-1 inline h-4 w-4 text-purple" aria-hidden="true" />
        {user.full_name || user.email}: elija qué partes de la consola puede usar.
      </p>
      <StaffAccessFields value={value} onChange={setValue} idPrefix={`acc-${user.id}`} />
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="secondary" onClick={onClose} className="min-h-[44px]">Cancelar</Button>
        <Button type="submit" loading={save.isPending} className="min-h-[44px]">Guardar acceso</Button>
      </div>
    </form>
  );
}
