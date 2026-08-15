import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Circle, Download, FileText, ShieldCheck } from 'lucide-react';
import toast from 'react-hot-toast';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { ErrorState } from '@/components/ui/ErrorState';
import { admissionsAdminApi } from '@/services/api';
import { STATUS_BADGE, REGISTRATION_STATUS_OPTIONS } from '@/lib/admissionsStatus';

const DOC_LABELS: Record<string, string> = {
  birth_cert: 'Acta de Nacimiento', curp_doc: 'CURP', photo: 'Fotografía',
  report_card: 'Boleta Anterior', proof_addr: 'Comprobante de Domicilio',
  vaccination: 'Cartilla de Vacunación', other: 'Otro Documento',
};

interface Doc { id: number; doc_type: string; filename: string; is_verified: boolean; download_url: string }
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
  const qc = useQueryClient();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin-registration', id],
    queryFn: async () => (await admissionsAdminApi.getRegistration(id!)).data as Reg,
    enabled: open && id != null,
  });

  const [status, setStatus] = useState('submitted');
  const [notes, setNotes] = useState('');
  const [downloadingId, setDownloadingId] = useState<number | null>(null);

  // Prod serves no /media/, so we fetch the file with auth (JWT via the api
  // client) and save the returned blob rather than linking to a URL.
  const handleDownload = async (doc: Doc) => {
    setDownloadingId(doc.id);
    try {
      const resp = await admissionsAdminApi.downloadDocument(doc.id);
      const url = URL.createObjectURL(resp.data as Blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = doc.filename || 'documento';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('No se pudo descargar el documento.');
    } finally {
      setDownloadingId(null);
    }
  };

  // Sync local controls whenever a different registration loads.
  useEffect(() => {
    if (data) { setStatus(data.status); setNotes(data.admin_notes ?? ''); }
  }, [data]);

  const verifyDoc = useMutation({
    mutationFn: ({ docId, next }: { docId: number; next: boolean }) =>
      admissionsAdminApi.verifyDocument(docId, next),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-registration', id] });
      qc.invalidateQueries({ queryKey: ['admin-registrations'] });
    },
    onError: () => toast.error('No se pudo actualizar el documento.'),
  });

  const save = useMutation({
    mutationFn: () => admissionsAdminApi.updateRegistrationStatus(id!, { status, admin_notes: notes }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-registrations'] });
      qc.invalidateQueries({ queryKey: ['admin-registration', id] });
      toast.success('Inscripción actualizada.');
      onClose();
    },
    onError: () => toast.error('No se pudo guardar la revisión.'),
  });

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

          {/* LFPDPPP consents — staff must see what the family accepted */}
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-subtle">
              Consentimientos
            </p>
            <div className="space-y-2 rounded-xl border border-line px-3 py-3 text-sm">
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

          {/* Documents + verification */}
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-subtle">
              Documentos ({data.documents.filter((d) => d.is_verified).length}/{data.documents.length} verificados)
            </p>
            {data.documents.length === 0 ? (
              <p className="rounded-xl border border-dashed border-line px-3 py-4 text-center text-sm text-subtle">
                Sin documentos adjuntos.
              </p>
            ) : (
              <ul className="space-y-2">
                {data.documents.map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-3 rounded-xl border border-line px-3 py-2.5">
                    <span className="flex min-w-0 items-center gap-2 text-sm text-ink">
                      <FileText className="h-4 w-4 shrink-0 text-subtle" />
                      <span className="truncate">{DOC_LABELS[d.doc_type] ?? d.doc_type}</span>
                      <span className="truncate text-xs text-subtle">· {d.filename}</span>
                    </span>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <button
                        type="button"
                        disabled={downloadingId === d.id}
                        onClick={() => handleDownload(d)}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-cream px-2.5 py-1 text-xs font-semibold text-muted transition hover:bg-line disabled:opacity-50"
                        aria-label={`Descargar ${d.filename}`}
                      >
                        <Download className="h-3.5 w-3.5" />
                        {downloadingId === d.id ? '…' : 'Ver'}
                      </button>
                      <button
                        type="button"
                        disabled={verifyDoc.isPending}
                        onClick={() => verifyDoc.mutate({ docId: d.id, next: !d.is_verified })}
                        className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold transition disabled:opacity-50 ${
                          d.is_verified ? 'bg-green-50 text-green-700' : 'bg-cream text-muted hover:bg-line'
                        }`}
                      >
                        {d.is_verified ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Circle className="h-3.5 w-3.5" />}
                        {d.is_verified ? 'Verificado' : 'Verificar'}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Review decision */}
          <div className="rounded-xl2 border border-line bg-cream/40 p-4 space-y-3">
            <div>
              <label htmlFor="reg-status" className="label">Estado de la revisión</label>
              <select id="reg-status" className="input-field" value={status} onChange={(e) => setStatus(e.target.value)}>
                {REGISTRATION_STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="reg-notes" className="label">Notas internas</label>
              <textarea id="reg-notes" className="input-field min-h-[72px] resize-none" value={notes}
                onChange={(e) => setNotes(e.target.value)} placeholder="Observaciones de admisiones (no visibles para la familia)…" />
            </div>
            <p className="flex items-center gap-1.5 text-xs text-subtle">
              <ShieldCheck className="h-3.5 w-3.5" />
              Aprobar o rechazar envía un correo automático al tutor.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={onClose}>Cancelar</Button>
              <Button onClick={() => save.mutate()} loading={save.isPending}>Guardar revisión</Button>
            </div>
          </div>
        </div>
      )}
    </Modal>
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
