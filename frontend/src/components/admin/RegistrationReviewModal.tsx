import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Circle, ShieldCheck } from 'lucide-react';
import toast from 'react-hot-toast';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { ErrorState } from '@/components/ui/ErrorState';
import { DocumentChecklist } from '@/components/admin/admissions/DocumentChecklist';
import { admissionsAdminApi, api } from '@/services/api';
import { fichaApi } from '@/components/admissions/ficha/api';
import { FichaReadOnly } from '@/components/admin/FichaReadOnly';
import { apiErrorMessage } from '@/lib/apiErrors';
import { REG_ENTITY, registrationDetailKey } from '@/hooks/queries/admissions';
import { invalidateEntity } from '@/hooks/queries/keys';
import {
  STATUS_BADGE, REGISTRATION_STATUS_OPTIONS, REGISTRATION_TRANSITIONS, isReverseTransition,
} from '@/lib/admissionsStatus';

interface Doc { id: number; doc_type: string; filename: string; is_verified: boolean; status?: 'pending' | 'approved' | 'rejected'; review_note?: string; download_url: string }
interface Reg {
  id: number; child_first_name: string; child_last_name: string; child_dob: string;
  child_curp: string; child_nationality: string; level: string; grade_applying: string; cycle: string;
  parent1_name: string; parent1_email: string; parent1_phone: string; parent1_occupation: string;
  parent2_name: string; parent2_email: string; parent2_phone: string;
  emergency_name: string; emergency_phone: string; emergency_rel: string;
  blood_type: string | null; allergies: string | null; medical_notes: string | null;
  estatura: string | null; peso: string | null;
  consent_medical_data: boolean; consent_photos_media: boolean;
  privacy_accepted_at: string | null;
  privacy_notice_version_label: string;
  status: string; submitted_at: string | null; admin_notes?: string; documents: Doc[];
}

