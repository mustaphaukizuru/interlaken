import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Globe, Link2 } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { contentApi } from '@/services/api';
import { apiFieldErrors } from '@/lib/apiErrors';
import type { SiteSettings } from '@/types/content';

/**
 * Ajustes → «Ficha de inscripción en línea»: the «Permitir iniciar la ficha sin
 * enlace» switch (SiteSettings.admissions_public_start). On: any family can
 * start the ficha from /pre-registro. Off: only the private link the school
 * sends from the Expediente opens a ficha (the public start answers 403 and the
 * page shows «Solicite su enlace»). Saved on its own, at once: it is not part
 * of the contact form's «Guardar».
 */
export function AdmissionsPublicStartCard({ value, loaded }: { value: boolean | undefined; loaded: boolean }) {
  const qc = useQueryClient();
  const enabled = value !== false; // the backend default is on
  const save = useMutation({
    mutationFn: (next: boolean) => contentApi.adminUpdateSettings({ admissions_public_start: next }),
    onSuccess: (_res, next) => {
      qc.setQueryData<Partial<SiteSettings>>(['admin-site-settings'], (prev) => ({ ...prev, admissions_public_start: next }));
      qc.invalidateQueries({ queryKey: ['admin-site-settings'] });
      toast.success(next
        ? 'Listo: cualquier familia puede iniciar la ficha desde el sitio.'
        : 'Listo: la ficha solo se abre con el enlace que envía el colegio.');
    },
    onError: (err) => toast.error(apiFieldErrors(err).detail || 'No se pudo guardar el ajuste.'),
  });
  const busy = save.isPending || !loaded;

  return (
    <Card title="Ficha de inscripción en línea">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-1.5 text-sm">
          <p id="public-start-label" className="font-semibold text-ink">Permitir iniciar la ficha sin enlace</p>
          <p className="text-subtle">
            Encendido: cualquier familia puede iniciar la ficha desde el sitio (Ficha de inscripción) y recibe por correo un enlace para continuarla.
            Apagado: la ficha solo se abre con el enlace que el colegio envía desde el Expediente.
          </p>
          <p className="inline-flex items-center gap-1.5 font-medium text-ink" aria-live="polite">
            {enabled
              ? <><Globe className="h-4 w-4 text-green-dark" aria-hidden="true" /> Ahora: abierta a todas las familias</>
              : <><Link2 className="h-4 w-4 text-purple" aria-hidden="true" /> Ahora: solo con enlace del colegio</>}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-labelledby="public-start-label"
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
