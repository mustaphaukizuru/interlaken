/**
 * Documentos de inscripción (/inscripcion/documentos?rid=&token=): the
 * document-upload link Admisiones sends, as a CMS page (slug
 * inscripcion-documentos). One locked section with every word editable.
 *
 * Fase 4: the list is the student's level from Admisiones → Documentos
 * requeridos (status chips, what to bring on paper, the reason of a
 * rejection). Each document takes a photo (phones) or a file, several files
 * where the document allows them, with a progress bar per file. The
 * single-use link is exchanged once and its session kept for the tab
 * (sessionStorage, keyed by the link), so a reload after the camera opens
 * keeps working. The editor preview shows a sample list instead.
 */
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Camera, CheckCircle2, FileText, Package, RefreshCw, UploadCloud } from 'lucide-react';
import { clsx } from 'clsx';
import { Section } from '@/components/ui/Section';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { DocStatusChip } from '@/components/admissions/DocStatusChip';
import { exchangeOnce } from '@/lib/inviteExchange';
import { apiErrorMessage, apiErrorStatus } from '@/lib/apiErrors';
import { requiredDocsApi, type ChecklistFile, type ChecklistItem, type DocStatus, type FamilyChecklist } from '@/hooks/queries/requiredDocs';
import { useTokens, type CmsLink } from '../runtime';
import { useCmsPreview } from '../preview';
import { asLink, CmsAnchor, defineModule, f, fill, grouped, sectionsOf } from './kit';

const section = sectionsOf('documentos');

const STATUS_PROP: Record<DocStatus, string> = {
  falta: 'statusMissing',
  en_revision: 'statusPending',
  aprobado: 'statusApproved',
  rechazado: 'statusRejected',
  entregado_fisico: 'statusPhysical',
  no_aplica: 'statusNotApplicable',
};
const DONE: DocStatus[] = ['aprobado', 'entregado_fisico', 'no_aplica'];

const DEFAULT_LIMITS = { max_bytes: 10 * 1024 * 1024, extensions: ['.pdf', '.jpg', '.jpeg', '.png', '.doc', '.docx'], max_files: 10 };

const sampleItem = (o: Partial<ChecklistItem> & Pick<ChecklistItem, 'key' | 'name' | 'status'>): ChecklistItem => ({
  id: 0, description: '', physical_note: '', kind: 'upload', multiple_files: false, link_url: '', link_label: '',
  status_label: '', satisfied: DONE.includes(o.status), reasons: [], files: [], manual: null,
  can_upload: !DONE.includes(o.status), ...o,
});
const sampleFile = (id: number, filename: string, status: ChecklistFile['status'], review_note = ''): ChecklistFile => ({
  id, required_key: null, doc_type: 'other', filename, file_size: 240_000, uploaded_at: '2026-11-02T10:00:00Z', status, review_note, download_url: '',
});

/** What the editor preview shows (no link is exchanged there). */
const SAMPLE: FamilyChecklist = {
  registration: 0, child_name: 'Nombre del alumno', level: 'primaria', level_label: 'Primaria', ficha_submitted: true,
  counts: { total: 5, done: 2, approved: 2, physical: 0, not_applicable: 0, in_review: 1, rejected: 1, missing: 1 },
  complete: false, limits: DEFAULT_LIMITS,
  items: [
    sampleItem({ key: 'ficha', name: 'Ficha de inscripción', kind: 'ficha', status: 'aprobado' }),
    sampleItem({ key: 'acta', name: 'Acta de nacimiento', physical_note: 'Original y 2 copias', status: 'aprobado', files: [sampleFile(1, 'acta.pdf', 'approved')] }),
    sampleItem({ key: 'curp', name: 'CURP del alumno', physical_note: '2 copias', status: 'rechazado', reasons: ['La copia no se lee bien.'], files: [sampleFile(2, 'curp.jpg', 'rejected', 'La copia no se lee bien.')] }),
    sampleItem({ key: 'ine', name: 'INE de papá y mamá', physical_note: 'Copia', multiple_files: true, status: 'en_revision', files: [sampleFile(3, 'ine-papa.jpg', 'pending')] }),
    sampleItem({ key: 'comprobante', name: 'Comprobante de domicilio', description: 'No mayor a 3 meses.', physical_note: 'Copia', status: 'falta' }),
  ],
};

interface Job { id: string; name: string; percent: number; state: 'uploading' | 'error'; error?: string }