export function RegistrationReviewModal({ id, open, onClose }: {
  id: number | null; open: boolean; onClose: () => void;
}) {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: registrationDetailKey(id),
    queryFn: async () => (await admissionsAdminApi.getRegistration(id!)).data as Reg,
    enabled: open && id != null,
  });

  // The ficha de inscripción (version 2): every section, grouped like the Excel.
  const fichaQ = useQuery({
    queryKey: [...registrationDetailKey(id), 'ficha'],
    queryFn: async () => (await fichaApi.get(id!)).data,
    enabled: open && id != null,
  });
  const schemaQ = useQuery({
    queryKey: ['ficha-schema'],
    queryFn: async () => (await fichaApi.schema()).data,
    enabled: open && fichaQ.data?.ficha_version === 2,
    staleTime: 10 * 60_000,
  });
  const fichaView = fichaQ.data?.ficha_version === 2 && schemaQ.data?.steps ? { ficha: fichaQ.data, schema: schemaQ.data } : null;

  const fullName = data ? `${data.child_first_name} ${data.child_last_name}`.trim() : 'Inscripción';
  const hasMedical = !!(data && (
    data.blood_type || data.allergies || data.medical_notes || data.estatura || data.peso
  ));
  const fmtPrivacyAt = (iso: string | null) => {
    if (!iso) return 'No registrado';
    try {
      return new Date(iso).toLocaleString('es-MX', {
        dateStyle: 'medium', timeStyle: 'short',
      });
    } catch {
      return iso;
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={`Revisar inscripción — ${fullName}`} maxWidth={640}>
      {isLoading ? (
        <div className="py-10"><LoadingSpinner /></div>
      ) : isError || !data ? (
        <ErrorState onRetry={() => refetch()} />
      ) : (
        <div className="space-y-5">
          {/* Snapshot */}
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge variant={STATUS_BADGE[data.status]?.variant ?? 'neutral'}>
              {STATUS_BADGE[data.status]?.label ?? data.status}
            </Badge>
            <span className="text-muted">{data.grade_applying}</span>
            <span className="text-subtle">· Ciclo {data.cycle}</span>
          </div>

          {fichaView ? <FichaReadOnly schema={fichaView.schema} ficha={fichaView.ficha} /> : (
          /* dt/dd rows live in a real <dl>; each Field is a div-wrapped group
              (valid HTML5 and what axe's definition-list rule expects). */
          <dl className="space-y-5">
            <Field label="Alumno">
              {fullName}{data.child_curp ? ` · CURP ${data.child_curp}` : ''} · Nac. {data.child_dob}
            </Field>
            <Field label="Tutor principal">
              {data.parent1_name} · {data.parent1_email} · {data.parent1_phone}
              {data.parent1_occupation ? ` · ${data.parent1_occupation}` : ''}
            </Field>
            {data.parent2_name && (
              <Field label="Segundo tutor">
                {data.parent2_name}{data.parent2_email ? ` · ${data.parent2_email}` : ''}{data.parent2_phone ? ` · ${data.parent2_phone}` : ''}
              </Field>
            )}
            {data.emergency_name && (
              <Field label="Emergencia">
                {data.emergency_name}{data.emergency_rel ? ` (${data.emergency_rel})` : ''}{data.emergency_phone ? ` · ${data.emergency_phone}` : ''}
              </Field>
            )}
            {hasMedical && (
              <Field label="Salud">
                {[
                  data.blood_type && `Sangre: ${data.blood_type}`,
                  data.allergies && `Alergias: ${data.allergies}`,
                  data.estatura && `Estatura: ${data.estatura}`,
                  data.peso && `Peso: ${data.peso}`,
                  data.medical_notes,
                ].filter(Boolean).join(' · ')}
              </Field>
            )}
          </dl>
          )}

          {/* LFPDPPP consents — staff must see what the family accepted */}
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-subtle">
              Consentimientos
            </p>
            <div className="space-y-2 rounded-md border border-line px-3 py-3 text-sm">
              <ConsentRow
                ok={!!data.privacy_accepted_at}
                label="Aviso de Privacidad"
                detail={
                  data.privacy_accepted_at
                    ? `${fmtPrivacyAt(data.privacy_accepted_at)}${
                      data.privacy_notice_version_label
                        ? ` · v${data.privacy_notice_version_label}`
                        : ''
                    }`
                    : 'Sin aceptación registrada'
                }
              />
              <ConsentRow
                ok={data.consent_photos_media}
                label="Fotos y medios"
                detail={data.consent_photos_media ? 'Autorizado' : 'No autorizado'}
              />
              <ConsentRow
                ok={data.consent_medical_data}
                label="Datos de salud"
                detail={data.consent_medical_data ? 'Autorizado' : 'No autorizado'}
              />
            </div>
          </div>

          {/* Documents of the student's level (Fase 4): statuses, review, manual marks, reminder. */}
          <DocumentChecklist registrationId={data.id} />

          {/* Review decision — keyed so switching to a different registration
              reseeds the controls, while refetches of the same one (e.g. after
              verifying a document) keep any in-progress edits. */}
          <ReviewDecision key={data.id} registration={data} onClose={onClose} />
        </div>
      )}
    </Modal>
  );
}

