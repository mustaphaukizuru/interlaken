import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, FileWarning, Mail, MessageCircle, UserPlus, KanbanSquare } from 'lucide-react';
import toast from 'react-hot-toast';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { ListSkeleton } from '@/components/ui/ListSkeleton';
import { ErrorState } from '@/components/ui/ErrorState';
import { admissionsApi, type PipelineCard, type ConvertResult } from '@/services/api';
import { useSiteSettings } from '@/hooks/useSiteSettings';
import { credentialTemplate, mailtoDeliveryHref, whatsappDeliveryHref } from '@/lib/credentialTemplates';
import { apiErrors } from '@/cms/editor/helpers';

const TONE: Record<string, 'info' | 'warning' | 'success' | 'neutral' | 'error'> = { submitted: 'info', reviewing: 'warning', approved: 'success', complete: 'neutral', rejected: 'error' };

/** Docs progress label for a card. */
export function docsLabel(c: Pick<PipelineCard, 'docs_verified' | 'docs_required' | 'missing'>): string {
  if (c.missing.length === 0 && c.docs_verified === c.docs_required) return 'Expediente completo';
  if (c.missing.length === 0) return `${c.docs_verified}/${c.docs_required} verificados`;
  return `Faltan ${c.missing.length}: ${c.missing.slice(0, 2).join(', ')}${c.missing.length > 2 ? '…' : ''}`;
}

