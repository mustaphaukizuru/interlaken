/**
 * Documentos de inscripción (/inscripcion/documentos?rid=&token=): the
 * document-upload link Admisiones sends, as a CMS page (slug
 * inscripcion-documentos). One locked section with every word editable; the
 * single-use link exchange, the list of required documents (from the
 * server) and the uploads are unchanged. The editor preview shows a sample
 * list instead of exchanging a link.
 */
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UploadCloud, CheckCircle2, XCircle, Clock, FileText, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';
import { Section } from '@/components/ui/Section';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { Badge } from '@/components/ui/Badge';
import { admissionsApi, type DocumentsListing } from '@/services/api';
import { useTokens, type CmsLink } from '../runtime';
import { useCmsPreview } from '../preview';
import { asLink, CmsAnchor, defineModule, f, inGroup, sectionsOf } from './kit';

const section = sectionsOf('documentos');

const MAX_BYTES = 10 * 1024 * 1024;
const STATUS: Record<string, { prop: string; variant: 'success' | 'warning' | 'error'; icon: typeof Clock }> = {
  pending: { prop: 'statusPending', variant: 'warning', icon: Clock },
  approved: { prop: 'statusApproved', variant: 'success', icon: CheckCircle2 },
  rejected: { prop: 'statusRejected', variant: 'error', icon: XCircle },
};

/** What the editor preview shows (no link is exchanged there). */
const SAMPLE: DocumentsListing = {
  child_name: 'Nombre del alumno',
  required: [{ code: 'birth_cert', label: 'Acta de nacimiento' }, { code: 'curp_doc', label: 'CURP' }, { code: 'photo', label: 'Fotografía' }],
  documents: [
    { id: 2, doc_type: 'curp_doc', filename: 'curp.pdf', status: 'rejected', review_note: 'La copia no se lee bien.', uploaded_at: '2026-11-02T10:00:00Z' },
    { id: 1, doc_type: 'birth_cert', filename: 'acta.pdf', status: 'approved', review_note: '', uploaded_at: '2026-11-01T10:00:00Z' },
  ],
} as unknown as DocumentsListing;

interface Props { contactLink?: CmsLink; [copy: string]: unknown }

