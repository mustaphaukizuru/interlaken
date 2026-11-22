import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2, CircleSlash, Clock, Download, FileText, Mail, MessageCircle, Package, Undo2, XCircle,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { clsx } from 'clsx';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { ErrorState } from '@/components/ui/ErrorState';
import { ListSkeleton } from '@/components/ui/ListSkeleton';
import { CopyButton } from '@/components/admin/CopyButton';
import { DocStatusChip } from '@/components/admissions/DocStatusChip';
import { apiErrorMessage } from '@/lib/apiErrors';
import { waHref } from '@/lib/siteContact';
import { fileSize } from '@/lib/requiredDocs';
import { adminKeys } from '@/hooks/queries/keys';
import {
  refreshBoards, requiredDocsApi, useChecklistState, useRegistrationChecklist,
  type ChecklistFile, type ChecklistItem, type FileStatus, type ManualState, type ReminderResult,
} from '@/hooks/queries/requiredDocs';

/** 44 px targets: the office reviews on the iPad. */
const ACTION = 'inline-flex min-h-[44px] items-center gap-1.5 rounded-sm px-3 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-purple/40 disabled:cursor-not-allowed disabled:opacity-50';

const FILE_STATUS: Record<FileStatus, { label: string; icon: typeof Clock; cls: string }> = {
  pending: { label: 'En revisión', icon: Clock, cls: 'text-brand-700' },
  approved: { label: 'Aprobado', icon: CheckCircle2, cls: 'text-green-700' },
  rejected: { label: 'Rechazado', icon: XCircle, cls: 'text-coral-700' },
};

const MANUAL_COPY: Record<ManualState, { title: string; confirm: string; hint: string }> = {
  entregado_fisico: {
    title: 'Marcar como entregado en físico',
    confirm: 'Marcar entregado',
    hint: 'La familia lo entregó en papel en la escuela. Cuenta como documento completo.',
  },
  no_aplica: {
    title: 'Marcar como «No aplica»',
    confirm: 'Marcar «No aplica»',
    hint: 'Este documento no se le pide a esta familia. Deja de contar en el avance.',
  },
};

