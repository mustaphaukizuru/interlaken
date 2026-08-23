import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Plus, RotateCcw, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ListSkeleton } from '@/components/ui/ListSkeleton';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { contentApi, type SiteRedirect } from '@/services/api';
import type { MenuGroup } from '@/types/content';
import { apiErrors } from '@/cms/editor/helpers';

const ICON_OPTIONS = ['Users', 'BookOpen', 'Camera', 'Blocks', 'Pencil', 'GraduationCap', 'ClipboardList', 'FileText', 'CircleDollarSign', 'UserPlus', 'CalendarDays', 'MonitorSmartphone', 'Receipt', 'Phone', 'Mail', 'MapPin'];

/** The built-in menu, offered as the starting point when the CMS menu is empty. */
export const DEFAULT_MENU: MenuGroup[] = [
  { label: 'El Colegio', items: [{ label: 'Quiénes Somos', to: '/nosotros', icon: 'Users' }, { label: 'Modelo Educativo', to: '/modelo-educativo', icon: 'BookOpen' }, { label: 'Galería', to: '/galeria', icon: 'Camera' }] },
  { label: 'Niveles Educativos', items: [{ label: 'Preescolar', to: '/niveles/preescolar', icon: 'Blocks' }, { label: 'Primaria', to: '/niveles/primaria', icon: 'Pencil' }, { label: 'Secundaria', to: '/niveles/secundaria', icon: 'GraduationCap' }] },
  { label: 'Admisiones', items: [{ label: 'Proceso de Inscripción', to: '/admisiones', icon: 'ClipboardList' }, { label: 'Documentación', to: '/admisiones/documentacion', icon: 'FileText' }, { label: 'Costos', to: '/admisiones/costos', icon: 'CircleDollarSign' }, { label: 'Pre-Registro', to: '/pre-registro', icon: 'UserPlus' }] },
  { label: 'Comunidad', items: [{ label: 'Plataformas', to: '/comunidad/plataformas', icon: 'MonitorSmartphone' }, { label: 'Calendario escolar', to: '/calendario', icon: 'CalendarDays' }, { label: 'Facturación', to: '/comunidad/facturacion', icon: 'Receipt' }] },
];

function moveAt<T>(list: T[], i: number, d: -1 | 1): T[] {
  const j = i + d;
  if (j < 0 || j >= list.length) return list;
  const n = list.slice();
  [n[i], n[j]] = [n[j], n[i]];
  return n;
}

/** /admin/navegacion — header/footer/mobile menu editor + redirects (BACKLOG P3-7). */
export default function AdminNavigation() {
  return (
    <>
      <PageHeader title="Navegación" subtitle="El menú del encabezado, el pie de página y el menú móvil se editan aquí una sola vez. Las redirecciones evitan enlaces rotos al renombrar páginas." />
      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <MenuEditor />
        <RedirectsPanel />
      </div>
    </>
  );
}

