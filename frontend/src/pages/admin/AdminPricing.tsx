/**
 * /admin/costos: «Costos y precios» (docs/cms/price-tables.md). The figures
 * of /admisiones/costos and the Admisiones estimator, edited like a
 * spreadsheet: one tab per price card, as the public page groups them. Changes
 * stay in the editor (each tab marks its own) until «Guardar cambios», which
 * lists every change old → new and saves them all at once; the preview shows
 * the real public tables with the figures being edited. Excel export, and an
 * import that is checked and shown before it reaches the editor.
 */
import { lazy, Suspense, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ExternalLink, FileDown, FileUp, Info, RotateCcw, Save } from 'lucide-react';
import toast from 'react-hot-toast';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { ErrorState } from '@/components/ui/ErrorState';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { apiErrorMessage } from '@/lib/apiErrors';
import { CURRENT_CYCLE } from '@/lib/siteMeta';
import { downloadBlob } from '@/services/api';
import { pricingAdminApi, type PricingRowError, type PricingTableKey, type PricingTablePayload } from '@/services/pricingAdminApi';
import { usePublishedPage } from '@/cms/published';
import { policyMatcher, PRICING_COPY, type PricingCopy } from '@/components/public/PricingSections';
import type { EstimatorCopy } from '@/components/admissions/estimatorCopy';
import { ChangeList, changesLabel } from '@/components/admin/pricing/ChangeList';
import { PriceGrid } from '@/components/admin/pricing/PriceGrid';
import { PricingImportDialog } from '@/components/admin/pricing/PricingImportDialog';
import { useLeaveGuard } from '@/components/admin/pricing/useLeaveGuard';
import {
  countErrors, diffRows, fromServer, ordered, parseMoney, rowTitle, TABLES, toPayload, validateRows,
  type EditRow, type RowChange, type RowErrors, type TableDef,
} from '@/components/admin/pricing/model';

const PricingPreview = lazy(() => import('@/components/admin/pricing/PricingPreview'));

type Key = PricingTableKey;
interface TableState { base: EditRow[]; rows: EditRow[]; version: string }
type State = Record<Key, TableState>;

const fromPayload = (t: PricingTablePayload): TableState => {
  const rows = fromServer(TABLES.find((d) => d.key === t.key)!, t.rows);
  return { base: rows, rows: rows.map((r) => ({ ...r, values: { ...r.values } })), version: t.version };
};

const money = (v: string | undefined) => parseMoney(v ?? '').value;

/** The editor's figures in the public /content/pricing/ shape (visible rows only), for the preview. */
function toBundle(state: State) {
  const visible = (k: Key) => ordered(TABLES.find((d) => d.key === k)!, state[k].rows).filter((r) => r.is_active).map((r, i) => ({ v: r.values, order: i + 1 }));
  return {
    enrollment_fees: visible('inscripcion').map(({ v, order }) => ({ section: v.section, modality: v.modality, gastos_administrativos: money(v.gastos_administrativos) ?? '0.00', cuota: money(v.cuota) ?? '0.00', order })),
    tuition: visible('colegiaturas').map(({ v, order }) => ({ section: v.section, colegiatura: money(v.colegiatura) ?? '0.00', order })),
    fixed_concepts: visible('seguros').map(({ v, order }) => ({ name: v.name, cost: money(v.cost) ?? '0.00', mandatory: true, order })),
    extracurriculars: visible('extraescolares').map(({ v, order }) => ({ name: v.name, levels: v.levels, annual_cost: money(v.annual_cost) ?? '0.00', order })),
    daycare: visible('estancia').map(({ v, order }) => ({ schedule: v.schedule, service: v.service, daily_cost: money(v.daily_cost) ?? '0.00', monthly_cost: money(v.monthly_cost), monthly_note: v.monthly_note ?? '', order })),
    policies: visible('politicas').map(({ v, order }) => ({ text: v.text, order })),
  };
}