function DocumentsView(p: Props) {
  const t = useTokens();
  const c = (key: string) => t(p[key]);
  const preview = useCmsPreview();
  const [params] = useSearchParams();
  const rid = Number(params.get('rid')) || null;
  const token = params.get('token') || '';
  const [session, setSession] = useState<string | null>(null);
  const [linkError, setLinkError] = useState(false);
  const booted = useRef(false);
  const qc = useQueryClient();

  useEffect(() => {
    if (preview || booted.current || !rid || !token) return;
    booted.current = true;
    admissionsApi.exchangeAccess(rid, token)
      .then(({ data }) => setSession(data.session_token))
      .catch(() => setLinkError(true));
  }, [rid, token, preview]);

  const { data: fetched, isLoading } = useQuery({
    queryKey: ['docs-listing', rid, session],
    queryFn: async () => (await admissionsApi.listDocuments(rid!, session!)).data as DocumentsListing,
    enabled: !preview && !!rid && !!session,
  });
  const data = preview ? SAMPLE : fetched;

  const upload = useMutation({
    mutationFn: ({ file, docType }: { file: File; docType: string }) => admissionsApi.uploadDocument(rid!, file, docType, session!),
    onSuccess: () => { toast.success(c('uploaded')); qc.invalidateQueries({ queryKey: ['docs-listing', rid, session] }); },
    onError: () => toast.error(c('uploadError')),
  });

  const onPick = (docType: string) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || preview) return;
    if (file.size > MAX_BYTES) { toast.error(c('tooBig')); return; }
    upload.mutate({ file, docType });
  };

  const invalid = !preview && (!rid || !token || linkError);
  const email = c('invalidEmail');
  const contact = asLink(p.contactLink);

  return (
    <div>
      <Section bg="cream" containerSize="md">
        <div className="mx-auto max-w-2xl">
          {p.label ? <span className="section-label-green inline-flex">{c('label')}</span> : null}
          <h1 className="mt-2 font-head text-fluid-3xl font-black tracking-[-0.02em] text-ink">{c('title')}</h1>
          {invalid ? (
            <div className="mt-6 rounded-xl2 border border-coral/30 bg-coral-50 p-5 text-sm text-ink" role="alert">
              <AlertTriangle className="mb-2 h-5 w-5 text-coral-600" aria-hidden="true" />
              {c('invalidText')}{email && ' '}
              {email && <a href={`mailto:${email}`} className="font-semibold text-purple underline">{email}</a>}{email && '.'}
            </div>
          ) : (!preview && !session) || isLoading || !data ? (
            <div className="mt-10 flex justify-center"><LoadingSpinner /></div>
          ) : (
            <>
              <p className="mt-2 text-sm text-muted">
                {c('childLabel')} <span className="font-semibold text-ink">{data.child_name}</span>. {c('intro')}
              </p>
              <ul className="mt-6 space-y-3">
                {data.required.map((req) => {
                  const latest = data.documents.filter((d) => d.doc_type === req.code).sort((a, b) => b.id - a.id)[0];
                  const meta = latest ? STATUS[latest.status] ?? STATUS.pending : null;
                  const Icon = meta?.icon ?? FileText;
                  return (
                    <li key={req.code} className="rounded-xl2 border border-line bg-white p-4 shadow-card">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex min-w-0 items-start gap-3">
                          <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${meta?.variant === 'success' ? 'bg-green/10 text-green-dark' : meta?.variant === 'error' ? 'bg-coral/10 text-coral' : 'bg-cream-2 text-muted'}`}>
                            <Icon className="h-4 w-4" aria-hidden="true" />
                          </span>
                          <div className="min-w-0">
                            <p className="font-semibold text-ink">{req.label}</p>
                            {latest ? (
                              <p className="truncate text-xs text-subtle">{latest.filename} · {new Date(latest.uploaded_at).toLocaleDateString('es-MX')}</p>
                            ) : (
                              <p className="text-xs text-subtle">{c('noFile')}</p>
                            )}
                            {latest?.status === 'rejected' && latest.review_note && (
                              <p className="mt-1 text-xs text-coral-600">{c('reasonLabel')} {latest.review_note}</p>
                            )}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          {meta && <Badge variant={meta.variant}>{c(meta.prop)}</Badge>}
                          {latest?.status !== 'approved' && (
                            <label className="btn-outline min-h-[40px] cursor-pointer px-3 text-xs">
                              <UploadCloud className="h-4 w-4" aria-hidden="true" /> {latest ? c('replaceLabel') : c('uploadLabel')}
                              <input type="file" className="sr-only" accept=".pdf,image/*" onChange={onPick(req.code)} disabled={upload.isPending} />
                            </label>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
              <p className="mt-6 text-xs text-subtle">
                {c('helpText')} <CmsAnchor link={contact} className="font-semibold text-purple underline">{t(contact.label)}</CmsAnchor>.
              </p>
            </>
          )}
        </div>
      </Section>
    </div>
  );
}

export const sections = [
  section({
    type: 'main', label: 'Documentos de inscripción · Subir documentos', locked: true,
    description: 'La página del enlace que Admisiones envía para subir documentos. La lista de documentos sale de Admisiones; aquí se editan todos los textos. La vista previa muestra un ejemplo.',
    component: DocumentsView,
    fields: [
      ...inGroup('Encabezado', [f.text('label', 'Etiqueta superior'), f.text('title', 'Título')]),
      ...inGroup('Lista', [
        f.text('childLabel', 'Antes del nombre del alumno'), f.textarea('intro', 'Instrucciones'),
        f.text('noFile', 'Documento sin archivo'), f.text('reasonLabel', 'Antes del motivo de corrección'),
        f.text('statusPending', 'Estado: en revisión'), f.text('statusApproved', 'Estado: aprobado'), f.text('statusRejected', 'Estado: por corregir'),
        f.text('uploadLabel', 'Botón «Subir»'), f.text('replaceLabel', 'Botón «Reemplazar»'),
        f.text('helpText', 'Ayuda: texto'), f.link('contactLink', 'Ayuda: enlace'),
      ]),
      ...inGroup('Mensajes', [
        f.text('uploaded', 'Documento subido'), f.text('uploadError', 'No se pudo subir'), f.text('tooBig', 'Archivo muy grande'),
        f.textarea('invalidText', 'Enlace usado o caducado'),
        f.text('invalidEmail', 'Correo para escribir', { hint: '{{correo}} = el correo de Ajustes. Vacío = sin correo.' }),
      ]),
    ],
    defaults: {
      label: 'Admisiones', title: 'Documentos de inscripción',
      childLabel: 'Alumno:', intro: 'Suba cada documento en PDF o imagen (máx. 10 MB). Admisiones lo revisará y le avisará por correo si algo necesita corrección.',
      noFile: 'Sin archivo', reasonLabel: 'Motivo:',
      statusPending: 'En revisión', statusApproved: 'Aprobado', statusRejected: 'Por corregir',
      uploadLabel: 'Subir', replaceLabel: 'Reemplazar',
      helpText: '¿Dudas?', contactLink: { label: 'Contacte a admisiones', href: '/contacto' },
      uploaded: 'Documento subido.', uploadError: 'No se pudo subir el archivo. Use PDF o imagen de máximo 10 MB.', tooBig: 'El archivo supera 10 MB.',
      invalidText: 'Este enlace ya se usó o caducó. Pida a admisiones un nuevo enlace de documentos, o escriba a',
      invalidEmail: '{{correo}}',
    },
  }),
];

export const templates = [{
  slug: 'inscripcion-documentos', path: '/inscripcion/documentos', title: 'Documentos de inscripción', group: 'documentos',
  seo: { title: 'Documentos de inscripción', description: 'Suba los documentos de inscripción de su hijo(a) al Colegio Interlaken.' },
  sections: ['documentos.main'],
}];

export default defineModule(sections, templates);