function MenuEditor() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['admin-site-settings'], queryFn: async () => (await contentApi.adminGetSettings()).data as { menu?: MenuGroup[] } });
  const [draft, setDraft] = useState<MenuGroup[] | null>(null);
  const [customOverride, setCustomOverride] = useState<boolean | null>(null);
  const [error, setError] = useState('');
  const stored = data?.menu ?? [];
  const custom = customOverride ?? stored.length > 0;
  const menu = draft ?? (stored.length > 0 ? stored : DEFAULT_MENU);
  const setMenu = (next: MenuGroup[] | ((m: MenuGroup[]) => MenuGroup[])) => setDraft(typeof next === 'function' ? next(menu) : next);
  const setCustom = setCustomOverride;
  const save = useMutation({
    mutationFn: (value: MenuGroup[]) => contentApi.adminUpdateSettings({ menu: value }),
    onSuccess: () => { toast.success('Menú guardado. El sitio lo muestra en unos minutos.'); setError(''); setDraft(null); setCustomOverride(null); qc.invalidateQueries({ queryKey: ['admin-site-settings'] }); qc.invalidateQueries({ queryKey: ['site-settings'] }); },
    onError: (e) => { const f = apiErrors(e); setError(f.menu || f.detail || 'No se pudo guardar.'); },
  });
  const setGroup = (gi: number, patch: Partial<MenuGroup>) => setMenu((m) => m.map((g, i) => (i === gi ? { ...g, ...patch } : g)));
  const setItem = (gi: number, ii: number, patch: Partial<MenuGroup['items'][number]>) => setGroup(gi, { items: menu[gi].items.map((it, j) => (j === ii ? { ...it, ...patch } : it)) });
  if (isLoading) return <Card><ListSkeleton /></Card>;
  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-head text-lg font-bold text-ink">Menú del sitio</h2>
        <div className="flex gap-2">
          {custom && <Button size="sm" variant="ghost" onClick={() => { setCustom(false); setMenu(DEFAULT_MENU); save.mutate([]); }}><RotateCcw size={14} aria-hidden="true" /> Volver al menú integrado</Button>}
          <Button size="sm" onClick={() => { setCustom(true); save.mutate(menu); }} loading={save.isPending}>Guardar menú</Button>
        </div>
      </div>
      {!custom && <p className="mb-3 rounded-lg bg-cream-2 px-3 py-2 text-xs text-muted">Actualmente el sitio usa el menú integrado. Edite y guarde para reemplazarlo.</p>}
      {error && <p className="mb-3 text-sm text-coral-600" role="alert">{error}</p>}
      <div className="space-y-4">
        {menu.map((g, gi) => (
          <fieldset key={gi} className="rounded-xl border border-line p-3">
            <div className="mb-2 flex items-end gap-2">
              <div className="flex-1"><Input label="Grupo" value={g.label} onChange={(e) => setGroup(gi, { label: e.target.value })} /></div>
              <button type="button" aria-label="Subir grupo" disabled={gi === 0} className="rounded p-2 text-subtle hover:text-ink disabled:opacity-30" onClick={() => setMenu((m) => moveAt(m, gi, -1))}><ArrowUp size={16} /></button>
              <button type="button" aria-label="Bajar grupo" disabled={gi === menu.length - 1} className="rounded p-2 text-subtle hover:text-ink disabled:opacity-30" onClick={() => setMenu((m) => moveAt(m, gi, 1))}><ArrowDown size={16} /></button>
              <button type="button" aria-label="Eliminar grupo" className="rounded p-2 text-subtle hover:text-coral-600" onClick={() => setMenu((m) => m.filter((_, i) => i !== gi))}><Trash2 size={16} /></button>
            </div>
            <ul className="space-y-2">
              {g.items.map((it, ii) => (
                <li key={ii} className="grid items-end gap-2 rounded-lg bg-cream-2 p-2 sm:grid-cols-[1fr_1fr_150px_auto]">
                  <Input label="Texto" value={it.label} onChange={(e) => setItem(gi, ii, { label: e.target.value })} />
                  <Input label="Ruta o URL" value={it.to} onChange={(e) => setItem(gi, ii, { to: e.target.value })} placeholder="/admisiones" />
                  <div>
                    <label className="label" htmlFor={`ic-${gi}-${ii}`}>Ícono</label>
                    <select id={`ic-${gi}-${ii}`} className="input-field" value={it.icon ?? ''} onChange={(e) => setItem(gi, ii, { icon: e.target.value })}>
                      <option value="">(ninguno)</option>
                      {ICON_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </div>
                  <div className="flex gap-1 pb-1">
                    <button type="button" aria-label="Subir enlace" disabled={ii === 0} className="rounded p-1 text-subtle hover:text-ink disabled:opacity-30" onClick={() => setGroup(gi, { items: moveAt(g.items, ii, -1) })}><ArrowUp size={14} /></button>
                    <button type="button" aria-label="Bajar enlace" disabled={ii === g.items.length - 1} className="rounded p-1 text-subtle hover:text-ink disabled:opacity-30" onClick={() => setGroup(gi, { items: moveAt(g.items, ii, 1) })}><ArrowDown size={14} /></button>
                    <button type="button" aria-label="Quitar enlace" className="rounded p-1 text-subtle hover:text-coral-600" onClick={() => setGroup(gi, { items: g.items.filter((_, j) => j !== ii) })}><Trash2 size={14} /></button>
                  </div>
                </li>
              ))}
            </ul>
            <Button type="button" size="sm" variant="ghost" className="mt-2" onClick={() => setGroup(gi, { items: [...g.items, { label: '', to: '/', icon: '' }] })}><Plus size={14} aria-hidden="true" /> Agregar enlace</Button>
          </fieldset>
        ))}
        <Button type="button" size="sm" variant="secondary" onClick={() => setMenu((m) => [...m, { label: 'Nuevo grupo', items: [{ label: '', to: '/', icon: '' }] }])} disabled={menu.length >= 8}><Plus size={14} aria-hidden="true" /> Agregar grupo</Button>
      </div>
    </Card>
  );
}

