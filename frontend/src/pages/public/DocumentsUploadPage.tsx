import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UploadCloud, CheckCircle2, XCircle, Clock, FileText, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';
import { Seo } from '@/components/seo/Seo';
import { Section } from '@/components/ui/Section';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { Badge } from '@/components/ui/Badge';
import { admissionsApi, type DocumentsListing } from '@/services/api';

const MAX_BYTES = 10 * 1024 * 1024;
const STATUS: Record<string, { label: string; variant: 'success' | 'warning' | 'error'; icon: typeof Clock }> = {
  pending: { label: 'En revisión', variant: 'warning', icon: Clock },
  approved: { label: 'Aprobado', variant: 'success', icon: CheckCircle2 },
  rejected: { label: 'Por corregir', variant: 'error', icon: XCircle },
};

/**
 * /inscripcion/documentos?rid=&token= — standalone document upload (BACKLOG P1-G4).
 * The link is single-use (invite token → session); each required document shows
 * its review status and can be re-uploaded when rejected.
 */
export default function DocumentsUploadPage() {
  const [params] = useSearchParams();
  const rid = Number(params.get('rid')) || null;
  const token = params.get('token') || '';
  const [session, setSession] = useState<string | null>(null);
  const [linkError, setLinkError] = useState(false);
  const booted = useRef(false);
  const qc = useQueryClient();

  useEffect(() => {
    if (booted.current || !rid || !token) return;
    booted.current = true;
    admissionsApi.exchangeAccess(rid, token)
      .then(({ data }) => setSession(data.session_token))
      .catch(() => setLinkError(true));
  }, [rid, token]);

  const { data, isLoading } = useQuery({
    queryKey: ['docs-listing', rid, session],
    queryFn: async () => (await admissionsApi.listDocuments(rid!, session!)).data as DocumentsListing,
    enabled: !!rid && !!session,
  });

  const upload = useMutation({
    mutationFn: ({ file, docType }: { file: File; docType: string }) => admissionsApi.uploadDocument(rid!, file, docType, session!),
    onSuccess: () => { toast.success('Documento subido.'); qc.invalidateQueries({ queryKey: ['docs-listing', rid, session] }); },
    onError: () => toast.error('No se pudo subir el archivo. Use PDF o imagen de máximo 10 MB.'),
  });

  const onPick = (docType: string) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > MAX_BYTES) { toast.error('El archivo supera 10 MB.'); return; }
    upload.mutate({ file, docType });
  };

  const invalid = !rid || !token || linkError;

  return (
    <div>
      <Seo title="Documentos de inscripción" description="Suba los documentos de inscripción de su hijo(a) al Colegio Interlaken." />
      <Section bg="cream" containerSize="md">
        <div className="mx-auto max-w-2xl">
          <span className="section-label-green inline-flex">Admisiones</span>
          <h1 className="mt-2 font-head text-fluid-3xl font-black tracking-[-0.02em] text-ink">Documentos de inscripción</h1>
          {invalid ? (
            <div className="mt-6 rounded-xl2 border border-coral/30 bg-coral-50 p-5 text-sm text-ink" role="alert">
              <AlertTriangle className="mb-2 h-5 w-5 text-coral-600" aria-hidden="true" />
              Este enlace ya se usó o caducó. Pida a admisiones un nuevo enlace de documentos, o escriba a{' '}
              <a href="mailto:info@interlaken.com.mx" className="font-semibold text-purple underline">info@interlaken.com.mx</a>.
            </div>
          ) : !session || isLoading || !data ? (
            <div className="mt-10 flex justify-center"><LoadingSpinner /></div>
          ) : (
            <>
              <p className="mt-2 text-sm text-muted">
                Alumno: <span className="font-semibold text-ink">{data.child_name}</span>. Suba cada documento en PDF o imagen (máx. 10 MB).
                Admisiones lo revisará y le avisará por correo si algo necesita corrección.
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
                              <p className="text-xs text-subtle">Sin archivo</p>
                            )}
                            {latest?.status === 'rejected' && latest.review_note && (
                              <p className="mt-1 text-xs text-coral-600">Motivo: {latest.review_note}</p>
                            )}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          {meta && <Badge variant={meta.variant}>{meta.label}</Badge>}
                          {latest?.status !== 'approved' && (
                            <label className="btn-outline min-h-[40px] cursor-pointer px-3 text-xs">
                              <UploadCloud className="h-4 w-4" aria-hidden="true" /> {latest ? 'Reemplazar' : 'Subir'}
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
                ¿Dudas? <Link to="/contacto" className="font-semibold text-purple underline">Contacte a admisiones</Link>.
              </p>
            </>
          )}
        </div>
      </Section>
    </div>
  );
}
