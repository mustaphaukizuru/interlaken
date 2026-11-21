import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Globe, Link2 } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { contentApi } from '@/services/api';
import { apiFieldErrors } from '@/lib/apiErrors';
import type { SiteSettings } from '@/types/content';

/**
 * Ajustes → «Ficha de inscripción en línea»: the «Permitir iniciar la ficha sin
 * enlace» switch (SiteSettings.admissions_public_start). Off (the default since
 * 2026-11-21, recommended): the ficha is private, only the personal link the
 * school sends from the Expediente once the exam is «Aceptado» opens one (the
 * public start answers 403 and /pre-registro shows «La ficha de inscripción es
 * personal»). On: anyone could start a ficha from /pre-registro. Saved on its
 * own, at once: it is not part of the contact form's «Guardar».
 */
export function AdmissionsPublicStartCard({ value, loaded }: { value: boolean | undefined; loaded: boolean }) {
  const qc = useQueryClient();
  const enabled = value === true; // the backend default is off
  const save = useMutation({
    mutationFn: (next: boolean) => contentApi.adminUpdateSettings({ admissions_public_start: next }),
    onSuccess: (_res, next) => {
      qc.setQueryData<Partial<SiteSettings>>(['admin-site-settings'], (prev) => ({ ...prev, admissions_public_start: next }));
      qc.invalidateQueries({ queryKey: ['admin-site-settings'] });
      toast.success(next
        ? 'Listo: cualquier persona puede iniciar una ficha desde el sitio.'
        : 'Listo: la ficha solo se abre con el enlace personal que envía el colegio.');
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
            La ficha de inscripción es personal: el colegio la envía desde el Expediente a cada familia cuando su hijo/a es admitido
            («Enviar resultado y ficha»). Déjelo apagado.
          </p>
          <p className="text-subtle">
            Encendido, cualquier persona podría iniciar una ficha desde el sitio sin visita ni examen. No se recomienda.
          </p>
          <p className="inline-flex items-center gap-1.5 font-medium text-ink" aria-live="polite">
            {enabled
              ? <><Globe className="h-4 w-4 text-amber" aria-hidden="true" /> Ahora: abierta a cualquier persona (no recomendado)</>
              : <><Link2 className="h-4 w-4 text-purple" aria-hidden="true" /> Ahora: solo con el enlace personal del colegio</>}
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