function ReviewDecision({ registration, onClose }: { registration: Reg; onClose: () => void }) {
  const qc = useQueryClient();
  // Editable controls seeded from the loaded registration on mount (the parent
  // remounts this block per registration id) — no sync effect needed.
  const [status, setStatus] = useState(registration.status);
  // «Notas internas» come from the staff-only review endpoint (the applicant
  // detail never carries them). `null` = untouched: a save sends the notes
  // only when they were edited, so it never blanks a colleague's notes.
  const review = useQuery({
    queryKey: [...registrationDetailKey(registration.id), 'review'],
    queryFn: async () => (await api.get(`/admissions/register/${registration.id}/status/`)).data as { admin_notes: string },
  });
  const savedNotes = review.data?.admin_notes ?? '';
  const [notes, setNotes] = useState<string | null>(null);
  const notesEdited = notes !== null && notes !== savedNotes;
  const [reason, setReason] = useState('');
  const [notify, setNotify] = useState(true);
  // Only the moves the transition table allows (the server enforces it too);
  // `complete` is reached through "Convertir en alumno" in the pipeline.
  const allowed = new Set([registration.status, ...(REGISTRATION_TRANSITIONS[registration.status] ?? [])]);
  const options = REGISTRATION_STATUS_OPTIONS.filter((o) => allowed.has(o.value));
  if (!options.some((o) => o.value === registration.status)) {
    options.unshift({ value: registration.status, label: STATUS_BADGE[registration.status]?.label ?? registration.status });
  }
  const changed = status !== registration.status;
  const needsReason = changed && isReverseTransition('registration', registration.status, status);
  const emailsFamily = changed && (status === 'approved' || status === 'rejected');

  const save = useMutation({
    mutationFn: () =>
      admissionsAdminApi.updateRegistrationStatus(registration.id, {
        status,
        ...(notesEdited ? { admin_notes: notes } : {}),
        ...(needsReason ? { note: reason.trim() } : {}),
        ...(emailsFamily && !notify ? { notify: false } : {}),
      }),
    onSuccess: () => {
      // The Expediente shows the ficha's status too.
      void invalidateEntity(qc, REG_ENTITY, ['cases']);
      toast.success('Inscripción actualizada.');
      onClose();
    },
    onError: (e) => toast.error(apiErrorMessage(e, 'No se pudo guardar la revisión.')),
  });

  return (
    <div className="rounded-md bg-cream/40 p-4 space-y-3">
      <div>
        <label htmlFor="reg-status" className="label">Estado de la revisión</label>
        <select id="reg-status" className="input-field" value={status} onChange={(e) => setStatus(e.target.value)}>
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
      {needsReason && (
        <div>
          <label htmlFor="reg-reason" className="label">Motivo del cambio (obligatorio)</label>
          <textarea id="reg-reason" className="input-field min-h-[72px] resize-none" value={reason}
            onChange={(e) => setReason(e.target.value)} placeholder="Se guardará en la bitácora de auditoría." />
        </div>
      )}
      <div>
        <label htmlFor="reg-notes" className="label">Notas internas</label>
        {/* Read-only until the saved notes arrive: typing over a box that has
            not loaded them yet would replace them on save. */}
        <textarea id="reg-notes" className="input-field min-h-[72px] resize-none" value={notes ?? savedNotes}
          disabled={!review.isSuccess} aria-describedby={review.isError ? 'reg-notes-error' : undefined}
          onChange={(e) => setNotes(e.target.value)} placeholder="Observaciones de admisiones (no visibles para la familia)…" />
        {review.isError && (
          <p id="reg-notes-error" className="mt-1 text-xs text-coral-700">
            No se pudieron cargar las notas guardadas; se conservan sin cambios al guardar.
          </p>
        )}
      </div>
      {emailsFamily ? (
        <label className="flex min-h-[44px] cursor-pointer items-center gap-2.5 text-sm text-ink">
          <input type="checkbox" className="h-4 w-4 rounded-sm border-line text-purple focus:ring-purple/40"
            checked={notify} onChange={(e) => setNotify(e.target.checked)} />
          Notificar a la familia por correo
        </label>
      ) : (
        <p className="flex items-center gap-1.5 text-xs text-subtle">
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
          Aprobar o rechazar envía un correo automático al tutor.
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button onClick={() => save.mutate()} loading={save.isPending} disabled={needsReason && reason.trim().length < 3}>Guardar revisión</Button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-y-1 sm:grid-cols-[7rem_1fr] gap-3 text-sm">
      <dt className="text-subtle">{label}</dt>
      <dd className="break-words text-ink">{children}</dd>
    </div>
  );
}

function ConsentRow({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <div className="flex items-start gap-2">
      {ok ? (
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-700" aria-hidden />
      ) : (
        <Circle className="mt-0.5 h-4 w-4 shrink-0 text-subtle" aria-hidden />
      )}
      <div className="min-w-0">
        <p className="font-medium text-ink">{label}</p>
        <p className="text-xs text-muted">{detail}</p>
      </div>
    </div>
  );
}
