import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { MediaPicker } from '@/components/admin/MediaPicker';
import type { Block, FieldSpec } from '../blocks/registry';
import { blockSpec, withDefaults } from '../blocks/registry';
import { CMS_ICONS, ICON_OPTIONS } from '../icons';
import { COLOR_OPTIONS } from '../runtime';

type Props = { block: Block; onChange: (props: Record<string, unknown>) => void };

/** Property form generated from the block registry (CMS-PLAN: editor form = schema). */
export function BlockForm({ block, onChange }: Props) {
  const spec = blockSpec(block.type);
  if (!spec) return <p className="text-sm text-coral-600">Tipo de bloque desconocido.</p>;
  if (spec.fields.length === 0) return <p className="text-sm text-muted">Este bloque se llena automáticamente con los datos del colegio.</p>;
  // Show what the site shows: a prop added in a later release still displays its default.
  const props = withDefaults(spec, block.props);
  const set = (key: string, value: unknown) => onChange({ ...props, [key]: value });
  return (
    <div className="space-y-4">
      {spec.fields.map((f) => <Field key={f.key} spec={f} value={props[f.key]} onChange={(v) => set(f.key, v)} idPrefix={block.id} />)}
      {spec.fields.some((f) => f.kind !== 'richtext' && f.kind !== 'image' && f.kind !== 'images') && (
        <p className="text-xs text-subtle">En los textos puede usar {'{{anios}}'}, {'{{ciclo}}'}, {'{{telefono}}'}, {'{{correo}}'}, {'{{direccion}}'} y {'{{horario}}'}: se actualizan solos.</p>
      )}
    </div>
  );
}

