import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Camera, ShieldCheck } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { contentApi } from '@/services/api';
import { apiFieldErrors } from '@/lib/apiErrors';
import type { SiteSettings } from '@/types/content';

/**
 * Ajustes → «Fotos de la credencial» (owner, 2026-11-22). A school decision:
 * these are photos of minors. Off (the default): the card shows the photo the
 * school uploads or the student's Google picture. On: a parent can upload or
 * remove their own child's photo from the family portal (audited). Saved at
 * once, on its own.
 */
export function CredentialPhotosCard({ value, loaded }: { value: boolean | undefined; loaded: boolean }) {
  const qc = useQueryClient();
  const enabled = value === true;
  const save = useMutation({
    mutationFn: (next: boolean) => contentApi.adminUpdateSettings({ families_upload_photos: next }),
    onSuccess: (_res, next) => {
      qc.setQueryData<Partial<SiteSettings> & { families_upload_photos?: boolean }>(['admin-site-settings'], (prev) => ({ ...prev, families_upload_photos: next }));
      void qc.invalidateQueries({ queryKey: ['admin-site-settings'] });
      toast.success(next
        ? 'Listo: las familias pueden subir la foto de la credencial de sus hijos.'
        : 'Listo: solo el colegio pone la foto de la credencial.');
    },
    onError: (err) => toast.error(apiFieldErrors(err).detail || 'No se pudo guardar el ajuste.'),
  });
  const busy = save.isPending || !loaded;

  return (
    <Card title="Fotos de la credencial">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-1.5 text-sm">
          <p id="card-photos-label" className="font-semibold text-ink">Las familias pueden subir la foto de la credencial</p>
          <p className="text-subtle">
            Apagado, la credencial muestra la foto que suba el colegio o la de la cuenta de Google del alumno.
            Encendido, cada familia puede subir o quitar la foto de sus hijos desde el portal; queda registrado en Auditoría.
          </p>
          <p className="inline-flex items-center gap-1.5 font-medium text-ink" aria-live="polite">
            {enabled
              ? <><Camera className="h-4 w-4 text-purple" aria-hidden="true" /> Ahora: las familias pueden subirla</>
              : <><ShieldCheck className="h-4 w-4 text-purple" aria-hidden="true" /> Ahora: solo el colegio</>}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-labelledby="card-photos-label"
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

export default CredentialPhotosCard;