function RedirectsPanel() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['admin-redirects'], queryFn: async () => (await contentApi.adminListRedirects()).data });
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [permanent, setPermanent] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [toDelete, setToDelete] = useState<SiteRedirect | null>(null);
  const invalidate = () => { qc.invalidateQueries({ queryKey: ['admin-redirects'] }); qc.invalidateQueries({ queryKey: ['cms-redirects'] }); };
  const create = useMutation({
    mutationFn: () => contentApi.adminCreateRedirect({ from_path: from, to_path: to, permanent }),
    onSuccess: () => { toast.success('Redirección creada.'); setFrom(''); setTo(''); setErrors({}); invalidate(); },
    onError: (e) => setErrors(apiErrors(e)),
  });
  const remove = useMutation({
    mutationFn: (id: number) => contentApi.adminDeleteRedirect(id),
    onSuccess: () => { setToDelete(null); invalidate(); },
  });
  const submit = (e: FormEvent) => { e.preventDefault(); create.mutate(); };
  return (
    <Card>
      <h2 className="mb-3 font-head text-lg font-bold text-ink">Redirecciones</h2>
      <form onSubmit={submit} className="space-y-2">
        <Input label="Ruta antigua" value={from} onChange={(e) => setFrom(e.target.value)} placeholder="/inscripciones" error={errors.from_path} required />
        <Input label="Enviar a" value={to} onChange={(e) => setTo(e.target.value)} placeholder="/admisiones" error={errors.to_path} required />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={permanent} onChange={(e) => setPermanent(e.target.checked)} /> Permanente (301)</label>
        <Button type="submit" size="sm" loading={create.isPending}><Plus size={14} aria-hidden="true" /> Agregar</Button>
      </form>
      <ul className="mt-4 divide-y divide-line" aria-label="Redirecciones">
        {isLoading ? <ListSkeleton /> : (data ?? []).length === 0 ? <li className="py-3 text-sm text-muted">Sin redirecciones.</li> : (data ?? []).map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-2 py-2 text-sm">
            <div className="min-w-0"><p className="truncate font-mono text-xs text-ink">{r.from_path} → {r.to_path}</p><p className="text-xs text-subtle">{r.permanent ? '301' : '302'} · {r.hits} visitas</p></div>
            <button type="button" aria-label={`Eliminar ${r.from_path}`} className="rounded p-1 text-subtle hover:text-coral-600" onClick={() => setToDelete(r)}><Trash2 size={14} /></button>
          </li>
        ))}
      </ul>
      <ConfirmDialog open={!!toDelete} title="¿Eliminar redirección?" message={`${toDelete?.from_path} volverá a mostrar 404 si la página ya no existe.`} confirmLabel="Eliminar redirección" loading={remove.isPending} onConfirm={() => toDelete && remove.mutate(toDelete.id)} onClose={() => setToDelete(null)} />
    </Card>
  );
}
