/**
 * /admin/aviso-privacidad: the official privacy notice (apps/legal/notices.py).
 *
 * The notice is versioned for consent: each family's consent stays tied to
 * the exact version it accepted. This screen lists the versions with how many
 * consents each holds, creates a draft from the current text («Nueva
 * versión»), edits it part by part, previews it exactly as the public page
 * renders it, and publishes it after a confirmation that explains what
 * happens to consents. Published versions are read-only. Admin only.
 */
import { useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowLeft, ArrowUp, ExternalLink, Eye, FilePlus2, Lock, PencilLine, Plus, Send, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { ListSkeleton } from '@/components/ui/ListSkeleton';
import { ErrorState } from '@/components/ui/ErrorState';
import { apiFieldErrors } from '@/lib/apiErrors';
import { formatDateTime } from '@/lib/format';
import { fromEditable, MIN_PARTS, noticeProblems, toEditable, type EditableNotice } from '@/lib/noticeText';
import { legalNoticesApi, type NoticeStatus, type NoticeVersion } from '@/services/legalNoticesApi';
import { withDefaults } from '@/cms/blocks/specs';
import { usePublishedPage } from '@/cms/published';
import aviso, { AvisoHero, AvisoNoticeBody, sectionIcon, type PrivacyNotice } from '@/cms/sections/aviso';

const BASE = '/admin/aviso-privacidad';
const LIST_KEY = ['legal-notices'] as const;

const STATUS: Record<NoticeStatus, { label: string; variant: 'success' | 'info' | 'neutral' }> = {
  vigente: { label: 'Vigente', variant: 'success' },
  borrador: { label: 'Borrador', variant: 'info' },
  anterior: { label: 'Anterior', variant: 'neutral' },
};

/** «9 de julio de 2026» from a YYYY-MM-DD date (no time zone shift). */
function longDate(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  if (!m) return '';
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' });
}
const plural = (n: number, one: string, many: string) => `${n.toLocaleString('es-MX')} ${n === 1 ? one : many}`;

export default function AdminPrivacyNotice() {
  const { id } = useParams();
  return id ? <VersionView id={Number(id)} /> : <VersionsOverview />;
}

/* ── Overview ───────────────────────────────────────────────────────────── */
function useVersions() {
  return useQuery({ queryKey: LIST_KEY, queryFn: async () => (await legalNoticesApi.list()).data });
}

function VersionsOverview() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data, isLoading, isError, refetch } = useVersions();
  const create = useMutation({
    mutationFn: () => legalNoticesApi.createDraft(),
    onSuccess: (res) => { void qc.invalidateQueries({ queryKey: LIST_KEY }); navigate(`${BASE}/${res.data.id}`); },
    onError: (e) => toast.error(apiFieldErrors(e).detail || 'No se pudo crear la versión nueva.'),
  });
  const versions = data?.results ?? [];
  const current = versions.find((v) => v.status === 'vigente');
  const draft = versions.find((v) => v.status === 'borrador');

  return (
    <>
      <PageHeader
        title="Aviso de privacidad"
        subtitle="El texto legal que aceptan las familias. Cada versión publicada se guarda con los consentimientos que recibió; para cambiar el texto se publica una versión nueva."
      />
      {isLoading ? <Card><ListSkeleton /></Card> : isError ? (
        <Card><ErrorState title="No se pudieron cargar las versiones del aviso" onRetry={() => refetch()} /></Card>
      ) : (
        <div className="space-y-6">
          <Card>
            <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wide text-subtle">Versión vigente</p>
                {current ? (
                  <>
                    <p className="mt-1 font-head text-3xl font-black tracking-tight text-ink tabular-nums">{current.version}</p>
                    <p className="mt-1 text-sm text-muted">{current.title} · vigente desde el {longDate(current.effective_date)}</p>
                    <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink">
                      <span><strong className="tabular-nums">{plural(current.consent_count, 'consentimiento', 'consentimientos')}</strong> registrados con esta versión</span>
                      <span><strong className="tabular-nums">{plural(current.registration_count, 'inscripción', 'inscripciones')}</strong> la aceptaron</span>
                    </p>
                  </>
                ) : (
                  <p className="mt-1 text-sm text-coral-600">No hay una versión vigente: el sitio muestra «Aviso no disponible». Publique una versión.</p>
                )}
              </div>
              <div className="flex flex-col gap-2 sm:flex-row lg:flex-col lg:items-stretch">
                {draft ? (
                  <Link to={`${BASE}/${draft.id}`} className="btn-primary min-h-[44px] justify-center"><PencilLine size={16} aria-hidden="true" /> Continuar el borrador {draft.version}</Link>
                ) : (
                  <Button className="min-h-[44px] justify-center" onClick={() => create.mutate()} loading={create.isPending}><FilePlus2 size={16} aria-hidden="true" /> Nueva versión</Button>
                )}
                {current && <Link to={`${BASE}/${current.id}`} className="btn-outline min-h-[44px] justify-center"><Eye size={16} aria-hidden="true" /> Ver el texto vigente</Link>}
                <a href="/aviso-de-privacidad" target="_blank" rel="noopener noreferrer" className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full px-4 text-sm font-semibold text-muted transition-colors hover:bg-cream hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/30"><ExternalLink size={16} aria-hidden="true" /> Ver en el sitio</a>
              </div>
            </div>
          </Card>

          <Card title="Cómo se cambia el aviso">
            <ol className="grid gap-3 text-sm text-muted sm:grid-cols-3">
              {[
                ['Nueva versión', 'Copia el texto vigente en un borrador. Nada cambia en el sitio todavía.'],
                ['Editar y revisar', 'Cambie los apartados y revise la vista previa: es la página tal como se verá.'],
                ['Publicar', 'El sitio muestra el texto nuevo y el portal pide a cada familia aceptarlo. Los consentimientos anteriores se conservan con su versión.'],
              ].map(([title, text], i) => (
                <li key={title} className="rounded-xl bg-cream-2 p-3">
                  <span className="mb-1 flex items-center gap-2 font-semibold text-ink">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-green-strong text-xs font-bold text-white">{i + 1}</span>{title}
                  </span>
                  {text}
                </li>
              ))}
            </ol>
          </Card>

          <Card title={`Todas las versiones (${versions.length})`}>
            <ul className="divide-y divide-line" aria-label="Versiones del aviso de privacidad">
              {versions.map((v) => (
                <li key={v.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="font-head text-base font-bold text-ink tabular-nums">{v.version}</span>
                      <Badge variant={STATUS[v.status].variant}>{STATUS[v.status].label}</Badge>
                      <span className="truncate text-sm text-muted">{v.title}</span>
                    </p>
                    <p className="mt-0.5 text-xs text-subtle">
                      {v.status === 'borrador'
                        ? `Borrador creado el ${formatDateTime(v.created_at)}`
                        : `Vigente desde el ${longDate(v.effective_date)}${v.published_at ? ` · publicada el ${formatDateTime(v.published_at)}` : ''}`}
                      {v.status !== 'borrador' && ` · ${plural(v.consent_count, 'consentimiento', 'consentimientos')} · ${plural(v.registration_count, 'inscripción', 'inscripciones')}`}
                    </p>
                  </div>
                  <Link to={`${BASE}/${v.id}`} className="btn-outline btn-sm inline-flex min-h-[44px] items-center justify-center gap-1.5 self-start sm:self-auto" aria-label={`${v.status === 'borrador' ? 'Editar' : 'Ver'} la versión ${v.version}`}>
                    {v.status === 'borrador' ? <><PencilLine size={14} aria-hidden="true" /> Editar</> : <><Eye size={14} aria-hidden="true" /> Ver</>}
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}
    </>
  );
}

/* ── One version: read-only, or the draft editor ───────────────────────── */
function VersionView({ id }: { id: number }) {
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['legal-notice-version', id], queryFn: async () => (await legalNoticesApi.get(id)).data });
  const back = <Link to={BASE} className="mb-3 inline-flex min-h-[44px] items-center gap-1.5 text-sm font-semibold text-purple hover:underline"><ArrowLeft size={16} aria-hidden="true" /> Todas las versiones</Link>;
  if (isLoading) return <>{back}<Card><ListSkeleton /></Card></>;
  if (isError || !data) return <>{back}<Card><ErrorState title="No se pudo abrir esta versión" onRetry={() => refetch()} /></Card></>;
  return (
    <>
      {back}
      {data.status === 'borrador' ? <DraftEditor key={data.id} notice={data} /> : <PublishedView notice={data} />}
    </>
  );
}

function PublishedView({ notice }: { notice: NoticeVersion }) {
  return (
    <>
      <PageHeader title={`Aviso de privacidad ${notice.version}`} subtitle={notice.title} />
      <Card className="mb-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-cream-2 text-muted"><Lock size={18} aria-hidden="true" /></span>
            <div className="text-sm">
              <p className="flex flex-wrap items-center gap-2 font-semibold text-ink">Versión publicada <Badge variant={STATUS[notice.status].variant}>{STATUS[notice.status].label}</Badge></p>
              <p className="mt-1 text-muted">Su texto quedó fijo: es lo que aceptaron las familias. Para cambiarlo, cree una versión nueva desde la lista.</p>
              <p className="mt-2 text-xs text-subtle">
                Vigente desde el {longDate(notice.effective_date)}{notice.published_at && ` · publicada el ${formatDateTime(notice.published_at)}`} · {plural(notice.consent_count, 'consentimiento', 'consentimientos')} · {plural(notice.registration_count, 'inscripción', 'inscripciones')}
              </p>
            </div>
          </div>
        </div>
      </Card>
      <NoticePreview notice={notice} />
    </>
  );
}

/** The public page's two sections rendering this version, with the page's own copy around it. */
function NoticePreview({ notice }: { notice: Pick<NoticeVersion, 'version' | 'title' | 'body' | 'integral_notice_url' | 'effective_date'> }) {
  const { data: page } = usePublishedPage('aviso-de-privacidad');
  const props = (type: string): Record<string, any> => {
    const spec = aviso.sections.find((s) => s.type === type);
    const block = page?.blocks?.find((b) => b.type === type);
    return withDefaults(spec, block?.props ?? {});
  };
  const data: PrivacyNotice = {
    version: notice.version, title: notice.title, body: notice.body ?? '',
    integral_notice_url: notice.integral_notice_url, effective_date: notice.effective_date,
  };
  return (
    <section aria-label="Vista previa" className="overflow-hidden rounded-xl2 border border-line bg-white shadow-card">
      <p className="flex items-center gap-2 border-b border-line bg-cream-2 px-4 py-2.5 text-xs font-semibold text-muted">
        <Eye size={14} aria-hidden="true" /> Vista previa: así se verá en /aviso-de-privacidad
      </p>
      {/* The site's own components and copy: exactly what families will read. */}
      <div className="pointer-events-auto">
        <AvisoHero {...props('aviso.hero')} data={data} />
        <AvisoNoticeBody {...props('aviso.notice')} data={data} />
      </div>
    </section>
  );
}

/* ── Draft editor ──────────────────────────────────────────────────────── */
type Meta = Pick<NoticeVersion, 'version' | 'title' | 'effective_date' | 'integral_notice_url'>;

function DraftEditor({ notice }: { notice: NoticeVersion }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const initialText = useMemo(() => toEditable(notice.body ?? ''), [notice.body]);
  const initialMeta: Meta = { version: notice.version, title: notice.title, effective_date: notice.effective_date, integral_notice_url: notice.integral_notice_url };
  const [meta, setMeta] = useState<Meta>(initialMeta);
  const [text, setText] = useState<EditableNotice>(initialText);
  const [textDirty, setTextDirty] = useState(false);
  const [metaDirty, setMetaDirty] = useState(false);
  const [tab, setTab] = useState<'edit' | 'preview'>('edit');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [publishing, setPublishing] = useState(false);
  const [approved, setApproved] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const { data: list } = useVersions();
  const current = list?.results.find((v) => v.status === 'vigente');

  const problems = noticeProblems(text);
  const body = textDirty ? fromEditable(text) : (notice.body ?? '');
  const dirty = textDirty || metaDirty;

  const setM = (patch: Partial<Meta>) => { setMeta((m) => ({ ...m, ...patch })); setMetaDirty(true); setErrors((e) => ({ ...e, ...Object.fromEntries(Object.keys(patch).map((k) => [k, ''])) })); };
  const setT = (next: EditableNotice) => { setText(next); setTextDirty(true); setErrors((e) => ({ ...e, body: '' })); };
  const setPart = (i: number, patch: Partial<EditableNotice['sections'][number]>) => setT({ ...text, sections: text.sections.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const movePart = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= text.sections.length) return;
    const next = text.sections.slice();
    [next[i], next[j]] = [next[j], next[i]];
    setT({ ...text, sections: next });
  };

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: LIST_KEY });
    void qc.invalidateQueries({ queryKey: ['legal-notice-version', notice.id] });
  };
  const saveCall = async () => {
    const patch = { ...meta, ...(textDirty ? { body } : {}) };
    const res = await legalNoticesApi.update(notice.id, patch);
    setTextDirty(false); setMetaDirty(false);
    return res.data;
  };
  const onSaveError = (e: unknown) => {
    const f = apiFieldErrors(e);
    setErrors(f);
    toast.error(f.detail || 'Revise los campos marcados.');
  };
  const save = useMutation({ mutationFn: saveCall, onSuccess: () => { toast.success('Borrador guardado.'); refresh(); }, onError: onSaveError });
  const publish = useMutation({
    mutationFn: async () => { if (dirty) await saveCall(); return (await legalNoticesApi.publish(notice.id)).data; },
    onSuccess: (v) => {
      toast.success(`La versión ${v.version} ya es el aviso vigente.`);
      void qc.invalidateQueries({ queryKey: ['legal-notice'] });
      refresh();
      navigate(BASE);
    },
    onError: (e) => { setPublishing(false); onSaveError(e); },
  });
  const discard = useMutation({
    mutationFn: () => legalNoticesApi.discard(notice.id),
    onSuccess: () => { toast.success('Borrador descartado.'); void qc.invalidateQueries({ queryKey: LIST_KEY }); navigate(BASE); },
    onError: (e) => { setDiscarding(false); toast.error(apiFieldErrors(e).detail || 'No se pudo descartar el borrador.'); },
  });

  const submit = (e: FormEvent) => { e.preventDefault(); save.mutate(); };
  const consents = current?.consent_count ?? 0;

  return (
    <>
      <PageHeader title={`Borrador ${meta.version || notice.version}`} subtitle="Nada de esto se ve en el sitio hasta que publique la versión." />

      <div className="mb-4 inline-flex rounded-xl border border-line bg-white p-1" role="tablist" aria-label="Modo del borrador">
        {(['edit', 'preview'] as const).map((k) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-4 text-sm font-semibold transition-colors ${tab === k ? 'bg-purple text-white' : 'text-muted hover:text-ink'}`}>
            {k === 'edit' ? <><PencilLine size={15} aria-hidden="true" /> Editar</> : <><Eye size={15} aria-hidden="true" /> Vista previa</>}
          </button>
        ))}
      </div>

      {tab === 'preview' ? (
        <NoticePreview notice={{ ...meta, body }} />
      ) : (
        <form onSubmit={submit} noValidate className="space-y-6">
          <Card title="Datos de la versión">
            <div className="grid gap-4 sm:grid-cols-2">
              <Input id="nv-version" label="Número de versión" value={meta.version} maxLength={30} onChange={(e) => setM({ version: e.target.value })} error={errors.version} hint="Por ejemplo 2026.4. Se muestra junto a la fecha." />
              <Input id="nv-date" label="Vigente desde" type="date" value={meta.effective_date} onChange={(e) => setM({ effective_date: e.target.value })} error={errors.effective_date} hint="La fecha que muestra la página." />
              <Input id="nv-title" label="Título" value={meta.title} maxLength={200} onChange={(e) => setM({ title: e.target.value })} error={errors.title} />
              <Input id="nv-url" label="Enlace al aviso integral (opcional)" type="url" placeholder="https://…" value={meta.integral_notice_url} onChange={(e) => setM({ integral_notice_url: e.target.value })} error={errors.integral_notice_url} hint="Si lo llena, la página muestra un botón hacia él." />
            </div>
          </Card>

          <Card title="Texto del aviso" subtitle="Escriba como en un documento: una línea en blanco separa los párrafos. Cada apartado se muestra en la página como una sección que se abre y se cierra.">
            <div className="space-y-5">
              {(problems.structure || errors.body) && (
                <p className="rounded-lg bg-amber/10 px-3 py-2 text-sm text-ink" role="status">{errors.body || problems.structure}</p>
              )}
              <div>
                <label className="label" htmlFor="nv-intro">Texto antes del primer apartado</label>
                <textarea id="nv-intro" className={`input-field min-h-[140px] text-sm ${problems.intro ? 'border-coral-400' : ''}`} value={text.intro}
                  aria-invalid={problems.intro ? true : undefined} aria-describedby={problems.intro ? 'nv-intro-error' : undefined}
                  onChange={(e) => setT({ ...text, intro: e.target.value })} />
                {problems.intro && <p id="nv-intro-error" className="mt-1.5 text-xs text-coral-600">{problems.intro}</p>}
              </div>

              <ol className="space-y-4" aria-label="Apartados del aviso">
                {text.sections.map((s, i) => {
                  const Icon = sectionIcon(s.title.toLocaleUpperCase('es-MX'));
                  const p = problems.sections[i] ?? {};
                  return (
                    <li key={i} className="rounded-xl border border-line bg-cream-2/60 p-3 sm:p-4">
                      <div className="mb-3 flex items-center justify-between gap-2">
                        <span className="flex items-center gap-2 text-sm font-semibold text-ink">
                          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-green/10 text-green-dark"><Icon size={16} aria-hidden="true" /></span>
                          Apartado {i + 1}
                        </span>
                        <span className="flex gap-1">
                          <Button type="button" size="sm" variant="ghost" className="min-h-[44px] min-w-[44px]" aria-label={`Subir el apartado ${i + 1}`} disabled={i === 0} onClick={() => movePart(i, -1)}><ArrowUp size={16} aria-hidden="true" /></Button>
                          <Button type="button" size="sm" variant="ghost" className="min-h-[44px] min-w-[44px]" aria-label={`Bajar el apartado ${i + 1}`} disabled={i === text.sections.length - 1} onClick={() => movePart(i, 1)}><ArrowDown size={16} aria-hidden="true" /></Button>
                          <Button type="button" size="sm" variant="ghost" className="min-h-[44px] min-w-[44px]" aria-label={`Quitar el apartado ${i + 1}`} onClick={() => setT({ ...text, sections: text.sections.filter((_, j) => j !== i) })}><Trash2 size={16} aria-hidden="true" /></Button>
                        </span>
                      </div>
                      <div className="space-y-3">
                        <Input id={`nv-part-${i}-title`} label="Título del apartado" value={s.title} error={p.title} hint="Se guarda en mayúsculas, como el texto oficial; la página lo muestra así." onChange={(e) => setPart(i, { title: e.target.value })} />
                        <div>
                          <label className="label" htmlFor={`nv-part-${i}-text`}>Texto del apartado</label>
                          <textarea id={`nv-part-${i}-text`} className={`input-field min-h-[160px] text-sm ${p.text ? 'border-coral-400' : ''}`} value={s.text}
                            aria-invalid={p.text ? true : undefined} aria-describedby={p.text ? `nv-part-${i}-text-error` : undefined}
                            onChange={(e) => setPart(i, { text: e.target.value })} />
                          {p.text && <p id={`nv-part-${i}-text-error`} className="mt-1.5 text-xs text-coral-600">{p.text}</p>}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ol>
              <Button type="button" variant="secondary" className="min-h-[44px]" onClick={() => setT({ ...text, sections: [...text.sections, { title: '', text: '' }] })}>
                <Plus size={16} aria-hidden="true" /> Agregar apartado
              </Button>
              {text.sections.length < MIN_PARTS && text.sections.length > 0 && <p className="text-xs text-subtle">Faltan {MIN_PARTS - text.sections.length} apartado(s) para que la página muestre el aviso por secciones.</p>}
            </div>
          </Card>

          <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-white/95 p-3 shadow-card backdrop-blur">
            <Button type="button" variant="ghost" className="min-h-[44px] text-coral-600" onClick={() => setDiscarding(true)}><Trash2 size={16} aria-hidden="true" /> Descartar borrador</Button>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" variant="secondary" className="min-h-[44px]" loading={save.isPending} disabled={!dirty}>Guardar borrador</Button>
              <Button type="button" className="min-h-[44px]" disabled={problems.blocking} onClick={() => { setApproved(false); setPublishing(true); }}>
                <Send size={16} aria-hidden="true" /> Publicar…
              </Button>
            </div>
            {problems.blocking && <p className="w-full text-right text-xs text-coral-600">Corrija los avisos marcados para poder publicar.</p>}
          </div>
        </form>
      )}

      <Modal open={publishing} onClose={() => setPublishing(false)} title={`¿Publicar la versión ${meta.version}?`} maxWidth={560}>
        <div className="space-y-4 text-sm text-ink">
          <ul className="list-disc space-y-2 pl-5 text-muted">
            <li><strong className="text-ink">El sitio mostrará este texto</strong> como el Aviso de Privacidad vigente desde el {longDate(meta.effective_date)}.</li>
            <li><strong className="text-ink">Las familias tendrán que aceptarlo:</strong> al entrar al portal, cada familia verá un aviso para aceptar la versión nueva.</li>
            <li><strong className="text-ink">Los consentimientos que ya existen no cambian.</strong> {current ? `Los ${plural(consents, 'consentimiento', 'consentimientos')} de la versión ${current.version} siguen ligados a esa versión, que se conserva como «Anterior».` : 'Siguen ligados a la versión que cada familia aceptó.'}</li>
            <li><strong className="text-ink">Después de publicar, este texto ya no se puede editar.</strong> Para corregirlo habrá que publicar otra versión.</li>
          </ul>
          <label className="flex min-h-[44px] cursor-pointer items-start gap-3 rounded-xl border border-line p-3">
            <input type="checkbox" className="mt-0.5 h-5 w-5" checked={approved} onChange={(e) => setApproved(e.target.checked)} />
            <span>Revisé la vista previa y Dirección aprobó este texto.</span>
          </label>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" className="min-h-[44px]" onClick={() => setPublishing(false)}>Cancelar</Button>
            <Button type="button" variant="green" className="min-h-[44px]" disabled={!approved} loading={publish.isPending} onClick={() => publish.mutate()}>
              <Send size={16} aria-hidden="true" /> Publicar versión {meta.version}
            </Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={discarding}
        onClose={() => setDiscarding(false)}
        onConfirm={() => discard.mutate()}
        title="¿Descartar el borrador?"
        message={`Se borra el borrador ${notice.version}. El aviso vigente no cambia.`}
        confirmLabel="Descartar borrador"
        loading={discard.isPending}
      />
    </>
  );
}