function move<T>(list: T[], i: number, d: -1 | 1): T[] {
  const j = i + d;
  if (j < 0 || j >= list.length) return list;
  const next = list.slice();
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

/** Empty value of a field, used when adding a list item. */
function emptyOf(f: FieldSpec): unknown {
  if (f.kind === 'items' || f.kind === 'images') return [];
  if (f.kind === 'link') return { label: '', href: '' };
  if (f.kind === 'toggle') return false;
  if (f.kind === 'image' || f.kind === 'number') return undefined;
  if ((f.kind === 'select' || f.kind === 'color' || f.kind === 'icon') && f.options?.[0]) return f.options[0].value;
  return '';
}

function Field({ spec, value, onChange, idPrefix }: { spec: FieldSpec; value: unknown; onChange: (v: unknown) => void; idPrefix: string }) {
  const req = spec.required ? ' *' : '';
  const id = `f-${idPrefix}-${spec.key}`;
  switch (spec.kind) {
    case 'text':
    case 'url':
      return <Input label={spec.label + req} type={spec.kind === 'url' ? 'url' : 'text'} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} hint={spec.hint} />;
    case 'number':
      return <Input label={spec.label + req} type="number" step="any" value={value === undefined || value === null ? '' : String(value)} onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))} hint={spec.hint} />;
    case 'textarea':
    case 'richtext':
      return (
        <div>
          <label className="label" htmlFor={id}>{spec.label + req}</label>
          <textarea id={id} className={`input-field min-h-[100px] text-sm ${spec.kind === 'richtext' ? 'font-mono' : ''}`} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />
          {spec.hint && <p className="mt-1 text-xs text-subtle">{spec.hint}</p>}
          {spec.kind === 'richtext' && <p className="mt-1 text-xs text-subtle">HTML sencillo: &lt;p&gt;, &lt;strong&gt;, &lt;em&gt;, &lt;ul&gt;/&lt;li&gt;, &lt;h2&gt;, &lt;a href&gt;. Lo demás se elimina al mostrarse. Atajos: {'{{direccion}}'}, {'{{horario}}'}, {'{{telefono}}'}, {'{{correo}}'} se sustituyen por los datos de Ajustes.</p>}
        </div>
      );
    case 'toggle':
      return (
        <label className="flex min-h-[40px] items-center gap-2 text-sm text-ink">
          <input type="checkbox" checked={value !== false && value !== undefined && value !== ''} onChange={(e) => onChange(e.target.checked)} /> {spec.label}
        </label>
      );
    case 'select':
    case 'color':
    case 'icon': {
      const options = spec.kind === 'icon' ? ICON_OPTIONS : spec.kind === 'color' ? COLOR_OPTIONS : (spec.options ?? []);
      const current = String(value ?? '');
      const known = options.some((o) => o.value === current);
      const Icon = spec.kind === 'icon' ? CMS_ICONS[current] : undefined;
      return (
        <div>
          <label className="label" htmlFor={id}>{spec.label + req}</label>
          <div className="flex items-center gap-2">
            {spec.kind === 'color' && <span className="h-8 w-8 shrink-0 rounded-lg ring-1 ring-line" style={{ background: current || 'transparent' }} aria-hidden="true" />}
            {Icon && <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-cream-2 text-ink" aria-hidden="true"><Icon size={16} /></span>}
            <select id={id} className="input-field" value={current} onChange={(e) => onChange(e.target.value)}>
              {!known && <option value={current}>{current || '(sin valor)'}</option>}
              {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          {spec.hint && <p className="mt-1 text-xs text-subtle">{spec.hint}</p>}
        </div>
      );
    }
    case 'image':
      return (
        <div>
          <MediaPicker label={spec.label + req} value={typeof value === 'number' || typeof value === 'string' ? value : null} onChange={(ref) => onChange(ref ?? '')} />
          {spec.hint && <p className="mt-1 text-xs text-subtle">{spec.hint}</p>}
        </div>
      );
    case 'link': {
      const v = (value as { label?: string; href?: string }) ?? {};
      return (
        <fieldset className="grid gap-3 rounded-xl border border-line p-3 sm:grid-cols-2">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-subtle">{spec.label + req}</legend>
          <Input label="Texto del botón" value={v.label ?? ''} onChange={(e) => onChange({ ...v, label: e.target.value })} />
          <Input label="Enlace (ruta o URL)" value={v.href ?? ''} onChange={(e) => onChange({ ...v, href: e.target.value })} placeholder="/pre-registro" hint="Vacío = el botón no se muestra." />
        </fieldset>
      );
    }
    case 'images': {
      type Img = { image: number | string; caption?: string };
      const list = (Array.isArray(value) ? value : []) as Img[];
      const update = (i: number, patch: Partial<Img>) => onChange(list.map((it, j) => (j === i ? { ...it, ...patch } : it)));
      return (
        <fieldset className="space-y-3 rounded-xl border border-line p-3">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-subtle">{spec.label + req} ({list.length})</legend>
          {list.map((it, i) => (
            <div key={i} className="flex flex-col gap-2 rounded-lg bg-cream-2 p-2">
              <MediaPicker label={`Imagen ${i + 1}`} value={it.image || null} onChange={(ref) => update(i, { image: ref ?? '' })} />
              <Input label="Pie de foto" value={it.caption ?? ''} onChange={(e) => update(i, { caption: e.target.value })} />
              <ItemTools index={i} count={list.length} onMove={(d) => onChange(move(list, i, d))} onRemove={() => onChange(list.filter((_, j) => j !== i))} />
            </div>
          ))}
          <MediaPicker
            label="Agregar fotos"
            multiple
            value={null}
            onChange={() => undefined}
            onPickMany={(refs) => onChange([...list, ...refs.map((image) => ({ image, caption: '' }))])}
          />
        </fieldset>
      );
    }
    case 'items': {
      const list = (Array.isArray(value) ? value : []) as Record<string, unknown>[];
      const sub = spec.item ?? [];
      const update = (i: number, patch: Record<string, unknown>) => onChange(list.map((it, j) => (j === i ? { ...it, ...patch } : it)));
      const title = (it: Record<string, unknown>) => String(it[sub.find((sf) => sf.kind === 'text')?.key ?? ''] ?? '').slice(0, 40);
      return (
        <fieldset className="space-y-3 rounded-xl border border-line p-3">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-subtle">{spec.label + req} ({list.length})</legend>
          {list.map((it, i) => (
            <details key={i} className="group rounded-lg bg-cream-2 p-3" open={list.length <= 3}>
              <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-xs font-semibold text-subtle">
                <span className="truncate">#{i + 1} {title(it)}</span>
              </summary>
              <div className="mt-3 space-y-3">
                {sub.map((sf) => <Field key={sf.key} spec={sf} value={it[sf.key]} onChange={(v) => update(i, { [sf.key]: v })} idPrefix={`${idPrefix}-${spec.key}-${i}`} />)}
                <ItemTools index={i} count={list.length} onMove={(d) => onChange(move(list, i, d))} onRemove={() => onChange(list.filter((_, j) => j !== i))} onDuplicate={() => onChange([...list.slice(0, i + 1), JSON.parse(JSON.stringify(it)), ...list.slice(i + 1)])} />
              </div>
            </details>
          ))}
          <Button type="button" size="sm" variant="secondary" onClick={() => onChange([...list, Object.fromEntries(sub.map((sf) => [sf.key, emptyOf(sf)]))])}><Plus className="h-4 w-4" aria-hidden="true" /> Agregar</Button>
        </fieldset>
      );
    }
    default:
      return null;
  }
}

function ItemTools({ index, count, onMove, onRemove, onDuplicate }: { index: number; count: number; onMove: (d: -1 | 1) => void; onRemove: () => void; onDuplicate?: () => void }) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-1">
      <Button type="button" size="sm" variant="ghost" aria-label="Subir" disabled={index === 0} onClick={() => onMove(-1)}><ArrowUp className="h-4 w-4" aria-hidden="true" /></Button>
      <Button type="button" size="sm" variant="ghost" aria-label="Bajar" disabled={index === count - 1} onClick={() => onMove(1)}><ArrowDown className="h-4 w-4" aria-hidden="true" /></Button>
      {onDuplicate && <Button type="button" size="sm" variant="ghost" onClick={onDuplicate}>Duplicar</Button>}
      <Button type="button" size="sm" variant="ghost" aria-label="Quitar" onClick={onRemove}><Trash2 className="h-4 w-4" aria-hidden="true" /></Button>
    </div>
  );
}

export default BlockForm;