const fmtDate = (iso?: string) => {
  if (!iso) return '';
  try { return new Date(iso).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' }); } catch { return iso; }
};

/**
 * The documents of one inscripción, for its level (Fase 4): status per
 * document, its files (download, approve, reject with a reason), the office's
 * «Entregado en físico» / «No aplica», the progress and the reminder of what
 * is missing (email, or WhatsApp with the text ready). Used by the review
 * modal; the «Expediente» page embeds it with `columns={2}`.
 */
export function DocumentChecklist({ registrationId, columns = 1 }: { registrationId: number; columns?: 1 | 2 }) {
  const qc = useQueryClient();
  const { data, isLoading, isError, refetch } = useRegistrationChecklist(registrationId);
  const setState = useChecklistState(registrationId);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const [rejecting, setRejecting] = useState<{ file: ChecklistFile; doc: string; note: string; error: string } | null>(null);
  const [marking, setMarking] = useState<{ item: ChecklistItem; state: ManualState; note: string } | null>(null);
  const [whatsapp, setWhatsapp] = useState<ReminderResult | null>(null);

  const refresh = () => Promise.all([
    qc.invalidateQueries({ queryKey: adminKeys.entity('registrations') }),
    refreshBoards(qc),
  ]);

  const review = useMutation({
    mutationFn: ({ file, status, note }: { file: ChecklistFile; status: FileStatus; note?: string }) =>
      requiredDocsApi.reviewFile(file.id, status, note),
    onSuccess: (_r, v) => {
      toast.success(v.status === 'approved' ? `${v.file.filename}: aprobado.` : `${v.file.filename}: rechazado. Se avisó a la familia.`);
      void refresh();
    },
    onError: (e) => toast.error(apiErrorMessage(e, 'No se pudo actualizar el documento.')),
  });
  const remind = useMutation({
    mutationFn: (channel: 'email' | 'whatsapp') => requiredDocsApi.remind(registrationId, channel),
    onSuccess: ({ data: r }) => {
      if (r.channel === 'email') toast.success(`Recordatorio enviado a ${r.sent_to}.`);
      else setWhatsapp(r);
    },
    onError: (e) => toast.error(apiErrorMessage(e, 'No se pudo preparar el recordatorio.')),
  });

  const download = async (file: ChecklistFile) => {
    setDownloadingId(file.id);
    try {
      const resp = await requiredDocsApi.downloadFile(file.id);
      const url = URL.createObjectURL(resp.data as Blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.filename || 'documento';
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

  if (isError) return <ErrorState title="No se pudieron cargar los documentos" onRetry={() => refetch()} />;
  if (isLoading || !data) return <div aria-busy="true"><ListSkeleton rows={4} /></div>;

  const { counts } = data;
  const percent = counts.total ? Math.round((counts.done / counts.total) * 100) : 100;
  const nothingMissing = data.missing.length === 0;

  return (
    <section aria-labelledby={`checklist-${registrationId}`} className="space-y-4">
      <div className="space-y-3 rounded-md bg-cream/40 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 id={`checklist-${registrationId}`} className="font-semibold text-ink">
              Documentos{data.level_label ? ` · ${data.level_label}` : ''}
            </h3>
            {!data.level && <p className="text-xs text-amber">Nivel sin definir: se muestran solo los documentos comunes. Corrija el grado en la ficha.</p>}
          </div>
          {data.complete
            ? <DocStatusChip status="aprobado" label="Expediente completo" />
            : <p className="text-sm font-semibold tabular-nums text-ink">{counts.done} de {counts.total}</p>}
        </div>
        <div
          role="progressbar"
          aria-label="Documentos listos"
          aria-valuemin={0}
          aria-valuemax={counts.total}
          aria-valuenow={counts.done}
          aria-valuetext={`${counts.done} de ${counts.total} documentos listos`}
          className="h-2 overflow-hidden rounded-full bg-line"
        >
          <div className={clsx('h-full rounded-full transition-all', data.complete ? 'bg-green-strong' : 'bg-purple')} style={{ width: `${percent}%` }} />
        </div>
        <p className="text-xs text-muted">
          {[counts.in_review && `${counts.in_review} en revisión`, counts.rejected && `${counts.rejected} por corregir`,
            counts.missing && `${counts.missing} faltan`, counts.not_applicable && `${counts.not_applicable} no aplican`]
            .filter(Boolean).join(' · ') || 'Todo en orden.'}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-subtle">Recordatorio de faltantes</span>
          <button type="button" className={clsx(ACTION, 'border border-line bg-white text-purple hover:bg-cream')}
            disabled={nothingMissing || !data.ficha_submitted || remind.isPending || !data.parent_email} onClick={() => remind.mutate('email')}>
            <Mail size={16} aria-hidden="true" /> {remind.isPending && remind.variables === 'email' ? 'Enviando…' : 'Por correo'}
          </button>
          <button type="button" className={clsx(ACTION, 'border border-line bg-white text-green-700 hover:bg-cream')}
            disabled={nothingMissing || !data.ficha_submitted || remind.isPending} onClick={() => remind.mutate('whatsapp')}>
            <MessageCircle size={16} aria-hidden="true" /> {remind.isPending && remind.variables === 'whatsapp' ? 'Preparando…' : 'Por WhatsApp'}
          </button>
          {nothingMissing && <span className="text-xs text-subtle">No falta nada por pedir.</span>}
          {/* The ficha and the documents share the family's link: a reminder now would cancel the ficha link. */}
          {!nothingMissing && !data.ficha_submitted && (
            <span className="text-xs text-subtle">Disponible cuando la familia envíe la ficha: el enlace de la ficha sigue vigente.</span>
          )}
        </div>
      </div>

      <ul className={clsx('grid gap-3', columns === 2 && 'lg:grid-cols-2')}>
        {data.items.map((item) => (
          <ChecklistRow
            key={item.key}
            item={item}
            fichaSubmitted={data.ficha_submitted}
            downloadingId={downloadingId}
            busy={review.isPending || setState.isPending}
            onDownload={download}
            onApprove={(file) => review.mutate({ file, status: 'approved' })}
            onReject={(file) => setRejecting({ file, doc: item.name, note: '', error: '' })}
            onMark={(state) => setMarking({ item, state, note: '' })}
            onClear={() => setState.mutate({ key: item.key, state: null }, {
              onSuccess: () => toast.success(`Se quitó la marca de «${item.name}».`),
              onError: (e) => toast.error(apiErrorMessage(e, 'No se pudo quitar la marca.')),
            })}
          />
        ))}
      </ul>

      {data.other_files.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-subtle">Otros archivos</p>
          <ul className="space-y-2 rounded-md border border-line p-3">
            {data.other_files.map((file) => (
              <FileLine key={file.id} file={file} downloading={downloadingId === file.id} busy={review.isPending}
                onDownload={() => download(file)} onApprove={() => review.mutate({ file, status: 'approved' })}
                onReject={() => setRejecting({ file, doc: file.filename, note: '', error: '' })} />
            ))}
          </ul>
        </div>
      )}

      <Modal open={!!rejecting} onClose={() => setRejecting(null)} title={`Rechazar: ${rejecting?.doc ?? ''}`} maxWidth={460}>
        {rejecting && (
          <form
            className="space-y-3"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              const note = rejecting.note.trim();
              if (!note) { setRejecting({ ...rejecting, error: 'Escriba el motivo: la familia lo recibe por correo.' }); return; }
              review.mutate({ file: rejecting.file, status: 'rejected', note }, { onSuccess: () => setRejecting(null) });
            }}
          >
            <p className="text-sm text-muted">La familia recibe este motivo por correo y puede volver a subir el archivo.</p>
            <div>
              <label className="label" htmlFor={`reject-note-${registrationId}`}>Motivo del rechazo</label>
              <textarea id={`reject-note-${registrationId}`} className="input-field min-h-[88px]" maxLength={300}
                value={rejecting.note} aria-invalid={rejecting.error ? true : undefined}
                aria-describedby={rejecting.error ? `reject-note-error-${registrationId}` : undefined}
                onChange={(e) => setRejecting({ ...rejecting, note: e.target.value, error: '' })}
                placeholder="La foto está borrosa; envíe el documento completo." />
              {rejecting.error && <p id={`reject-note-error-${registrationId}`} className="mt-1.5 text-xs text-coral-600">{rejecting.error}</p>}
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="ghost" onClick={() => setRejecting(null)}>Cancelar</Button>
              <Button type="submit" variant="danger" loading={review.isPending}>Rechazar y avisar</Button>
            </div>
          </form>
        )}
      </Modal>

      <Modal open={!!marking} onClose={() => setMarking(null)} title={marking ? MANUAL_COPY[marking.state].title : ''} maxWidth={460}>
        {marking && (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              setState.mutate({ key: marking.item.key, state: marking.state, note: marking.note.trim() }, {
                onSuccess: () => { toast.success(`«${marking.item.name}» actualizado.`); setMarking(null); },
                onError: (err) => toast.error(apiErrorMessage(err, 'No se pudo guardar la marca.')),
              });
            }}
          >
            <p className="text-sm text-ink"><span className="font-semibold">{marking.item.name}</span></p>
            <p className="text-sm text-muted">{MANUAL_COPY[marking.state].hint}</p>
            <div>
              <label className="label" htmlFor={`mark-note-${registrationId}`}>Nota (opcional)</label>
              <textarea id={`mark-note-${registrationId}`} className="input-field min-h-[72px]" maxLength={300}
                value={marking.note} onChange={(e) => setMarking({ ...marking, note: e.target.value })}
                placeholder={marking.state === 'entregado_fisico' ? 'Original cotejado y 2 copias.' : 'Ingresa a Maternal: no tiene boleta anterior.'} />
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="ghost" onClick={() => setMarking(null)}>Cancelar</Button>
              <Button type="submit" loading={setState.isPending}>{MANUAL_COPY[marking.state].confirm}</Button>
            </div>
          </form>
        )}
      </Modal>

      <Modal open={!!whatsapp} onClose={() => setWhatsapp(null)} title="Recordatorio por WhatsApp" maxWidth={520}>
        {whatsapp && (
          <div className="space-y-3">
            <p className="text-sm text-muted">El mensaje lleva un enlace nuevo para subir documentos (el anterior deja de servir). Revíselo y envíelo desde WhatsApp.</p>
            <div className="relative">
              <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-cream-2 p-3 pr-10 font-sans text-sm text-ink">{whatsapp.whatsapp_text}</pre>
              <CopyButton value={whatsapp.whatsapp_text ?? ''} label="el mensaje" className="absolute right-2 top-2" />
            </div>
            {whatsapp.whatsapp_phone ? (
              <a href={waHref(whatsapp.whatsapp_phone, whatsapp.whatsapp_text ?? '')} target="_blank" rel="noopener noreferrer"
                className="btn-green w-full sm:w-auto" onClick={() => setWhatsapp(null)}>
                <MessageCircle size={16} aria-hidden="true" /> Abrir WhatsApp
              </a>
            ) : (
              <p className="rounded-md bg-amber/10 px-3 py-2 text-sm text-amber" role="status">La familia no tiene celular registrado. Copie el mensaje y envíelo por otro medio.</p>
            )}
          </div>
        )}
      </Modal>
    </section>
  );
}