/* ── session: one exchange per link, kept for the tab ─────────────────────── */
// Keyed by the link itself: a new link from Admisiones is redeemed, a reload of
// the same one reuses its session (the invite token is single-use).
const storeKey = (rid: number, token: string) => `ik-docs-session:${rid}:${token.slice(0, 16)}`;
function readSession(rid: number | null, token: string): string | null {
  if (!rid || !token) return null;
  try {
    const raw = sessionStorage.getItem(storeKey(rid, token));
    if (!raw) return null;
    const v = JSON.parse(raw) as { session?: string; expires?: string };
    if (v.session && (!v.expires || new Date(v.expires).getTime() > Date.now())) return v.session;
  } catch { /* private mode or bad JSON: exchange again */ }
  return null;
}
function saveSession(rid: number, token: string, session: string, expires?: string) {
  try { sessionStorage.setItem(storeKey(rid, token), JSON.stringify({ session, expires })); } catch { /* private mode */ }
}
function dropSession(rid: number, token: string) {
  try { sessionStorage.removeItem(storeKey(rid, token)); } catch { /* private mode */ }
}

const isCoarsePointer = () => {
  try { return !!window.matchMedia?.('(pointer: coarse)').matches; } catch { return false; }
};

interface Props { contactLink?: CmsLink; [copy: string]: unknown }
type Copy = (key: string, values?: Record<string, string | number>) => string;