/** The copy the site publishes for a section (or its defaults), so the preview reads like the site. */
function usePublishedProps<T>(slug: string, type: string): Partial<T> | undefined {
  const { data } = usePublishedPage(slug);
  return data?.blocks?.find((b) => b.type === type && !b.hidden)?.props as Partial<T> | undefined;
}

export default function AdminPricing() {
  const wide = useMediaQuery('(min-width: 768px)');
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const query = useQuery({
    queryKey: ['admin-pricing'],
    queryFn: async () => (await pricingAdminApi.list()).data,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  const [state, setState] = useState<State | null>(null);
  const [serverErrors, setServerErrors] = useState<Partial<Record<Key, RowErrors>>>({});
  const [source, setSource] = useState<'editor' | 'import'>('editor');
  const [reviewing, setReviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState<Key[] | null>(null);
  const [discarding, setDiscarding] = useState(false);
  const [deleting, setDeleting] = useState<{ table: Key; row: EditRow } | null>(null);
  const [importing, setImporting] = useState(false);
  const [previewOpen, setPreviewOpen] = useState<boolean | null>(null);
  const [previewView, setPreviewView] = useState<'tables' | 'estimator'>('tables');
  const panelRef = useRef<HTMLDivElement>(null);

  // First load (and «Recargar»): the saved tables become the editor's starting point.
  if (query.data && !state) {
    setState(Object.fromEntries(TABLES.map((t) => [t.key, fromPayload(query.data.tables[t.key])])) as State);
  }

  const tab = (TABLES.find((t) => t.key === params.get('tabla'))?.key ?? 'inscripcion') as Key;
  const setTab = (k: Key) => setParams((p) => { const n = new URLSearchParams(p); if (k === 'inscripcion') n.delete('tabla'); else n.set('tabla', k); return n; }, { replace: true });

  const changes = useMemo(() => (state ? Object.fromEntries(TABLES.map((t) => [t.key, diffRows(t, state[t.key].base, state[t.key].rows)])) as Record<Key, RowChange[]> : null), [state]);
  const clientErrors = useMemo(() => (state ? Object.fromEntries(TABLES.map((t) => [t.key, validateRows(t, state[t.key].rows)])) as Record<Key, RowErrors> : null), [state]);
  const errorsOf = (k: Key): RowErrors => {
    const merged: RowErrors = {};
    for (const src of [serverErrors[k] ?? {}, clientErrors?.[k] ?? {}]) for (const [row, e] of Object.entries(src)) merged[row] = { ...(merged[row] ?? {}), ...e };
    return merged;
  };
  const dirty = TABLES.filter((t) => (changes?.[t.key].length ?? 0) > 0).map((t) => t.key);
  const totalChanges = dirty.reduce((n, k) => n + changes![k].length, 0);
  const guard = useLeaveGuard(dirty.length > 0);

  const pricingCopy = usePublishedProps<PricingCopy>('costos', 'costos.prices');
  const estimatorCopy = usePublishedProps<EstimatorCopy>('admisiones', 'admisiones.estimator');
  const highlighted = useMemo(() => policyMatcher(pricingCopy?.policyHighlight ?? PRICING_COPY.policyHighlight), [pricingCopy]);
  const bundle = useMemo(() => (state ? toBundle(state) : null), [state]);
  const showPreview = previewOpen ?? wide;

  const setRows = (k: Key, rows: EditRow[]) => {
    setState((s) => (s ? { ...s, [k]: { ...s[k], rows } } : s));
    if (serverErrors[k]) setServerErrors((e) => ({ ...e, [k]: undefined }));
  };

  const focusFirstError = () => requestAnimationFrame(() => panelRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());

  const askToSave = () => {
    const bad = dirty.find((k) => countErrors(errorsOf(k)) > 0);
    if (bad) {
      setTab(bad);
      toast.error('Corrija los datos marcados antes de guardar.');
      focusFirstError();
      return;
    }
    setReviewing(true);
  };

  const save = async () => {
    if (!state) return;
    setSaving(true);
    const keysOf: Partial<Record<Key, string[]>> = {};
    const tables = Object.fromEntries(dirty.map((k) => {
      const p = toPayload(TABLES.find((t) => t.key === k)!, state[k].rows);
      keysOf[k] = p.keys;
      return [k, { rows: p.rows, version: state[k].version }];
    }));
    try {
      const { data } = await pricingAdminApi.save(tables, source);
      setState((s) => {
        if (!s) return s;
        const next = { ...s };
        for (const [k, t] of Object.entries(data.tables)) if (t) next[k as Key] = fromPayload(t);
        return next;
      });
      qc.setQueryData(['admin-pricing'], (old: { tables: Record<Key, PricingTablePayload> } | undefined) => (old ? { tables: { ...old.tables, ...data.tables } } : old));
      void qc.invalidateQueries({ queryKey: ['pricing-bundle'] });
      setServerErrors({});
      setSource('editor');
      setReviewing(false);
      toast.success('Precios guardados. El sitio ya muestra los cambios.');
    } catch (e) {
      const body = (e as { response?: { status?: number; data?: { code?: string; errors?: Record<Key, PricingRowError[]>; tables?: Key[] } } }).response;
      setReviewing(false);
      if (body?.status === 409 && body.data?.code === 'version_conflict') {
        setConflict(body.data.tables ?? dirty);
      } else if (body?.status === 400 && body.data?.code === 'invalid_rows' && body.data.errors) {
        const mapped: Partial<Record<Key, RowErrors>> = {};
        for (const [k, list] of Object.entries(body.data.errors) as [Key, PricingRowError[]][]) {
          const m: RowErrors = {};
          for (const err of list) { const rowKey = keysOf[k]?.[err.row]; if (rowKey) (m[rowKey] ??= {})[err.field] = err.message; }
          mapped[k] = m;
        }
        setServerErrors(mapped);
        const first = Object.keys(mapped)[0] as Key | undefined;
        if (first) { setTab(first); focusFirstError(); }
        toast.error(apiErrorMessage(e, 'Revise los datos marcados: no se guardó nada.'));
      } else {
        toast.error(apiErrorMessage(e, 'No se pudo guardar. No se guardó nada; intente de nuevo.'));
      }
    } finally {
      setSaving(false);
    }
  };

  const reload = async (keys: Key[]) => {
    const { data } = await query.refetch();
    if (!data) return;
    setState((s) => {
      if (!s) return s;
      const next = { ...s };
      for (const k of keys) next[k] = fromPayload(data.tables[k]);
      return next;
    });
    setServerErrors({});
    setConflict(null);
  };

  const exportXlsx = async () => {
    const id = toast.loading('Preparando el Excel…');
    try {
      const { data } = await pricingAdminApi.exportXlsx();
      const d = new Date();
      downloadBlob(data, `precios_${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.xlsx`);
      toast.success(dirty.length ? 'Excel listo, con los precios guardados (sin los cambios pendientes).' : 'Excel listo.', { id });
    } catch (e) {
      toast.error(apiErrorMessage(e, 'No se pudo preparar el Excel.'), { id });
    }
  };

  if (query.isError) {
    return (
      <>
        <PageHeader title="Costos y precios" />
        <ErrorState title="No fue posible cargar los precios" description="Revise su conexión e intente de nuevo." onRetry={() => query.refetch()} />
      </>
    );
  }
  if (!state || !changes) return <div className="flex min-h-[40vh] items-center justify-center"><LoadingSpinner /></div>;

  const def = TABLES.find((t) => t.key === tab)!;
  /** Arrow keys move between tabs (roving focus, WAI tabs pattern, like StatusTabs). */
  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const i = TABLES.findIndex((t) => t.key === tab);
    const n = e.key === 'Home' ? 0 : e.key === 'End' ? TABLES.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : TABLES.length - 1)) % TABLES.length;
    setTab(TABLES[n].key);
    requestAnimationFrame(() => document.getElementById(`tab-${TABLES[n].key}`)?.focus());
  };
  const tabErrors = (k: Key) => countErrors(errorsOf(k));

  return (
    <div className="pb-24">
      <PageHeader
        title="Costos y precios"
        subtitle="Las cifras de Admisiones › Costos y del estimador de Admisiones. Edite como en una hoja de cálculo y guarde una sola vez."
        actions={(
          <>
            <a href="/admisiones/costos" target="_blank" rel="noopener noreferrer" style={{ fontFamily: "'Poppins', sans-serif" }}
              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-sm border-2 border-purple bg-white px-3 py-1.5 text-xs font-semibold text-purple shadow-sm transition hover:bg-purple hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-purple/30 focus-visible:ring-offset-2 sm:min-h-[36px]">
              <ExternalLink size={15} aria-hidden="true" /> Ver en el sitio<span className="sr-only"> (se abre en otra pestaña)</span>
            </a>
            <Button variant="secondary" size="sm" onClick={exportXlsx}><FileDown size={15} aria-hidden="true" /> Exportar Excel</Button>
            <Button variant="secondary" size="sm" onClick={() => setImporting(true)}><FileUp size={15} aria-hidden="true" /> Importar Excel</Button>
          </>
        )}
      />

      <div className="mb-5 flex gap-3 rounded-md border border-green/25 bg-green-50/60 p-4 text-sm text-ink">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-green-700" aria-hidden="true" />
        <div className="space-y-1">
          <p>Estos precios se ven en <strong>Admisiones › Costos</strong> y alimentan el <strong>estimador de Admisiones</strong>: un cambio aquí cambia los dos.</p>
          <p className="text-muted">
            El ciclo escolar no se escribe aquí: el sitio lo calcula solo (hoy {CURRENT_CYCLE}) y en los textos de la página se escribe <code className="rounded-sm bg-white px-1 text-ink">{'{{ciclo}}'}</code>.
            Títulos, encabezados y notas de las tablas se editan en <Link to="/admin/contenido" className="font-semibold text-green-700 underline underline-offset-2">Páginas › Costos</Link>.
          </p>
        </div>
      </div>

      <div role="tablist" aria-label="Tablas de precios" className="mb-4 flex flex-wrap gap-2">
        {TABLES.map((t) => {
          const selected = t.key === tab;
          const n = changes[t.key].length;
          const errs = tabErrors(t.key);
          return (
            <button key={t.key} id={`tab-${t.key}`} type="button" role="tab" aria-selected={selected} aria-controls="pricing-panel" tabIndex={selected ? 0 : -1}
              onClick={() => setTab(t.key)}
              onKeyDown={onTabKey}
              className={`inline-flex min-h-[44px] items-center gap-2 rounded-sm px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40 sm:min-h-[36px] ${selected ? 'bg-purple text-white' : 'bg-cream-2 text-muted hover:text-ink'}`}>
              {t.tab}
              {errs > 0 ? (
                <span className={`rounded-full px-1.5 text-[11px] font-bold tabular-nums ${selected ? 'bg-white text-coral-700' : 'bg-coral-600 text-white'}`}>{errs}<span className="sr-only"> {errs === 1 ? 'dato por corregir' : 'datos por corregir'}</span></span>
              ) : n > 0 ? (
                <span className={`h-2 w-2 rounded-full ${selected ? 'bg-white' : 'bg-coral-600'}`}><span className="sr-only">, {changesLabel(n)} sin guardar</span></span>
              ) : null}
            </button>
          );
        })}
      </div>

      <div id="pricing-panel" role="tabpanel" aria-labelledby={`tab-${tab}`} ref={panelRef} className="card !p-4 sm:!p-5">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
          <div className="min-w-0">
            <h2 className="font-head text-lg font-bold text-ink">{def.title}</h2>
            <p className="text-sm text-muted">{def.where}</p>
          </div>
          {changes[tab].length > 0 && <p className="text-sm font-semibold text-coral-700">{changesLabel(changes[tab].length)} sin guardar</p>}
        </div>
        {def.groupBy ? (
          <div className="space-y-6">
            {def.groupBy.groups.map((g) => (
              <section key={g.value} aria-labelledby={`grp-${g.value}`}>
                <h3 id={`grp-${g.value}`} className="font-head text-[15px] font-bold text-ink">{g.label}</h3>
                <p className="mb-2 text-xs text-subtle">{g.hint}</p>
                <PriceGrid def={def} group={g} rows={state[tab].rows} before={state[tab].base} errors={errorsOf(tab)} wide={wide}
                  onChange={(rows) => setRows(tab, rows)} onDelete={(row) => setDeleting({ table: tab, row })} />
              </section>
            ))}
          </div>
        ) : (
          <PriceGrid def={def} rows={state[tab].rows} before={state[tab].base} errors={errorsOf(tab)} wide={wide}
            highlighted={tab === 'politicas' ? highlighted : undefined}
            onChange={(rows) => setRows(tab, rows)} onDelete={(row) => setDeleting({ table: tab, row })} />
        )}
        <p className="mt-4 text-xs text-subtle">Enter y las flechas mueven entre celdas; Alt + ↑ / ↓ mueve la fila. «Oculta» quita la fila del sitio sin borrarla.</p>
      </div>

      <section aria-labelledby="preview-title" className="card mt-6 !p-0">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
          <div>
            <h2 id="preview-title" className="font-head text-[15px] font-bold text-ink">Vista previa del sitio</h2>
            <p className="text-xs text-subtle">Con las cifras de este editor, aún sin guardar, y los textos publicados de la página.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {showPreview && (
              <div role="group" aria-label="Qué mostrar" className="flex rounded-md bg-cream-2 p-1">
                {([['tables', 'Tablas de Costos'], ['estimator', 'Estimador']] as const).map(([v, label]) => (
                  <button key={v} type="button" aria-pressed={previewView === v} onClick={() => setPreviewView(v)}
                    className={`min-h-[36px] rounded-sm px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40 ${previewView === v ? 'bg-white text-ink shadow-sm' : 'text-muted hover:text-ink'}`}>{label}</button>
                ))}
              </div>
            )}
            <Button variant="ghost" size="sm" aria-expanded={showPreview} aria-controls="pricing-preview" onClick={() => setPreviewOpen(!showPreview)}>
              {showPreview ? 'Ocultar' : 'Mostrar vista previa'}
            </Button>
          </div>
        </div>
        {showPreview && bundle && (
          <div id="pricing-preview" className="overflow-hidden rounded-b-md">
            <Suspense fallback={<div className="flex min-h-[240px] items-center justify-center"><LoadingSpinner /></div>}>
              <PricingPreview bundle={bundle} view={previewView} copy={pricingCopy} estimatorCopy={estimatorCopy} />
            </Suspense>
          </div>
        )}
      </section>

      {dirty.length > 0 && (
        // Above the phone tab bar (62 px + safe area, MobileTabBar); at the bottom edge on desktop.
        <div className="sticky bottom-[calc(62px+env(safe-area-inset-bottom))] z-sticky mt-6 rounded-md bg-white/95 px-4 py-3 shadow-card backdrop-blur lg:bottom-0">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-ink" role="status">
              <strong>{changesLabel(totalChanges)}</strong> sin guardar en {dirty.map((k) => TABLES.find((t) => t.key === k)!.tab).join(', ')}
              {source === 'import' && <span className="text-subtle"> (desde Excel)</span>}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" size="sm" onClick={() => setDiscarding(true)}><RotateCcw size={15} aria-hidden="true" /> Descartar</Button>
              <Button size="sm" onClick={askToSave}><Save size={15} aria-hidden="true" /> Guardar cambios</Button>
            </div>
          </div>
        </div>
      )}

      <Modal open={reviewing} onClose={() => !saving && setReviewing(false)} title="Revise los cambios antes de guardar" maxWidth={720}>
        <div className="space-y-4">
          <p className="text-sm text-muted">Se guarda todo junto: si algo no se puede guardar, no se guarda nada. Cada cambio queda en Auditoría con el monto anterior y el nuevo.</p>
          <div className="max-h-[55vh] space-y-3 overflow-y-auto pr-1">
            {dirty.map((k) => <ChangeList key={k} def={TABLES.find((t) => t.key === k) as TableDef} changes={changes[k]} />)}
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setReviewing(false)} disabled={saving}>Seguir editando</Button>
            <Button size="sm" onClick={save} loading={saving}>Guardar {changesLabel(totalChanges)}</Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleting}
        title="Eliminar fila"
        message={deleting && <>Se eliminará <strong className="text-ink">«{rowTitle(TABLES.find((t) => t.key === deleting.table)!, deleting.row)}»</strong> de {TABLES.find((t) => t.key === deleting.table)!.title} al guardar. Si solo quiere quitarla del sitio por un tiempo, use «Visible».</>}
        confirmLabel="Eliminar fila"
        onConfirm={() => { if (deleting) setRows(deleting.table, state[deleting.table].rows.filter((r) => r._key !== deleting.row._key)); setDeleting(null); }}
        onClose={() => setDeleting(null)}
      />

      <ConfirmDialog
        open={discarding}
        title="Descartar los cambios"
        message={<>Se perderán {changesLabel(totalChanges)} sin guardar y las tablas vuelven a los precios guardados.</>}
        confirmLabel="Descartar cambios"
        onConfirm={() => { setState((s) => (s ? Object.fromEntries(TABLES.map((t) => [t.key, { ...s[t.key], rows: s[t.key].base.map((r) => ({ ...r, values: { ...r.values } })) }])) as State : s)); setServerErrors({}); setSource('editor'); setDiscarding(false); }}
        onClose={() => setDiscarding(false)}
      />

      <Modal open={!!conflict} onClose={() => setConflict(null)} title="Otra persona cambió los precios">
        <div className="space-y-4">
          <p className="flex gap-2 text-sm text-muted">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber" aria-hidden="true" />
            <span>Mientras usted editaba, alguien guardó {conflict?.map((k) => TABLES.find((t) => t.key === k)!.title).join(', ')}. Sus cambios no se guardaron. Recargue esas tablas para ver la versión actual y vuelva a hacer sus cambios.</span>
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setConflict(null)}>Cerrar</Button>
            <Button size="sm" onClick={() => conflict && void reload(conflict)}>Recargar esas tablas</Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!guard.pending}
        title="Cambios sin guardar"
        message={<>Tiene {changesLabel(totalChanges)} sin guardar. Si sale ahora, se pierden.</>}
        confirmLabel="Salir sin guardar"
        onConfirm={guard.leave}
        onClose={guard.stay}
      />

      <PricingImportDialog
        open={importing}
        onClose={() => setImporting(false)}
        saved={Object.fromEntries(TABLES.map((t) => [t.key, state[t.key].base])) as Record<Key, EditRow[]>}
        unsaved={dirty}
        onExport={exportXlsx}
        onLoad={(tables) => {
          setState((s) => {
            if (!s) return s;
            const next = { ...s };
            for (const [k, rows] of Object.entries(tables)) if (rows) next[k as Key] = { ...s[k as Key], rows };
            return next;
          });
          setSource('import');
          const first = TABLES.find((t) => tables[t.key]);
          if (first) setTab(first.key);
          toast.success('Cambios cargados. Revise y pulse «Guardar cambios».');
        }}
      />
    </div>
  );
}
