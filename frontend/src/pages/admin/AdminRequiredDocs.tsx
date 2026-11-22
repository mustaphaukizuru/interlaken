import { useId, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, ExternalLink, Eye, EyeOff, FileStack, FolderCheck, Package, Pencil, Plus, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { clsx } from 'clsx';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { ListSkeleton } from '@/components/ui/ListSkeleton';
import { apiErrorMessage, apiFieldErrors, type FieldErrorMap } from '@/lib/apiErrors';
import { adminKeys } from '@/hooks/queries/keys';
import {
  REQUIRED_DOCS_ENTITY, requiredDocsApi, useAdminRequiredDocs, useRequiredDocsInvalidate,
  type LevelCode, type RequiredDoc, type RequiredDocWrite,
} from '@/hooks/queries/requiredDocs';
import { LEVELS, levelLabel } from '@/lib/requiredDocs';

type LevelTab = LevelCode | 'todos';

const EMPTY: RequiredDocWrite = {
  name: '', description: '', physical_note: '', levels: ['preescolar', 'primaria', 'secundaria'],
  multiple_files: false, link_url: '', link_label: '', active: true,
};

/** 44 px touch targets for the iPad (Button size="sm" drops to 36 px from 640 px). */
const ICON_BTN = 'inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-1.5 rounded-sm px-2.5 text-sm font-semibold text-muted transition hover:bg-cream hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-purple/40 disabled:cursor-not-allowed disabled:opacity-40';

/**
 * /admin/admisiones/documentos — the documents each level asks for (Fase 4).
 * The same list feeds the public «Documentación» page, the family's upload
 * page and every staff checklist. Order with ↑/↓ (in any level view: a move
 * swaps with the neighbour shown), hide instead of delete once families
 * uploaded files.
 */
export default function AdminRequiredDocs() {
  const qc = useQueryClient();
  const { data, isLoading, isError, refetch } = useAdminRequiredDocs();
  const invalidate = useRequiredDocsInvalidate();
  const [tab, setTab] = useState<LevelTab>('todos');
  const [editing, setEditing] = useState<RequiredDoc | 'new' | null>(null);
  const [toDelete, setToDelete] = useState<RequiredDoc | null>(null);
  const [announce, setAnnounce] = useState('');

  const docs = useMemo(() => data ?? [], [data]);
  const visible = tab === 'todos' ? docs : docs.filter((d) => d.levels.includes(tab));
  const counts = useMemo(() => Object.fromEntries(LEVELS.map((l) => [
    l.value, docs.filter((d) => d.active && d.levels.includes(l.value)).length,
  ])) as Record<LevelCode, number>, [docs]);

  const listKey = adminKeys.list(REQUIRED_DOCS_ENTITY, null);
  const reorder = useMutation({
    mutationFn: (ids: number[]) => requiredDocsApi.reorder(ids),
    onMutate: async (ids) => {
      await qc.cancelQueries({ queryKey: listKey });
      const before = qc.getQueryData<RequiredDoc[]>(listKey);
      if (before) {
        const byId = new Map(before.map((d) => [d.id, d]));
        qc.setQueryData(listKey, ids.map((id, i) => ({ ...byId.get(id)!, order: i + 1 })));
      }
      return { before };
    },
    onError: (e, _ids, ctx) => {
      if (ctx?.before) qc.setQueryData(listKey, ctx.before);
      toast.error(apiErrorMessage(e, 'No se pudo cambiar el orden.'));
    },
    onSettled: () => { void invalidate(); },
  });
  const toggle = useMutation({
    mutationFn: (d: RequiredDoc) => requiredDocsApi.update(d.id, { active: !d.active }),
    onSuccess: ({ data: d }) => { toast.success(d.active ? `«${d.name}» se muestra a las familias.` : `«${d.name}» quedó oculto.`); void invalidate(); },
    onError: (e) => toast.error(apiErrorMessage(e, 'No se pudo guardar.')),
  });
  const remove = useMutation({
    mutationFn: (d: RequiredDoc) => requiredDocsApi.remove(d.id),
    onSuccess: () => { toast.success('Documento eliminado.'); setToDelete(null); void invalidate(); },
    onError: (e) => { toast.error(apiErrorMessage(e, 'No se pudo eliminar.')); setToDelete(null); },
  });

  /** Swap `doc` with its neighbour in the current view, in the full order. */
  const move = (doc: RequiredDoc, dir: -1 | 1) => {
    const i = visible.findIndex((d) => d.id === doc.id);
    const other = visible[i + dir];
    if (!other) return;
    const ids = docs.map((d) => d.id);
    const a = ids.indexOf(doc.id);
    const b = ids.indexOf(other.id);
    [ids[a], ids[b]] = [ids[b], ids[a]];
    reorder.mutate(ids);
    setAnnounce(`«${doc.name}» ${dir < 0 ? 'subió' : 'bajó'} al lugar ${i + dir + 1} de ${visible.length}.`);
  };

  return (
    <>
      <PageHeader
        title="Documentos requeridos"
        subtitle="La lista que ven las familias en «Documentación» y al subir sus documentos, y la que revisa Admisiones en cada inscripción."
        actions={<Button onClick={() => setEditing('new')}><Plus size={16} aria-hidden="true" /> Agregar documento</Button>}
      />
      <p className="sr-only" aria-live="polite">{announce}</p>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_17rem]">
        <section aria-labelledby="docs-list-title" className="min-w-0">
          <h2 id="docs-list-title" className="sr-only">Lista de documentos</h2>
          <div role="group" aria-label="Filtrar por nivel" className="mb-4 flex flex-wrap gap-2">
            {([{ value: 'todos', label: 'Todos' }, ...LEVELS] as { value: LevelTab; label: string }[]).map((t) => {
              const n = t.value === 'todos' ? docs.length : counts[t.value as LevelCode];
              const on = tab === t.value;
              return (
                <button
                  key={t.value}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setTab(t.value)}
                  className={clsx(
                    'inline-flex min-h-[44px] items-center gap-2 rounded-sm border px-4 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-purple/40',
                    on ? 'border-purple bg-purple text-white' : 'border-line bg-white text-muted hover:border-purple/40 hover:text-ink',
                  )}
                >
                  {t.label}
                  {data && <span className={clsx('rounded-full px-2 text-xs tabular-nums', on ? 'bg-white/20' : 'bg-cream')}>{n}</span>}
                </button>
              );
            })}
          </div>

          {isError ? (
            <div className="card"><ErrorState onRetry={() => refetch()} /></div>
          ) : isLoading ? (
            <div className="card"><ListSkeleton rows={6} /></div>
          ) : docs.length === 0 ? (
            <div className="card">
              <EmptyState icon={FolderCheck} title="Sin documentos" description="Agregue el primer documento que pide la escuela."
                action={<Button onClick={() => setEditing('new')}><Plus size={16} aria-hidden="true" /> Agregar documento</Button>} />
            </div>
          ) : visible.length === 0 ? (
            <div className="card">
              <EmptyState icon={FolderCheck} title={`Ningún documento para ${levelLabel(tab)}`} description="Marque este nivel en un documento para que aparezca aquí." />
            </div>
          ) : (
            <ol className="space-y-3" aria-label={tab === 'todos' ? 'Documentos en orden' : `Documentos de ${levelLabel(tab)} en orden`}>
              {visible.map((d, i) => (
                <DocRow
                  key={d.id}
                  doc={d}
                  position={i}
                  total={visible.length}
                  busy={reorder.isPending}
                  onMove={(dir) => move(d, dir)}
                  onEdit={() => setEditing(d)}
                  onToggle={() => toggle.mutate(d)}
                  onDelete={() => setToDelete(d)}
                />
              ))}
            </ol>
          )}
        </section>

        <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start" aria-label="Resumen por nivel">
          <div className="card !p-5">
            <h2 className="font-semibold text-ink">Por nivel</h2>
            <dl className="mt-3 space-y-2 text-sm">
              {LEVELS.map((l) => (
                <div key={l.value} className="flex items-center justify-between gap-3">
                  <dt className="text-muted">{l.label}</dt>
                  <dd className="font-semibold tabular-nums text-ink">{data ? `${counts[l.value]} documentos` : '…'}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-xs text-subtle">Cuentan solo los visibles. La ficha de inscripción se marca sola cuando la familia la envía.</p>
          </div>
          <div className="card !p-5 text-sm text-muted">
            <p>Las familias ven esta lista en la página pública y al subir sus documentos.</p>
            <Link to="/admisiones/documentacion" target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex min-h-[44px] items-center gap-1.5 font-semibold text-purple hover:underline">
              Ver la página Documentación <ExternalLink size={14} aria-hidden="true" />
            </Link>
          </div>
        </aside>
      </div>

      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === 'new' ? 'Agregar documento' : 'Editar documento'} maxWidth={560}>
        {editing !== null && (
          <DocForm key={editing === 'new' ? 'new' : editing.id} doc={editing === 'new' ? null : editing}
            onClose={() => setEditing(null)} onSaved={() => { void invalidate(); }} />
        )}
      </Modal>
      <ConfirmDialog
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        onConfirm={() => toDelete && remove.mutate(toDelete)}
        title="Eliminar documento"
        message={<>Se quitará «{toDelete?.name}» de la lista de todos los niveles. Esta acción no se puede deshacer.</>}
        confirmLabel="Eliminar documento"
        loading={remove.isPending}
      />
    </>
  );
}

function DocRow({ doc, position, total, busy, onMove, onEdit, onToggle, onDelete }: {
  doc: RequiredDoc; position: number; total: number; busy: boolean;
  onMove: (dir: -1 | 1) => void; onEdit: () => void; onToggle: () => void; onDelete: () => void;
}) {
  const ficha = doc.kind === 'ficha';
  const deletable = !ficha && doc.upload_count === 0;
  return (
    <li className={clsx('card flex gap-3 !p-4 sm:gap-4', !doc.active && 'bg-cream-2')}>
      <div className="flex shrink-0 flex-col items-center" role="group" aria-label={`Orden de ${doc.name}`}>
        <button type="button" className={ICON_BTN} disabled={busy || position === 0} onClick={() => onMove(-1)} aria-label={`Subir ${doc.name}`}>
          <ArrowUp size={18} aria-hidden="true" />
        </button>
        <span className="text-xs tabular-nums text-subtle" aria-hidden="true">{position + 1}</span>
        <button type="button" className={ICON_BTN} disabled={busy || position === total - 1} onClick={() => onMove(1)} aria-label={`Bajar ${doc.name}`}>
          <ArrowDown size={18} aria-hidden="true" />
        </button>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className={clsx('font-semibold', doc.active ? 'text-ink' : 'text-muted')}>{doc.name}</h3>
          {!doc.active && <Badge variant="neutral"><EyeOff size={12} className="mr-1" aria-hidden="true" />Oculto</Badge>}
          {ficha && <Badge variant="info">Se llena en línea</Badge>}
        </div>
        {doc.description && <p className="mt-0.5 text-sm text-muted">{doc.description}</p>}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {LEVELS.map((l) => doc.levels.includes(l.value) && (
            <span key={l.value} className="rounded-full bg-green-50 px-2.5 py-0.5 text-xs font-medium text-green-700 ring-1 ring-inset ring-green-600/20">{l.label}</span>
          ))}
        </div>
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-subtle">
          {doc.physical_note && <li className="inline-flex items-center gap-1"><Package size={13} aria-hidden="true" /> En físico: <span className="text-ink">{doc.physical_note}</span></li>}
          {doc.multiple_files && <li className="inline-flex items-center gap-1"><FileStack size={13} aria-hidden="true" /> Varios archivos</li>}
          {doc.link_url && <li className="inline-flex items-center gap-1"><ExternalLink size={13} aria-hidden="true" /> {doc.link_label || 'Trámite en línea'}</li>}
          {doc.upload_count > 0 && <li>{doc.upload_count === 1 ? '1 archivo de familias' : `${doc.upload_count} archivos de familias`}</li>}
        </ul>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1 sm:flex-row sm:items-start">
        <button type="button" className={ICON_BTN} onClick={onEdit} aria-label={`Editar ${doc.name}`}>
          <Pencil size={17} aria-hidden="true" /><span className="hidden md:inline">Editar</span>
        </button>
        <button type="button" className={ICON_BTN} onClick={onToggle} aria-label={doc.active ? `Ocultar ${doc.name}` : `Mostrar ${doc.name}`}>
          {doc.active ? <EyeOff size={17} aria-hidden="true" /> : <Eye size={17} aria-hidden="true" />}
          <span className="hidden md:inline">{doc.active ? 'Ocultar' : 'Mostrar'}</span>
        </button>
        {deletable && (
          <button type="button" className={clsx(ICON_BTN, 'hover:!bg-coral-50 hover:!text-coral-700')} onClick={onDelete} aria-label={`Eliminar ${doc.name}`}>
            <Trash2 size={17} aria-hidden="true" />
          </button>
        )}
      </div>
    </li>
  );
}

function DocForm({ doc, onClose, onSaved }: { doc: RequiredDoc | null; onClose: () => void; onSaved: () => void }) {
  const id = useId();
  const [form, setForm] = useState<RequiredDocWrite>(doc ? {
    name: doc.name, description: doc.description, physical_note: doc.physical_note, levels: doc.levels,
    multiple_files: doc.multiple_files, link_url: doc.link_url, link_label: doc.link_label, active: doc.active,
  } : EMPTY);
  const [errors, setErrors] = useState<FieldErrorMap>({});
  const ficha = doc?.kind === 'ficha';
  const set = <K extends keyof RequiredDocWrite>(k: K, v: RequiredDocWrite[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((e) => ({ ...e, [k]: '' }));
  };
  const save = useMutation({
    mutationFn: () => (doc ? requiredDocsApi.update(doc.id, form) : requiredDocsApi.create(form)),
    onSuccess: () => { toast.success(doc ? 'Documento guardado.' : 'Documento agregado.'); onSaved(); onClose(); },
    onError: (e) => { setErrors(apiFieldErrors(e)); toast.error(apiErrorMessage(e, 'No se pudo guardar.')); },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const next: FieldErrorMap = {};
    if (!form.name.trim()) next.name = 'Escriba el nombre del documento.';
    if (form.levels.length === 0) next.levels = 'Elija al menos un nivel.';
    if (Object.keys(next).length) { setErrors(next); return; }
    save.mutate();
  };
  const toggleLevel = (lvl: LevelCode, on: boolean) =>
    set('levels', LEVELS.map((l) => l.value).filter((v) => (v === lvl ? on : form.levels.includes(v))));

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <Input label="Nombre" value={form.name} maxLength={200} onChange={(e) => set('name', e.target.value)} error={errors.name} required />
      <div>
        <label className="label" htmlFor={`${id}-desc`}>Descripción (opcional)</label>
        <textarea id={`${id}-desc`} className="input-field min-h-[72px]" maxLength={500} value={form.description}
          onChange={(e) => set('description', e.target.value)} placeholder="No mayor a 3 meses." />
      </div>
      <Input label="En físico (opcional)" value={form.physical_note} maxLength={200} onChange={(e) => set('physical_note', e.target.value)}
        hint="Lo que la familia entrega en papel, por ejemplo «Original y 2 copias»." error={errors.physical_note} />
      <fieldset aria-describedby={errors.levels ? `${id}-levels-error` : undefined}>
        <legend className="label">Niveles que lo piden</legend>
        <div className="flex flex-wrap gap-2">
          {LEVELS.map((l) => (
            <label key={l.value} className="inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-md border border-line px-3.5 text-sm text-ink has-[:checked]:border-purple has-[:checked]:bg-brand-50">
              <input type="checkbox" className="h-5 w-5 rounded-sm border-line text-purple focus:ring-purple/40"
                checked={form.levels.includes(l.value)} onChange={(e) => toggleLevel(l.value, e.target.checked)} />
              {l.label}
            </label>
          ))}
        </div>
        <p className="mt-1.5 text-xs text-muted">Preescolar incluye Maternal.</p>
        {errors.levels && <p id={`${id}-levels-error`} className="mt-1 text-xs text-coral-600">{errors.levels}</p>}
      </fieldset>
      {ficha ? (
        <p className="rounded-md bg-cream px-3.5 py-2.5 text-sm text-muted">La ficha se llena en línea: queda lista en cuanto la familia la envía. No se sube como archivo.</p>
      ) : (
        <label className="flex min-h-[44px] cursor-pointer items-start gap-2.5 text-sm text-ink">
          <input type="checkbox" className="mt-0.5 h-5 w-5 rounded-sm border-line text-purple focus:ring-purple/40"
            checked={form.multiple_files} onChange={(e) => set('multiple_files', e.target.checked)} />
          <span>Permite varios archivos<span className="block text-xs text-muted">Por ejemplo, la INE de papá y la de mamá, o frente y reverso.</span></span>
        </label>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="Enlace al trámite oficial (opcional)" type="url" inputMode="url" value={form.link_url} maxLength={300}
          onChange={(e) => set('link_url', e.target.value)} placeholder="https://www.gob.mx/curp/" error={errors.link_url} />
        <Input label="Texto del enlace" value={form.link_label} maxLength={80} onChange={(e) => set('link_label', e.target.value)}
          placeholder="Consultar CURP" error={errors.link_label} />
      </div>
      <label className="flex min-h-[44px] cursor-pointer items-start gap-2.5 text-sm text-ink">
        <input type="checkbox" className="mt-0.5 h-5 w-5 rounded-sm border-line text-purple focus:ring-purple/40"
          checked={form.active} onChange={(e) => set('active', e.target.checked)} />
        <span>Visible para las familias<span className="block text-xs text-muted">Oculto, no se pide en ninguna inscripción ni aparece en el sitio.</span></span>
      </label>
      {errors.detail && <p className="text-sm text-coral-600" role="alert">{errors.detail}</p>}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button type="submit" loading={save.isPending}>{doc ? 'Guardar cambios' : 'Agregar documento'}</Button>
      </div>
    </form>
  );
}
