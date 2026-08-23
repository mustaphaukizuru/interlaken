import { Plus, Trash2 } from 'lucide-react';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { MediaPicker } from '@/components/admin/MediaPicker';
import type { Block, FieldSpec } from '../blocks/registry';
import { blockSpec } from '../blocks/registry';

type Props = { block: Block; onChange: (props: Record<string, unknown>) => void };

/** Property form generated from the block registry (CMS-PLAN: editor form = schema). */
export function BlockForm({ block, onChange }: Props) {
  const spec = blockSpec(block.type);
  if (!spec) return <p className="text-sm text-coral-600">Tipo de bloque desconocido.</p>;
  if (spec.fields.length === 0) return <p className="text-sm text-muted">Este bloque se llena automáticamente con los datos del colegio.</p>;
  const set = (key: string, value: unknown) => onChange({ ...block.props, [key]: value });
  return (
    <div className="space-y-4">
      {spec.fields.map((f) => <Field key={f.key} spec={f} value={block.props[f.key]} onChange={(v) => set(f.key, v)} />)}
    </div>
  );
}

function Field({ spec, value, onChange }: { spec: FieldSpec; value: unknown; onChange: (v: unknown) => void }) {
  const req = spec.required ? ' *' : '';
  switch (spec.kind) {
    case 'text':
    case 'url':
      return <Input label={spec.label + req} type={spec.kind === 'url' ? 'url' : 'text'} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} hint={spec.hint} />;
    case 'number':
      return <Input label={spec.label + req} type="number" value={String(value ?? '')} onChange={(e) => onChange(Number(e.target.value))} />;
    case 'textarea':
    case 'richtext':
      return (
        <div>
          <label className="label" htmlFor={`f-${spec.key}`}>{spec.label + req}</label>
          <textarea id={`f-${spec.key}`} className="input-field min-h-[120px] font-mono text-sm" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />
          {spec.kind === 'richtext' && <p className="mt-1 text-xs text-subtle">HTML sencillo: &lt;p&gt;, &lt;strong&gt;, &lt;em&gt;, &lt;ul&gt;/&lt;li&gt;, &lt;h2&gt;, &lt;a href&gt;. Lo demás se elimina al mostrarse. Atajos: {'{{direccion}}'}, {'{{horario}}'}, {'{{telefono}}'}, {'{{correo}}'} se sustituyen por los datos de Ajustes.</p>}
        </div>
      );
    case 'image':
      return <MediaPicker label={spec.label + req} value={typeof value === 'number' ? value : null} onChange={(id) => onChange(id ?? undefined)} />;
    case 'link': {
      const v = (value as { label?: string; href?: string }) ?? {};
      return (
        <fieldset className="grid gap-3 rounded-xl border border-line p-3 sm:grid-cols-2">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-subtle">{spec.label + req}</legend>
          <Input label="Texto del botón" value={v.label ?? ''} onChange={(e) => onChange({ ...v, label: e.target.value })} />
          <Input label="Enlace (ruta o URL)" value={v.href ?? ''} onChange={(e) => onChange({ ...v, href: e.target.value })} placeholder="/pre-registro" />
        </fieldset>
      );
    }
    case 'images': {
      const list = (value as { image: number; caption?: string }[]) ?? [];
      const update = (i: number, patch: Partial<{ image: number; caption: string }>) => onChange(list.map((it, j) => (j === i ? { ...it, ...patch } : it)));
      return (
        <fieldset className="space-y-3 rounded-xl border border-line p-3">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-subtle">{spec.label + req}</legend>
          {list.map((it, i) => (
            <div key={i} className="flex flex-col gap-2 rounded-lg bg-cream-2 p-2 sm:flex-row sm:items-end">
              <div className="flex-1"><MediaPicker label={`Imagen ${i + 1}`} value={it.image} onChange={(id) => update(i, { image: id ?? 0 })} /></div>
              <div className="flex-1"><Input label="Pie" value={it.caption ?? ''} onChange={(e) => update(i, { caption: e.target.value })} /></div>
              <Button type="button" size="sm" variant="ghost" onClick={() => onChange(list.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" aria-hidden="true" /></Button>
            </div>
          ))}
          <Button type="button" size="sm" variant="secondary" onClick={() => onChange([...list, { image: 0, caption: '' }])}><Plus className="h-4 w-4" aria-hidden="true" /> Agregar imagen</Button>
        </fieldset>
      );
    }
    case 'items': {
      const list = (value as Record<string, unknown>[]) ?? [];
      const sub = spec.item ?? [];
      const update = (i: number, patch: Record<string, unknown>) => onChange(list.map((it, j) => (j === i ? { ...it, ...patch } : it)));
      return (
        <fieldset className="space-y-3 rounded-xl border border-line p-3">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-subtle">{spec.label + req}</legend>
          {list.map((it, i) => (
            <div key={i} className="space-y-2 rounded-lg bg-cream-2 p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-subtle">#{i + 1}</span>
                <Button type="button" size="sm" variant="ghost" onClick={() => onChange(list.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" aria-hidden="true" /></Button>
              </div>
              {sub.map((sf) => <Field key={sf.key} spec={sf} value={it[sf.key]} onChange={(v) => update(i, { [sf.key]: v })} />)}
            </div>
          ))}
          <Button type="button" size="sm" variant="secondary" onClick={() => onChange([...list, Object.fromEntries(sub.map((sf) => [sf.key, '']))])}><Plus className="h-4 w-4" aria-hidden="true" /> Agregar</Button>
        </fieldset>
      );
    }
    default:
      return null;
  }
}

export default BlockForm;