function ChecklistRow({ item, fichaSubmitted, downloadingId, busy, onDownload, onApprove, onReject, onMark, onClear }: {
  item: ChecklistItem;
  fichaSubmitted: boolean;
  downloadingId: number | null;
  busy: boolean;
  onDownload: (file: ChecklistFile) => void;
  onApprove: (file: ChecklistFile) => void;
  onReject: (file: ChecklistFile) => void;
  onMark: (state: ManualState) => void;
  onClear: () => void;
}) {
  const ficha = item.kind === 'ficha';
  return (
    <li className="rounded-md bg-white p-3.5 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-ink">{item.name}</p>
          {item.physical_note && (
            <p className="mt-0.5 inline-flex items-center gap-1 text-xs text-subtle"><Package size={13} aria-hidden="true" /> En físico: {item.physical_note}</p>
          )}
          {ficha && <p className="mt-0.5 text-xs text-subtle">{fichaSubmitted ? 'La familia envió la ficha en línea.' : 'La familia aún no envía la ficha.'}</p>}
        </div>
        <DocStatusChip status={item.status} />
      </div>

      {item.manual && (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-sm bg-cream px-3 py-2 text-xs text-muted">
          <span>
            «{item.manual.state_label}»{item.manual.updated_by ? ` por ${item.manual.updated_by}` : ''}
            {item.manual.updated_at ? ` · ${fmtDate(item.manual.updated_at)}` : ''}
            {item.manual.note ? <span className="block text-ink">{item.manual.note}</span> : null}
          </span>
          <button type="button" className={clsx(ACTION, 'text-muted hover:bg-white hover:text-ink')} disabled={busy} onClick={onClear}>
            <Undo2 size={15} aria-hidden="true" /> Quitar marca
          </button>
        </div>
      )}

      {item.files.length > 0 ? (
        <ul className="mt-2 space-y-2" aria-label={`Archivos de ${item.name}`}>
          {item.files.map((file) => (
            <FileLine key={file.id} file={file} downloading={downloadingId === file.id} busy={busy}
              onDownload={() => onDownload(file)} onApprove={() => onApprove(file)} onReject={() => onReject(file)} />
          ))}
        </ul>
      ) : !ficha && !item.manual ? (
        <p className="mt-2 text-xs text-subtle">Sin archivos.</p>
      ) : null}

      {!item.manual && !(ficha && fichaSubmitted) && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          <button type="button" className={clsx(ACTION, 'bg-cream text-ink hover:bg-line')} disabled={busy} onClick={() => onMark('entregado_fisico')}>
            <Package size={15} aria-hidden="true" /> Entregado en físico
          </button>
          <button type="button" className={clsx(ACTION, 'bg-cream text-muted hover:bg-line')} disabled={busy} onClick={() => onMark('no_aplica')}>
            <CircleSlash size={15} aria-hidden="true" /> No aplica
          </button>
        </div>
      )}
    </li>
  );
}

