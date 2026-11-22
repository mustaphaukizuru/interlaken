import { useState } from 'react';
import { CalendarClock, CalendarX2, Globe2 } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { isoToSchoolInput, longSchoolDate, schoolInputToIso } from './mxTime';

export interface Schedule {
  publish_at: string | null;
  unpublish_at: string | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  value: Schedule;
  /** Saves the new dates (the editor saves the draft right away). */
  onSave: (next: Schedule) => void;
  /** Only Dirección schedules (the backend refuses the fields from staff). */
  canEdit: boolean;
  /** A public page with a designed template goes back to it when withdrawn. */
  hasOriginalDesign: boolean;
  saving?: boolean;
  now?: number;
}

/**
 * «Programar»: publish and withdraw dates in Mexico City time, with what will
 * happen spelled out, and a way to cancel each schedule. Same backend fields
 * as before (`publish_at`, `unpublish_at`); the cms_schedule cron runs every
 * 5 minutes and publishes only when the pre-publish checks pass.
 */
export function ScheduleDialog({ open, onClose, ...rest }: Props) {
  return (
    <Modal open={open} onClose={onClose} title="Programar publicación" maxWidth={560}>
      {/* Mounted only while open: the form starts from the saved dates each time. */}
      <ScheduleForm onClose={onClose} {...rest} />
    </Modal>
  );
}

function ScheduleForm({ onClose, value, onSave, canEdit, hasOriginalDesign, saving, now: nowProp }: Omit<Props, 'open'>) {
  const [openedAt] = useState(() => Date.now());
  const now = nowProp ?? openedAt;
  const [publishAt, setPublishAt] = useState(isoToSchoolInput(value.publish_at));
  const [unpublishAt, setUnpublishAt] = useState(isoToSchoolInput(value.unpublish_at));
  const [touched, setTouched] = useState(false);

  const publishIso = publishAt ? schoolInputToIso(publishAt) : null;
  const unpublishIso = unpublishAt ? schoolInputToIso(unpublishAt) : null;
  const errors: { publish?: string; unpublish?: string } = {};
  if (publishIso && new Date(publishIso).getTime() <= now && publishIso !== value.publish_at) errors.publish = 'Elija una fecha y hora futuras.';
  if (unpublishIso && new Date(unpublishIso).getTime() <= now && unpublishIso !== value.unpublish_at) errors.unpublish = 'Elija una fecha y hora futuras.';
  if (publishIso && unpublishIso && new Date(unpublishIso) <= new Date(publishIso)) errors.unpublish = 'El retiro debe ser después de la publicación.';
  const invalid = !!(errors.publish || errors.unpublish);
  const changed = publishIso !== value.publish_at || unpublishIso !== value.unpublish_at;
  const withdrawResult = hasOriginalDesign
    ? 'la página deja de mostrar lo que publicó y el sitio vuelve a mostrar el diseño original.'
    : 'la página deja el sitio y las visitas verán «Página no encontrada».';

  const submit = () => {
    setTouched(true);
    if (invalid) return;
    onSave({ publish_at: publishIso, unpublish_at: unpublishIso });
  };

  return (
    <div className="space-y-5">
      <p className="flex items-start gap-2 rounded-md bg-cream px-3 py-2 text-sm text-ink">
        <Globe2 size={16} className="mt-0.5 shrink-0 text-subtle" aria-hidden="true" />
        <span>Las horas son de <strong>Ciudad de México</strong>. El sistema revisa cada 5 minutos, así que puede tardar hasta 5 minutos.</span>
      </p>
      {!canEdit && (
        <p className="rounded-md border border-line px-3 py-2 text-sm text-muted">
          Solo Dirección programa publicaciones. Puede ver aquí lo que está programado y pedirlo al solicitar aprobación.
        </p>
      )}

      <fieldset className="space-y-2">
        <legend className="flex items-center gap-2 font-semibold text-ink"><CalendarClock size={17} aria-hidden="true" /> Publicar automáticamente</legend>
        <Input
          label="Fecha y hora de publicación"
          type="datetime-local"
          value={publishAt}
          disabled={!canEdit}
          onChange={(e) => setPublishAt(e.target.value)}
          error={touched ? errors.publish : undefined}
        />
        <p className="text-sm text-muted" aria-live="polite">
          {publishIso
            ? <>El <strong className="text-ink">{longSchoolDate(publishIso)}</strong> se publicará el borrador tal como esté en ese momento, incluidos los cambios que haga antes. Si la revisión encuentra errores, no se publica y la página aparece como atrasada.</>
            : 'Sin fecha: la página se publica solo cuando alguien pulse «Publicar».'}
        </p>
        {canEdit && publishAt && (
          <Button type="button" variant="ghost" size="sm" onClick={() => setPublishAt('')}><CalendarX2 size={15} aria-hidden="true" /> Cancelar la publicación programada</Button>
        )}
      </fieldset>

      <div className="border-t border-line pt-4">
      <fieldset className="space-y-2">
        <legend className="flex items-center gap-2 font-semibold text-ink"><CalendarX2 size={17} aria-hidden="true" /> Retirar del sitio</legend>
        <Input
          label="Fecha y hora de retiro"
          type="datetime-local"
          value={unpublishAt}
          disabled={!canEdit}
          onChange={(e) => setUnpublishAt(e.target.value)}
          error={touched ? errors.unpublish : undefined}
        />
        <p className="text-sm text-muted" aria-live="polite">
          {unpublishIso
            ? <>El <strong className="text-ink">{longSchoolDate(unpublishIso)}</strong> {withdrawResult} El borrador y las versiones se conservan.</>
            : 'Sin fecha: la página sigue publicada hasta que alguien pulse «Retirar».'}
        </p>
        {canEdit && unpublishAt && (
          <Button type="button" variant="ghost" size="sm" onClick={() => setUnpublishAt('')}><CalendarX2 size={15} aria-hidden="true" /> Cancelar el retiro programado</Button>
        )}
      </fieldset>
      </div>

      <div className="flex flex-col-reverse gap-2 border-t border-line pt-4 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" onClick={onClose}>{canEdit ? 'Cancelar' : 'Cerrar'}</Button>
        {canEdit && (
          <Button type="button" onClick={submit} loading={saving} disabled={!changed}>
            {!publishIso && !unpublishIso && (value.publish_at || value.unpublish_at) ? 'Quitar la programación' : 'Guardar programación'}
          </Button>
        )}
      </div>
    </div>
  );
}