function DocumentsView(p: Props) {
  const t = useTokens();
  const c: Copy = (key, values) => {
    const text = t(p[key]);
    return values ? fill(text, values) : text;
  };
  const preview = useCmsPreview();
  const [params] = useSearchParams();
  const rid = Number(params.get('rid')) || null;
  const token = params.get('token') || '';
  const [session, setSession] = useState<string | null>(() => readSession(rid, token));
  const [linkError, setLinkError] = useState(false);
  const exchanged = useRef(false);
  const qc = useQueryClient();
  const [jobs, setJobs] = useState<Record<string, Job[]>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [live, setLive] = useState('');
  const [camera] = useState(isCoarsePointer);

  useEffect(() => {
    if (preview || session || !rid || !token || exchanged.current) return;
    exchanged.current = true;
    // Single-use link: exchanged once per tab even if the section remounts.
    exchangeOnce(rid, token)
      .then(({ data }) => { saveSession(rid, token, data.session_token, data.expires_at); setSession(data.session_token); })
      .catch(() => setLinkError(true));
  }, [rid, token, preview, session]);

  const listKey = ['docs-listing', rid, session] as const;
  const { data: fetched, isLoading, isError, error, refetch } = useQuery({
    queryKey: listKey,
    queryFn: async () => {
      try {
        return (await requiredDocsApi.familyList(rid!, session!)).data;
      } catch (err) {
        // The kept session expired: the link is used, so it cannot be redeemed again.
        if (apiErrorStatus(err) === 401) dropSession(rid!, token);
        throw err;
      }
    },
    enabled: !preview && !!rid && !!session,
    retry: false,
  });

  const data = preview ? SAMPLE : fetched;
  const limits = data?.limits ?? DEFAULT_LIMITS;
  const maxMb = Math.round(limits.max_bytes / (1024 * 1024));

  const patchJob = (key: string, id: string, patch: Partial<Job> | null) => setJobs((all) => {
    const list = all[key] ?? [];
    const next = patch === null ? list.filter((j) => j.id !== id) : list.map((j) => (j.id === id ? { ...j, ...patch } : j));
    return { ...all, [key]: next };
  });
  const setError = (key: string, message: string) => setErrors((e) => ({ ...e, [key]: message }));

  const upload = async (doc: ChecklistItem, picked: File[], replaces?: number) => {
    if (preview || !rid || !session || picked.length === 0) return;
    const files = doc.multiple_files ? picked : picked.slice(0, 1);
    for (const file of files) {
      const ext = (file.name.match(/\.[^.]+$/)?.[0] ?? '').toLowerCase();
      if (!limits.extensions.includes(ext)) { setError(doc.key, c('badType', { archivo: file.name })); return; }
      if (file.size > limits.max_bytes) { setError(doc.key, c('tooBig', { archivo: file.name, mb: maxMb })); return; }
    }
    if (doc.multiple_files && doc.files.length - (replaces ? 1 : 0) + files.length > limits.max_files) {
      setError(doc.key, c('tooMany', { max: limits.max_files }));
      return;
    }
    setError(doc.key, '');
    let ok = 0;
    for (const [i, file] of files.entries()) {
      // Unique enough: the buttons are disabled while a document uploads.
      const id = `${doc.key}-${file.name}-${file.size}-${file.lastModified}-${i}`;
      setJobs((all) => ({ ...all, [doc.key]: [...(all[doc.key] ?? []), { id, name: file.name, percent: 0, state: 'uploading' }] }));
      setLive(c('uploading', { archivo: file.name }));
      try {
        await requiredDocsApi.upload(rid, file, doc.key, {
          sessionToken: session, replaces: i === 0 ? replaces : undefined,
          onProgress: (percent) => patchJob(doc.key, id, { percent }),
        });
        patchJob(doc.key, id, null);
        ok += 1;
        setLive(`${file.name}: ${c('uploaded')}`);
      } catch (err) {
        const message = apiErrorMessage(err, c('uploadError'));
        patchJob(doc.key, id, { state: 'error', error: message });
        setLive(`${file.name}: ${message}`);
      }
    }
    if (ok) await qc.invalidateQueries({ queryKey: listKey });
  };

  const expired = isError && apiErrorStatus(error) === 401;
  const invalid = !preview && (!rid || linkError || expired || (!token && !session));
  const loadFailed = !preview && isError && !expired;
  const email = c('invalidEmail');
  const contact = asLink(p.contactLink);

  return (
    <div>
      <Section bg="cream" containerSize="md">
        <div className="mx-auto max-w-2xl">
          {p.label ? <span className="section-label-green inline-flex">{c('label')}</span> : null}
          <h1 className="mt-2 font-head text-fluid-3xl font-black tracking-[-0.02em] text-ink">{c('title')}</h1>
          <p className="sr-only" aria-live="polite" role="status">{live}</p>
          {invalid ? (
            <div className="mt-6 rounded-xl2 border border-coral/30 bg-coral-50 p-5 text-sm text-ink" role="alert">
              <AlertTriangle className="mb-2 h-5 w-5 text-coral-600" aria-hidden="true" />
              {c('invalidText')}{email && ' '}
              {email && <a href={`mailto:${email}`} className="font-semibold text-purple underline">{email}</a>}{email && '.'}
            </div>
          ) : loadFailed ? (
            <div className="mt-6 rounded-xl2 border border-line bg-white p-5 text-sm text-ink" role="alert">
              <p className="font-semibold">{c('loadError')}</p>
              <button type="button" onClick={() => refetch()} className="btn-outline mt-3">
                <RefreshCw className="h-4 w-4" aria-hidden="true" /> {c('retryLabel')}
              </button>
            </div>
          ) : (!preview && !session) || isLoading || !data ? (
            <div className="mt-10 flex justify-center" aria-busy="true"><LoadingSpinner /></div>
          ) : (
            <>
              <p className="mt-2 text-[15px] text-muted">
                {c('childLabel')} <span className="font-semibold text-ink">{data.child_name}</span>
                {data.level_label && <> · {c('levelLabel')} <span className="font-semibold text-ink">{data.level_label}</span></>}
              </p>
              <p className="mt-2 text-[15px] text-muted">{c('intro', { mb: maxMb })}</p>

              {data.items.length > 0 && (
                <Progress done={data.counts.done} total={data.counts.total} complete={data.complete}
                  label={c('progressLabel', { listos: data.counts.done, total: data.counts.total })} />
              )}
              {data.complete && data.items.length > 0 && (
                <div className="mt-4 flex items-start gap-3 rounded-xl2 border border-green/30 bg-green-50 p-4 text-sm text-ink" role="status">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-green-700" aria-hidden="true" />
                  <div><p className="font-semibold">{c('completeTitle')}</p><p className="text-muted">{c('completeText')}</p></div>
                </div>
              )}

              {data.items.length === 0 ? (
                <p className="mt-6 rounded-xl2 border border-dashed border-line bg-white p-5 text-center text-sm text-muted">{c('emptyText')}</p>
              ) : (
                <ul className="mt-6 space-y-3">
                  {data.items.map((doc) => (
                    <DocCard key={doc.key} doc={doc} c={c} camera={camera} fichaSubmitted={data.ficha_submitted}
                      jobs={jobs[doc.key] ?? []} error={errors[doc.key] ?? ''} disabled={preview}
                      onPick={(files, replaces) => void upload(doc, files, replaces)}
                      onDismiss={(id) => patchJob(doc.key, id, null)} />
                  ))}
                </ul>
              )}
              <p className="mt-6 text-sm text-subtle">
                {c('helpText')} <CmsAnchor link={contact} className="font-semibold text-purple underline">{t(contact.label)}</CmsAnchor>.
              </p>
            </>
          )}
        </div>
      </Section>
    </div>
  );
}