/** /admin/admisiones/pipeline — kanban of inscripciones (BACKLOG P4-1). */
export default function AdminPipeline() {
  const qc = useQueryClient();
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['admissions-pipeline'], queryFn: async () => (await admissionsApi.pipeline()).data });
  const [converting, setConverting] = useState<PipelineCard | null>(null);
  const [studentId, setStudentId] = useState('');
  const [group, setGroup] = useState('');
  const [result, setResult] = useState<ConvertResult | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const invalidate = () => { qc.invalidateQueries({ queryKey: ['admissions-pipeline'] }); qc.invalidateQueries({ queryKey: ['badges'] }); qc.invalidateQueries({ queryKey: ['admin-students'] }); };
  const requestDocs = useMutation({
    mutationFn: (id: number) => admissionsApi.requestDocs(id),
    onSuccess: ({ data: r }) => { toast.success(`Solicitud enviada a ${r.sent_to}.`); invalidate(); },
    onError: (e) => toast.error(apiErrors(e).detail || 'No se pudo enviar.'),
  });
  const convert = useMutation({
    mutationFn: () => admissionsApi.convert(converting!.id, { student_id: studentId || undefined, group: group || undefined }),
    onSuccess: ({ data: r }) => { setResult(r); setErrors({}); invalidate(); toast.success(r.already ? 'Este expediente ya era alumno.' : 'Alumno y cuentas creados.'); },
    onError: (e) => { const f = apiErrors(e); setErrors(f); toast.error(f.detail || f.student_id || 'No se pudo convertir.'); },
  });

  return (
    <>
      <PageHeader title="Pipeline de inscripciones" subtitle="De solicitud enviada a alumno inscrito. Pida los documentos que faltan con un clic y convierta el expediente aprobado en alumno con sus cuentas de familia."
        actions={<Link to="/admin/admisiones" className="btn-outline">Lista clásica</Link>} />
      {isError ? <ErrorState onRetry={() => refetch()} /> : isLoading || !data ? <ListSkeleton /> : (
        <div className="-mx-4 px-4 pb-4 md:overflow-x-auto">
          <div className="grid grid-cols-1 gap-3 md:min-w-[1100px] md:grid-cols-5" role="list" aria-label="Columnas del pipeline">
            {data.columns.map((col) => (
              <section key={col.status} role="listitem" aria-label={col.label} className="rounded-xl2 bg-cream-2 p-2">
                <h2 className="mb-2 flex items-center justify-between px-1 text-xs font-bold uppercase tracking-wide text-subtle"><span className="inline-flex items-center gap-1"><KanbanSquare size={12} aria-hidden="true" /> {col.label}</span><span>{col.cards.length}</span></h2>
                <ul className="space-y-2">
                  {col.cards.length === 0 && <li className="rounded-lg border border-dashed border-line p-3 text-center text-xs text-subtle">Vacío</li>}
                  {col.cards.map((c) => (
                    <li key={c.id} className="rounded-xl border border-line bg-white p-3 text-sm shadow-card">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <Link to={`/admin/admisiones?inscripcion=${c.id}`} className="block truncate font-semibold text-ink hover:text-purple">{c.child_name}</Link>
                          <p className="truncate text-xs text-subtle">{c.grade_applying} · {c.parent_name}</p>
                        </div>
                        <Badge variant={TONE[c.status] ?? 'neutral'}>{col.label}</Badge>
                      </div>
                      <p className={`mt-2 inline-flex items-center gap-1 text-xs ${c.missing.length ? 'text-amber' : 'text-green-700'}`}>
                        {c.missing.length ? <FileWarning size={13} aria-hidden="true" /> : <CheckCircle2 size={13} aria-hidden="true" />} {docsLabel(c)}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {c.missing.length > 0 && c.status !== 'rejected' && c.status !== 'complete' && (
                          <Button size="sm" variant="secondary" onClick={() => requestDocs.mutate(c.id)} loading={requestDocs.isPending && requestDocs.variables === c.id}><Mail size={13} aria-hidden="true" /> Pedir documentos</Button>
                        )}
                        {(c.status === 'approved' || c.status === 'reviewing') && !c.student && (
                          <Button size="sm" onClick={() => { setConverting(c); setStudentId(''); setGroup(''); setResult(null); setErrors({}); }}><UserPlus size={13} aria-hidden="true" /> Convertir en alumno</Button>
                        )}
                        {c.student && <Link to={`/admin/alumnos/${c.student}`} className="btn-outline btn-sm text-xs">Ver alumno</Link>}
                        {c.parent_phone && <a href={`https://wa.me/52${c.parent_phone.replace(/\D/g, '').slice(-10)}`} target="_blank" rel="noopener noreferrer" className="btn-outline btn-sm text-xs" aria-label={`WhatsApp a ${c.parent_name}`}><MessageCircle size={13} aria-hidden="true" /></a>}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </div>
      )}

      <Modal open={!!converting} onClose={() => setConverting(null)} title={result ? 'Alumno creado' : `Convertir a alumno: ${converting?.child_name ?? ''}`} maxWidth={560}>
        {result ? <ConvertSummary result={result} card={converting!} onClose={() => setConverting(null)} /> : (
          <div className="space-y-3">
            <p className="text-sm text-muted">Se crea el alumno con los datos del expediente (incluidos los médicos), su acceso escolar y las cuentas de madre/padre. Las contraseñas nuevas se muestran una sola vez para que usted las envíe.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label="Matrícula (opcional)" value={studentId} onChange={(e) => setStudentId(e.target.value)} placeholder="Automática" error={errors.student_id} />
              <Input label="Grupo (opcional)" value={group} onChange={(e) => setGroup(e.target.value.toUpperCase())} placeholder="A" maxLength={5} />
            </div>
            {errors.detail && <p className="text-sm text-coral-600">{errors.detail}</p>}
            <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setConverting(null)}>Cancelar</Button><Button onClick={() => convert.mutate()} loading={convert.isPending}>Crear alumno y cuentas</Button></div>
          </div>
        )}
      </Modal>
    </>
  );
}

function ConvertSummary({ result, card, onClose }: { result: ConvertResult; card: PipelineCard; onClose: () => void }) {
  const settings = useSiteSettings();
  return (
    <div className="space-y-4">
      <p className="text-sm text-ink">Matrícula <strong>{result.student_id}</strong>. <Link to={`/admin/alumnos/${result.student}`} className="font-semibold text-purple underline">Abrir expediente del alumno</Link></p>
      {result.credentials.length > 0 && (
        <ul className="space-y-3" aria-label="Cuentas de familia">
          {result.credentials.map((c) => {
            const t = c.password ? credentialTemplate({ firstName: (c.name || '').split(' ')[0], email: c.email, password: c.password, supportEmail: settings.contact_email }) : null;
            const wa = t ? whatsappDeliveryHref(card.parent_phone, t) : null;
            return (
              <li key={c.email} className="rounded-xl border border-line p-3 text-sm">
                <p className="font-semibold text-ink">{c.name || c.email}</p>
                {c.password ? (
                  <>
                    <p className="text-xs text-subtle">Usuario {c.email} · contraseña <code className="select-all rounded bg-cream-2 px-1">{c.password}</code></p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {wa && <a href={wa} target="_blank" rel="noopener noreferrer" className="btn-secondary btn-sm text-xs"><MessageCircle size={13} aria-hidden="true" /> WhatsApp</a>}
                      <a href={mailtoDeliveryHref(c.email, t!)} className="btn-outline btn-sm text-xs"><Mail size={13} aria-hidden="true" /> Correo</a>
                    </div>
                  </>
                ) : <p className="text-xs text-subtle">Ya tenía cuenta ({c.email}); se vinculó al alumno.</p>}
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex justify-end"><Button onClick={onClose}>Listo</Button></div>
    </div>
  );
}
