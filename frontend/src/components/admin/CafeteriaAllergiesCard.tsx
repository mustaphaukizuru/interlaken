import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { AlertTriangle, Coffee, ShieldCheck } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { contentApi } from '@/services/api';
import { apiFieldErrors } from '@/lib/apiErrors';
import type { SiteSettings } from '@/types/content';

/**
 * Ajustes → «Alergias en la cafetería» (2026-11-24). A school decision about
 * health data of minors, off by default. Off: no cafetería screen receives a
 * child's allergies. On: the cafetería console shows the allergies (that field
 * only) of the children whose family authorised health data. Admin only;
 * saved at once, on its own, and written to Auditoría.
 */
export function CafeteriaAllergiesCard({ value, loaded }: { value: boolean | undefined; loaded: boolean }) {
  const qc = useQueryClient();
  const enabled = value === true;
  const save = useMutation({
    mutationFn: (next: boolean) => contentApi.adminUpdateSettings({ cafeteria_shows_allergies: next }),
    onSuccess: (_res, next) => {
      qc.setQueryData<Partial<SiteSettings>>(['admin-site-settings'], (prev) => ({ ...prev, cafeteria_shows_allergies: next }));
      void qc.invalidateQueries({ queryKey: ['admin-site-settings'] });
      // The texts that say who sees allergies read the public settings.
      void qc.invalidateQueries({ queryKey: ['site-settings'] });
      toast.success(next
        ? 'Listo: la cafetería ve las alergias de los alumnos cuya familia autorizó los datos de salud.'
        : 'Listo: la cafetería ya no ve las alergias.');
    },
    onError: (err) => toast.error(apiFieldErrors(err).detail || 'No se pudo guardar el ajuste.'),
  });
  const busy = save.isPending || !loaded;

  return (
    <Card title="Alergias en la cafetería">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-1.5 text-sm">
          <p id="card-allergies-label" className="font-semibold text-ink">La cafetería ve las alergias</p>
          <p className="text-subtle">
            Apagado, la consola de cafetería no recibe ningún dato de salud.
            Encendido, quien atiende la cafetería ve las alergias de cada alumno cuya familia autorizó los datos de salud;
            solo las alergias, nunca el tipo de sangre, las notas médicas, la CURP ni la fecha de nacimiento.
            El cambio queda registrado en Auditoría.
          </p>
          <p className="flex items-start gap-1.5 text-subtle">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber" aria-hidden="true" />
            <span>Encenderlo puede requerir una actualización del aviso de privacidad: revíselo antes de encenderlo.</span>
          </p>
          <p className="inline-flex items-center gap-1.5 font-medium text-ink" aria-live="polite">
            {enabled
              ? <><Coffee className="h-4 w-4 text-purple" aria-hidden="true" /> Ahora: la cafetería ve las alergias autorizadas</>
              : <><ShieldCheck className="h-4 w-4 text-purple" aria-hidden="true" /> Ahora: la cafetería no ve las alergias</>}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-labelledby="card-allergies-label"
          disabled={busy}
          onClick={() => save.mutate(!enabled)}
          className={`relative mt-0.5 inline-flex h-11 w-[4.25rem] shrink-0 items-center rounded-full border-2 border-transparent p-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40 disabled:opacity-60 ${enabled ? 'bg-green-strong' : 'bg-ink/20'}`}
        >
          <span className="sr-only">{enabled ? 'Encendido' : 'Apagado'}</span>
          <span
            aria-hidden="true"
            className={`h-8 w-8 rounded-full bg-white shadow transition-transform motion-reduce:transition-none ${enabled ? 'translate-x-6' : 'translate-x-0'}`}
          />
        </button>
      </div>
    </Card>
  );
}

export default CafeteriaAllergiesCard;