function Progress({ done, total, label, complete }: { done: number; total: number; label: string; complete: boolean }) {
  const percent = total ? Math.round((done / total) * 100) : 100;
  return (
    <div className="mt-5">
      <p className="mb-1.5 text-sm font-semibold text-ink" id="docs-progress-label">{label}</p>
      <div role="progressbar" aria-labelledby="docs-progress-label" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}
        className="h-2.5 overflow-hidden rounded-full bg-white ring-1 ring-inset ring-line">
        <div className={clsx('h-full rounded-full transition-all', complete ? 'bg-green-strong' : 'bg-purple')} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

function DocCard({ doc, c, camera, fichaSubmitted, jobs, error, disabled, onPick, onDismiss }: {
  doc: ChecklistItem; c: Copy; camera: boolean; fichaSubmitted: boolean; jobs: Job[]; error: string; disabled: boolean;
  onPick: (files: File[], replaces?: number) => void; onDismiss: (id: string) => void;
}) {
  const ficha = doc.kind === 'ficha';
  const uploading = jobs.some((j) => j.state === 'uploading');
  const errorId = `doc-error-${doc.key}`;
  const chipStatus: DocStatus = ficha && !fichaSubmitted && doc.status === 'falta' ? 'falta' : doc.status;
  const chipLabel = ficha && doc.status === 'aprobado' ? c('fichaDone')
    : ficha && doc.status === 'falta' ? c('fichaPending')
    : c(STATUS_PROP[doc.status]);
  const pickLabel = doc.multiple_files && doc.files.length > 0 ? c('addLabel')
    : doc.files.length > 0 ? c('replaceLabel') : c('uploadLabel');
  const describedBy = error ? errorId : undefined;
  const busy = disabled || uploading;

  return (
    <li className="rounded-xl2 border border-line bg-white p-4 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold text-ink">{doc.name}</h2>
          {doc.description && <p className="mt-0.5 text-sm text-muted">{doc.description}</p>}
          {ficha && <p className="mt-0.5 text-sm text-muted">{c('fichaText')}</p>}
          {doc.physical_note && (
            <p className="mt-1 flex items-start gap-1.5 text-sm text-subtle">
              <Package className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{c('physicalLabel')} <span className="text-ink">{doc.physical_note}</span></span>
            </p>
          )}
        </div>
        <DocStatusChip status={chipStatus} label={chipLabel} />
      </div>

      {!doc.multiple_files && doc.status === 'rechazado' && doc.reasons.length > 0 && (
        <p className="mt-2 rounded-lg bg-coral-50 px-3 py-2 text-sm text-coral-700">{c('reasonLabel')} {doc.reasons.join(' ')}</p>
      )}

      {doc.files.length > 0 && (
        <ul className="mt-3 space-y-1.5" aria-label={doc.name}>
          {doc.files.map((file) => (
            <li key={file.id} className="rounded-lg bg-cream-2 px-3 py-2 text-sm">
              <div className="flex min-w-0 items-center gap-2">
                <FileText className="h-4 w-4 shrink-0 text-subtle" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate text-ink">{file.filename}</span>
                <span className="shrink-0 text-xs text-subtle">{new Date(file.uploaded_at).toLocaleDateString('es-MX')}</span>
              </div>
              {doc.multiple_files && file.status === 'rejected' && (
                <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-coral-700">{c('reasonLabel')} {file.review_note || c('statusRejected')}</p>
                  {doc.can_upload && (
                    <FilePick label={c('replaceLabel')} accept="image/*,application/pdf" multiple={false} disabled={busy}
                      describedBy={describedBy} onPick={(files) => onPick(files, file.id)} />
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {!ficha && doc.files.length === 0 && doc.can_upload && <p className="mt-2 text-sm text-subtle">{c('noFile')}</p>}

      {jobs.length > 0 && (
        <ul className="mt-3 space-y-2">
          {jobs.map((job) => (
            <li key={job.id} className="text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-ink">{job.name}</span>
                {job.state === 'uploading'
                  ? <span className="shrink-0 tabular-nums text-subtle">{job.percent}%</span>
                  : <button type="button" className="min-h-[44px] shrink-0 px-2 text-sm font-semibold text-purple underline" onClick={() => onDismiss(job.id)}>{c('dismissLabel')}</button>}
              </div>
              {job.state === 'uploading' ? (
                <div role="progressbar" aria-label={c('uploading', { archivo: job.name })} aria-valuemin={0} aria-valuemax={100} aria-valuenow={job.percent}
                  className="mt-1 h-2 overflow-hidden rounded-full bg-cream ring-1 ring-inset ring-line">
                  <div className="h-full rounded-full bg-purple transition-all" style={{ width: `${job.percent}%` }} />
                </div>
              ) : (
                <p className="mt-0.5 text-coral-700">{job.error}</p>
              )}
            </li>
          ))}
        </ul>
      )}

      {error && <p id={errorId} className="mt-2 text-sm text-coral-700" role="alert">{error}</p>}

      {doc.can_upload && !ficha && (
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          {doc.multiple_files && <p className="w-full text-xs text-subtle">{c('multipleHint')}</p>}
          {camera && (
            <FilePick label={c('cameraLabel')} icon="camera" accept="image/*" capture multiple={false} disabled={busy}
              describedBy={describedBy} onPick={(files) => onPick(files)} primary />
          )}
          <FilePick label={pickLabel} accept="image/*,application/pdf" multiple={doc.multiple_files} disabled={busy}
            describedBy={describedBy} onPick={(files) => onPick(files)} primary={!camera} />
        </div>
      )}
    </li>
  );
}

function FilePick({ label, accept, capture, multiple, disabled, describedBy, onPick, icon = 'upload', primary = false }: {
  label: string; accept: string; capture?: boolean; multiple: boolean; disabled: boolean; describedBy?: string;
  onPick: (files: File[]) => void; icon?: 'camera' | 'upload'; primary?: boolean;
}) {
  const Icon = icon === 'camera' ? Camera : UploadCloud;
  return (
    <label
      className={clsx(
        'inline-flex min-h-[44px] cursor-pointer items-center justify-center gap-2 rounded-full border-2 border-purple px-4 text-sm font-semibold transition focus-within:ring-2 focus-within:ring-purple/40 focus-within:ring-offset-2',
        primary ? 'bg-purple text-white hover:bg-purple-mid' : 'bg-white text-purple hover:bg-purple hover:text-white',
        disabled && 'pointer-events-none opacity-50',
      )}
    >
      <Icon className="h-4 w-4" aria-hidden="true" /> {label}
      <input
        type="file"
        className="sr-only"
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        aria-describedby={describedBy}
        {...(capture ? { capture: 'environment' as const } : {})}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          if (files.length) onPick(files);
        }}
      />
    </label>
  );
}

export const sections = [
  section({
    type: 'main', label: 'Documentos de inscripción · Subir documentos', locked: true,
    description: 'La página del enlace que Admisiones envía para subir documentos. La lista sale de Admisiones → Documentos requeridos (la del nivel del alumno); aquí se editan todos los textos. La vista previa muestra un ejemplo.',
    component: DocumentsView,
    fields: [
      ...grouped('Encabezado', [f.text('label', 'Etiqueta superior'), f.text('title', 'Título')]),
      ...grouped('Resumen', [
        f.text('childLabel', 'Antes del nombre del alumno'), f.text('levelLabel', 'Antes del nivel'),
        f.textarea('intro', 'Instrucciones', { hint: '{mb} = tamaño máximo de cada archivo.' }),
        f.text('progressLabel', 'Avance', { hint: '{listos} = documentos listos; {total} = documentos del nivel.' }),
        f.text('completeTitle', 'Todo listo: título'), f.textarea('completeText', 'Todo listo: texto'),
        f.text('emptyText', 'Sin documentos para el nivel'),
      ]),
      ...grouped('Documentos', [
        f.text('physicalLabel', 'Antes de lo que se entrega en físico'), f.text('multipleHint', 'Aviso: varios archivos'),
        f.text('fichaText', 'Ficha: explicación'), f.text('fichaDone', 'Ficha: enviada'), f.text('fichaPending', 'Ficha: pendiente'),
        f.text('noFile', 'Documento sin archivo'), f.text('reasonLabel', 'Antes del motivo de corrección'),
        f.text('statusMissing', 'Estado: falta'), f.text('statusPending', 'Estado: en revisión'), f.text('statusApproved', 'Estado: aprobado'),
        f.text('statusRejected', 'Estado: por corregir'), f.text('statusPhysical', 'Estado: entregado en físico'),
        f.text('statusNotApplicable', 'Estado: no aplica'),
        f.text('cameraLabel', 'Botón «Tomar foto» (teléfonos)'), f.text('uploadLabel', 'Botón «Elegir archivo»'),
        f.text('addLabel', 'Botón «Agregar otro archivo»'), f.text('replaceLabel', 'Botón «Reemplazar»'),
        f.text('helpText', 'Ayuda: texto'), f.link('contactLink', 'Ayuda: enlace'),
      ]),
      ...grouped('Mensajes', [
        f.text('uploading', 'Subiendo', { hint: '{archivo} = nombre del archivo.' }),
        f.text('uploaded', 'Documento subido'), f.text('uploadError', 'No se pudo subir'),
        f.text('dismissLabel', 'Botón «Quitar aviso»'),
        f.text('tooBig', 'Archivo muy grande', { hint: '{archivo} = nombre del archivo; {mb} = tamaño máximo.' }),
        f.text('badType', 'Tipo de archivo no válido', { hint: '{archivo} = nombre del archivo.' }),
        f.text('tooMany', 'Demasiados archivos', { hint: '{max} = archivos por documento.' }),
        f.text('loadError', 'No se pudo cargar la lista'), f.text('retryLabel', 'Botón «Reintentar»'),
        f.textarea('invalidText', 'Enlace usado o caducado'),
        f.text('invalidEmail', 'Correo para escribir'),
      ]),
    ],
    defaults: {
      label: 'Admisiones', title: 'Documentos de inscripción',
      childLabel: 'Alumno:', levelLabel: 'Nivel:',
      intro: 'Tome una foto clara o suba un PDF de cada documento (máximo {mb} MB por archivo). Admisiones lo revisará y le avisará por correo si algo necesita corrección.',
      progressLabel: '{listos} de {total} documentos listos',
      completeTitle: 'Sus documentos están completos', completeText: 'Gracias. Admisiones le avisará si algo necesita corrección.',
      emptyText: 'No hay documentos que subir para este nivel.',
      physicalLabel: 'Entregar en físico:', multipleHint: 'Puede subir varios archivos (por ejemplo, frente y reverso).',
      fichaText: 'Se llena en línea.', fichaDone: 'Enviada', fichaPending: 'Pendiente de enviar',
      noFile: 'Aún no ha subido este documento.', reasonLabel: 'Motivo:',
      statusMissing: 'Falta', statusPending: 'En revisión', statusApproved: 'Aprobado', statusRejected: 'Por corregir',
      statusPhysical: 'Entregado en físico', statusNotApplicable: 'No aplica',
      cameraLabel: 'Tomar foto', uploadLabel: 'Elegir archivo', addLabel: 'Agregar otro archivo', replaceLabel: 'Reemplazar',
      helpText: '¿Dudas?', contactLink: { label: 'Contacte a admisiones', href: '/contacto' },
      uploading: 'Subiendo {archivo}', uploaded: 'Documento subido.', dismissLabel: 'Quitar aviso',
      uploadError: 'No se pudo subir el archivo. Use PDF o imagen de máximo 10 MB.',
      tooBig: 'El archivo {archivo} supera {mb} MB. Tome la foto de nuevo o reduzca el PDF.',
      badType: 'El archivo {archivo} no es PDF ni imagen (JPG o PNG).',
      tooMany: 'Este documento admite hasta {max} archivos.',
      loadError: 'No se pudo cargar la lista de documentos. Revise su conexión e intente de nuevo.', retryLabel: 'Reintentar',
      invalidText: 'Este enlace ya se usó o caducó. Pida a admisiones un nuevo enlace de documentos, o escriba a',
      invalidEmail: '{{correo}}',
    },
  }),
];

export const templates = [{
  slug: 'inscripcion-documentos', path: '/inscripcion/documentos', title: 'Documentos de inscripción', group: 'documentos',
  seo: {}, // title, description and noindex: lib/routeMeta.ts ROUTE_META
  sections: ['documentos.main'],
  // Sign-in and one-time links never wait for the CMS (TemplatePage).
  paintAtOnce: true,
}];

export default defineModule(sections, templates);