function FileLine({ file, downloading, busy, onDownload, onApprove, onReject }: {
  file: ChecklistFile; downloading: boolean; busy: boolean;
  onDownload: () => void; onApprove: () => void; onReject: () => void;
}) {
  const meta = FILE_STATUS[file.status];
  const Icon = meta.icon;
  return (
    <li className="rounded-sm border border-line-2 px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2 text-sm">
          <FileText className="h-4 w-4 shrink-0 text-subtle" aria-hidden="true" />
          <span className="min-w-0 truncate text-ink">{file.filename}</span>
          <span className="shrink-0 text-xs text-subtle">{[fileSize(file.file_size), fmtDate(file.uploaded_at)].filter(Boolean).join(' · ')}</span>
        </div>
        <span className={clsx('inline-flex items-center gap-1 text-xs font-semibold', meta.cls)}>
          <Icon size={13} aria-hidden="true" /> {meta.label}
        </span>
      </div>
      {file.status === 'rejected' && file.review_note && <p className="mt-1 text-xs text-coral-700">Motivo: {file.review_note}</p>}
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        <button type="button" className={clsx(ACTION, 'bg-cream text-muted hover:bg-line')} disabled={downloading} onClick={onDownload}
          aria-label={`Descargar ${file.filename}`}>
          <Download size={15} aria-hidden="true" /> {downloading ? 'Descargando…' : 'Descargar'}
        </button>
        {file.status !== 'approved' && (
          <button type="button" className={clsx(ACTION, 'bg-green-50 text-green-700 hover:bg-green-100')} disabled={busy} onClick={onApprove}
            aria-label={`Aprobar ${file.filename}`}>
            <CheckCircle2 size={15} aria-hidden="true" /> Aprobar
          </button>
        )}
        {file.status !== 'rejected' && (
          <button type="button" className={clsx(ACTION, 'bg-coral-50 text-coral-700 hover:bg-coral-100')} disabled={busy} onClick={onReject}
            aria-label={`Rechazar ${file.filename}`}>
            <XCircle size={15} aria-hidden="true" /> Rechazar
          </button>
        )}
      </div>
    </li>
  );
}

export default DocumentChecklist;
