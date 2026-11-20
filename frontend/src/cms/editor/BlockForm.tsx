/**
 * Property form of a block, generated from its spec (CMS-PLAN: editor form =
 * schema). Every field kind has a control an office user can use without
 * knowing links, icon names or HTML (cms/editor/fields); long sections read
 * as collapsible groups (FieldSpec.group); problems show next to their field
 * as soon as the field is left, and server errors (save, publish, checks)
 * show there too until the field is edited.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ChevronRight, Copy, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import type { Block, BlockSpec, FieldSpec } from '../blocks/registry';
import { blockSpec, withDefaults } from '../blocks/registry';
import { helpFor } from './fieldHelp';
import { fieldDomId, focusFieldElement, onFieldFocusRequest, peekFieldFocus, takeFieldFocus } from './fieldFocus';
import { slugify } from './helpers';
import { imageIdsIn, isEmptyValue, validateFields, type CmsFieldError, type FieldIssue } from './validation';
import { ColorField } from './fields/ColorField';
import { FieldGroup } from './fields/FieldGroup';
import { describedBy, FieldLabel, FieldNotes, invalidClass } from './fields/FieldShell';
import { FormSelect } from './fields/FormSelect';
import { IconField } from './fields/IconField';
import { DEFAULT_MIN_WIDTH, ImageField, MediaLibraryDialog } from './fields/ImageField';
import { HrefInput, LinkField } from './fields/LinkField';
import { MarkTextField } from './fields/MarkTextField';
import { useMediaLookup } from './fields/media';
import { RichTextEditor } from './fields/RichTextEditor';
import { TextField } from './fields/TextField';

/** `field` names the top-level prop that changed (undo groups consecutive edits of one field). */
type Props = {
  block: Block;
  onChange: (props: Record<string, unknown>, field: string) => void;
  /** Structured errors of this block from the server (save, publish, checks): shown at their field until it is edited. */
  serverErrors?: CmsFieldError[];
};

export function BlockForm({ block, onChange, serverErrors }: Props) {
  const spec = blockSpec(block.type);
  if (!spec) return <p className="text-sm text-coral-600">Tipo de bloque desconocido.</p>;
  if (spec.fields.length === 0) return <p className="text-sm text-muted">Este bloque se llena automáticamente con los datos del colegio.</p>;
  return <SpecForm key={block.id} block={block} spec={spec} onChange={onChange} serverErrors={serverErrors ?? []} />;
}

/* ── Group open/closed memory (per section type, this browser only) ── */
const GROUPS_KEY = 'cms-field-groups';
function readGroups(type: string): Record<string, boolean> | null {
  try {
    const all = JSON.parse(localStorage.getItem(GROUPS_KEY) ?? '{}') as Record<string, Record<string, boolean>>;
    return all && typeof all[type] === 'object' ? all[type] : null;
  } catch {
    return null;
  }
}
function writeGroups(type: string, state: Record<string, boolean>) {
  try {
    const all = JSON.parse(localStorage.getItem(GROUPS_KEY) ?? '{}') as Record<string, Record<string, boolean>>;
    localStorage.setItem(GROUPS_KEY, JSON.stringify({ ...all, [type]: state }));
  } catch { /* private mode or full storage: the groups just reopen as default */ }
}

/** Fields in order, consecutive fields of one group together. */
export function fieldSegments(fields: FieldSpec[]): { group?: string; fields: FieldSpec[] }[] {
  const out: { group?: string; fields: FieldSpec[] }[] = [];
  for (const f of fields) {
    const last = out[out.length - 1];
    if (last && f.group && last.group === f.group) last.fields.push(f);
    else out.push({ group: f.group, fields: [f] });
  }
  return out;
}

const topKey = (path: string) => path.split('.')[0];

/** When a list's derived key changes (a gallery filter renamed), the lists that point at it follow. */
function followRenames(fields: FieldSpec[], list: FieldSpec, before: unknown, after: unknown, next: Record<string, unknown>): Record<string, unknown> {
  const derived = list.item?.find((sf) => sf.slugFrom);
  if (!derived || !Array.isArray(before) || !Array.isArray(after) || before.length !== after.length) return next;
  const renames = new Map<string, string>();
  before.forEach((b, i) => {
    const from = String((b as Record<string, unknown>)?.[derived.key] ?? '');
    const to = String((after[i] as Record<string, unknown>)?.[derived.key] ?? '');
    if (from && to && from !== to) renames.set(from, to);
  });
  if (!renames.size) return next;
  const out = { ...next };
  for (const f of fields) {
    if (f.kind !== 'items' || !Array.isArray(out[f.key])) continue;
    const ref = f.item?.find((sf) => sf.optionsFrom?.list === list.key && sf.optionsFrom.value === derived.key);
    if (!ref) continue;
    out[f.key] = (out[f.key] as Record<string, unknown>[]).map((it) => {
      const v = String(it?.[ref.key] ?? '');
      return renames.has(v) ? { ...it, [ref.key]: renames.get(v) } : it;
    });
  }
  return out;
}

interface FormCtx {
  blockId: string;
  type: string;
  props: Record<string, unknown>;
  errorFor: (path: string) => { error?: string; altError?: string };
  touch: (path: string) => void;
  edited: (path: string) => void;
  issuesUnder: (prefix: string) => number;
}

function SpecForm({ block, spec, onChange, serverErrors }: { block: Block; spec: BlockSpec; onChange: Props['onChange']; serverErrors: CmsFieldError[] }) {
  // Show what the site shows: a prop added in a later release still displays its default.
  const props = withDefaults(spec, block.props);
  const media = useMediaLookup(imageIdsIn(spec.fields, props));
  const issues = validateFields(spec.fields, props, media);
  const byPath = new Map<string, FieldIssue>();
  for (const i of issues) if (!byPath.has(i.path)) byPath.set(i.path, i);

  // A field shows its problem once it was left (blur), and from then on as you type.
  // A jump requested before this form existed opens its group from the first render;
  // it is only read here (render must stay pure: StrictMode renders twice) and taken in an effect.
  const [initialFocus] = useState(() => peekFieldFocus(block.id));
  const [touched, setTouched] = useState<Set<string>>(() => new Set(initialFocus ? [initialFocus] : []));
  const touch = (path: string) => setTouched((t) => (t.has(path) ? t : new Set(t).add(path)));
  // Server errors stand until their field is edited.
  const serverKey = JSON.stringify(serverErrors.map((e) => [e.field, e.message]));
  const [editedFor, setEditedFor] = useState<{ key: string; paths: Set<string> }>({ key: serverKey, paths: new Set() });
  const editedPaths = editedFor.key === serverKey ? editedFor.paths : new Set<string>();
  const edited = (path: string) => setEditedFor((s) => ({ key: serverKey, paths: new Set(s.key === serverKey ? s.paths : []).add(path) }));
  const server = new Map<string, string>();
  for (const e of serverErrors) {
    if (!e.field || editedPaths.has(e.field) || [...editedPaths].some((p) => e.field.startsWith(`${p}.`))) continue;
    if (!server.has(e.field)) server.set(e.field, e.message);
  }
  const reveal = serverErrors.length > 0;

  const errorFor = (path: string) => {
    const issue = byPath.get(path);
    const shown = touched.has(path) || reveal ? issue : undefined;
    const fromServer = server.get(path);
    if (shown?.code === 'alt') return { altError: shown.message, error: fromServer && fromServer !== shown.message ? fromServer : undefined };
    return { error: shown?.message ?? fromServer };
  };
  const issuesUnder = (prefix: string) => {
    const match = (p: string) => p === prefix || p.startsWith(prefix.endsWith('.') ? prefix : `${prefix}.`);
    return issues.filter((i) => match(i.path)).length + [...server.keys()].filter((p) => match(p) && !byPath.has(p)).length;
  };

  /* Groups: open state per section type, remembered in this browser. */
  const segs = useMemo(() => fieldSegments(spec.fields), [spec]);
  const [open, setOpen] = useState<Record<string, boolean>>(() => {
    const saved = readGroups(spec.type) ?? {};
    const first = segs.find((s) => s.group)?.group;
    const init: Record<string, boolean> = {};
    for (const s of segs) if (s.group) init[s.group] = saved[s.group] ?? s.group === first;
    const g = initialFocus ? spec.fields.find((f) => f.key === topKey(initialFocus))?.group : undefined;
    if (g) init[g] = true;
    return init;
  });
  const toggle = (g: string) => setOpen((o) => { const next = { ...o, [g]: !o[g] }; writeGroups(spec.type, next); return next; });

  /* «Ir al campo» from the error summary or the checks list. */
  const formRef = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<string | null>(null);
  const [, bump] = useState(0);
  useEffect(() => { const path = takeFieldFocus(block.id); if (path !== null) pendingFocus.current = path; }, [block.id]);
  useEffect(() => onFieldFocusRequest((r) => {
    if (r.blockId !== block.id) return;
    const path = takeFieldFocus(block.id);
    if (path === null) return;
    pendingFocus.current = path;
    const g = spec.fields.find((f) => f.key === topKey(path))?.group;
    if (g) setOpen((o) => (o[g] ? o : { ...o, [g]: true }));
    setTouched((t) => new Set(t).add(path));
    bump((n) => n + 1);
  }), [block.id, spec]);
  useEffect(() => {
    const path = pendingFocus.current;
    if (path === null || !formRef.current) return;
    pendingFocus.current = null;
    focusFieldElement(formRef.current, block.id, path);
  });

  const set = (key: string, value: unknown) => {
    const f = spec.fields.find((x) => x.key === key);
    let next: Record<string, unknown> = { ...props, [key]: value };
    if (f?.kind === 'items') next = followRenames(spec.fields, f, props[key], value, next);
    onChange(next, key);
  };

  const ctx: FormCtx = { blockId: block.id, type: spec.type, props, errorFor, touch, edited, issuesUnder };
  const renderField = (f: FieldSpec) => (
    <Field key={f.key} spec={f} value={props[f.key]} path={f.key} helpPath={f.key} ctx={ctx} onChange={(v) => { edited(f.key); set(f.key, v); }} />
  );

  return (
    <div ref={formRef} className="space-y-4">
      {segs.map((s, i) => {
        if (!s.group) return <div key={`s${i}`} className="space-y-4">{s.fields.map(renderField)}</div>;
        const g = s.group;
        return (
          <FieldGroup
            key={`g${i}`}
            id={`${fieldDomId(block.id, 'group')}-${i}`}
            title={g}
            open={!!open[g]}
            onToggle={() => toggle(g)}
            total={s.fields.length}
            filled={s.fields.filter((f) => !isEmptyValue(f, props[f.key])).length}
            required={s.fields.filter((f) => f.required).length}
            requiredFilled={s.fields.filter((f) => f.required && !isEmptyValue(f, props[f.key])).length}
            errors={s.fields.reduce((n, f) => n + issuesUnder(f.key), 0)}
          >
            {s.fields.map(renderField)}
          </FieldGroup>
        );
      })}
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

/** Width a photo slot needs when its spec does not say: full-width backgrounds and posters need more. */
function slotWidth(type: string, f: FieldSpec): number {
  if (f.minWidth) return f.minWidth;
  if (f.key === 'poster' || (f.key === 'image' && (type === 'hero' || type.endsWith('.hero')))) return 1600;
  return DEFAULT_MIN_WIDTH;
}

interface FieldProps {
  spec: FieldSpec;
  value: unknown;
  onChange: (v: unknown) => void;
  /** Data path (`items.2.title`): ids, errors and focus. */
  path: string;
  /** Help path (`items[].title`). */
  helpPath: string;
  ctx: FormCtx;
}

function Field({ spec, value, onChange, path, helpPath, ctx }: FieldProps) {
  const id = fieldDomId(ctx.blockId, path);
  const { error, altError } = ctx.errorFor(path);
  const hint = helpFor(ctx.type, helpPath, spec);
  const base = { id, label: spec.label, required: spec.required, hint, error, onBlur: () => ctx.touch(path) };
  const str = typeof value === 'string' ? value : value == null ? '' : String(value);
  let control: ReactNode;
  switch (spec.kind) {
    case 'text':
      control = <TextField {...base} value={str} onChange={onChange} />;
      break;
    case 'url':
      control = <TextField {...base} value={str} onChange={onChange} type="url" tokens={false} placeholder="https://" />;
      break;
    case 'textarea':
      control = spec.marks?.length
        ? <MarkTextField {...base} value={str} onChange={onChange} marks={spec.marks} />
        : <TextField {...base} value={str} onChange={onChange} multiline />;
      break;
    case 'richtext':
      control = <RichTextEditor {...base} value={str} onChange={onChange} />;
      break;
    case 'number':
      control = (
        <div>
          <FieldLabel htmlFor={id} label={spec.label} required={spec.required} />
          <input
            id={id}
            type="number"
            step="any"
            inputMode="decimal"
            className={`input-field ${invalidClass(error)}`}
            value={value === undefined || value === null ? '' : String(value)}
            onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
            onBlur={base.onBlur}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy(id, { hint, error })}
          />
          <FieldNotes id={id} hint={hint} error={error} />
        </div>
      );
      break;
    case 'toggle':
      control = (
        <div>
          <label className="flex min-h-[44px] items-center gap-3 text-sm font-medium text-ink" htmlFor={id}>
            <input id={id} type="checkbox" className="h-5 w-5 accent-purple" checked={value !== false && value !== undefined && value !== ''} onChange={(e) => onChange(e.target.checked)} aria-describedby={describedBy(id, { hint })} />
            {spec.label}
          </label>
          <FieldNotes id={id} hint={hint} />
        </div>
      );
      break;
    case 'select': {
      const from = spec.optionsFrom;
      const source = from && Array.isArray(ctx.props[from.list]) ? (ctx.props[from.list] as Record<string, unknown>[]) : [];
      const options = from
        ? source.map((o) => ({ value: String(o?.[from.value] ?? ''), label: String(o?.[from.label] || o?.[from.value] || '') })).filter((o) => o.value)
        : spec.options ?? [];
      const known = options.some((o) => o.value === str);
      control = (
        <div>
          <FieldLabel htmlFor={id} label={spec.label} required={spec.required} />
          <select id={id} className={`input-field ${invalidClass(error)}`} value={str} onChange={(e) => onChange(e.target.value)} onBlur={base.onBlur} aria-invalid={error ? true : undefined} aria-describedby={describedBy(id, { hint, error })}>
            {!known && <option value={str}>{str ? `${str} (no está en la lista)` : from ? 'Sin filtro' : '(sin valor)'}</option>}
            {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <FieldNotes id={id} hint={hint} error={error} />
        </div>
      );
      break;
    }
    case 'color':
      control = <ColorField {...base} value={str} onChange={onChange} />;
      break;
    case 'icon':
      control = <IconField {...base} value={str} onChange={onChange} />;
      break;
    case 'form':
      control = <FormSelect {...base} value={str} onChange={onChange} />;
      break;
    case 'href':
      control = <HrefInput {...base} value={str} onChange={onChange} />;
      break;
    case 'link':
      control = <LinkField {...base} value={value && typeof value === 'object' ? (value as { label?: string; href?: string }) : undefined} onChange={onChange} />;
      break;
    case 'image':
      control = (
        <ImageField
          {...base}
          value={typeof value === 'number' || typeof value === 'string' ? value : null}
          onChange={(ref) => onChange(ref ?? '')}
          altError={altError}
          minWidth={slotWidth(ctx.type, spec)}
        />
      );
      break;
    case 'images':
      control = <GalleryField spec={spec} value={value} onChange={onChange} path={path} ctx={ctx} hint={hint} error={error} />;
      break;
    case 'items':
      control = <ItemsField spec={spec} value={value} onChange={onChange} path={path} helpPath={helpPath} ctx={ctx} hint={hint} error={error} />;
      break;
    default:
      control = null;
  }
  return <div data-field-path={path}>{control}</div>;
}

/** A list of photos with a caption each (gallery fields). */
function GalleryField({ spec, value, onChange, path, ctx, hint, error }: { spec: FieldSpec; value: unknown; onChange: (v: unknown) => void; path: string; ctx: FormCtx; hint?: string; error?: string }) {
  type Img = { image: number | string; caption?: string };
  const list = (Array.isArray(value) ? value : []) as Img[];
  const [adding, setAdding] = useState(false);
  const update = (i: number, patch: Partial<Img>) => onChange(list.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  const id = fieldDomId(ctx.blockId, path);
  return (
    <fieldset className={`min-w-0 space-y-3 rounded-xl border p-3 ${error ? 'border-coral-400' : 'border-line'}`} aria-describedby={describedBy(id, { hint, error })}>
      <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-subtle">{spec.label}{spec.required && <span aria-hidden="true" className="text-coral-600"> *</span>} ({list.length})</legend>
      {list.map((it, i) => {
        const p = `${path}.${i}.image`;
        const { error: e, altError } = ctx.errorFor(p);
        return (
          <div key={i} data-field-path={`${path}.${i}`} className="space-y-2 rounded-lg bg-cream-2 p-2">
            <div data-field-path={p}>
              <ImageField
                id={fieldDomId(ctx.blockId, p)}
                label={`Foto ${i + 1}`}
                value={it.image || null}
                onChange={(ref) => { ctx.edited(p); update(i, { image: ref ?? '' }); }}
                onBlur={() => ctx.touch(p)}
                error={e}
                altError={altError}
                minWidth={spec.minWidth ?? 1200}
              >
                <div className="mt-3">
                  <TextField id={fieldDomId(ctx.blockId, `${path}.${i}.caption`)} label="Pie de foto" value={it.caption ?? ''} onChange={(c) => update(i, { caption: c })} hint="Frase corta que acompaña a la foto. Opcional." />
                </div>
              </ImageField>
            </div>
            <ItemTools label={`foto ${i + 1}`} index={i} count={list.length} onMove={(d) => onChange(move(list, i, d))} onRemove={() => onChange(list.filter((_, j) => j !== i))} />
          </div>
        );
      })}
      <Button type="button" size="sm" variant="secondary" onClick={() => setAdding(true)} id={list.length === 0 ? id : undefined}><Plus className="h-4 w-4" aria-hidden="true" /> Agregar fotos</Button>
      <FieldNotes id={id} hint={hint} error={error} />
      <MediaLibraryDialog open={adding} multiple onClose={() => setAdding(false)} onPick={(ids) => { setAdding(false); onChange([...list, ...ids.map((image) => ({ image, caption: '' }))]); }} />
    </fieldset>
  );
}

/** A list of items (cards, steps, links…): each one collapsible, with move, duplicate and remove. */
function ItemsField({ spec, value, onChange, path, helpPath, ctx, hint, error }: { spec: FieldSpec; value: unknown; onChange: (v: unknown) => void; path: string; helpPath: string; ctx: FormCtx; hint?: string; error?: string }) {
  const list = (Array.isArray(value) ? value : []) as Record<string, unknown>[];
  const sub = spec.item ?? [];
  const main = sub.filter((sf) => !sf.advanced);
  const advanced = sub.filter((sf) => sf.advanced);
  const id = fieldDomId(ctx.blockId, path);
  const titleKey = sub.find((sf) => sf.kind === 'text' || sf.kind === 'textarea')?.key;
  const update = (i: number, key: string, v: unknown) => onChange(list.map((it, j) => {
    if (j !== i) return it;
    const next: Record<string, unknown> = { ...it, [key]: v };
    // A key derived from this field (a filter's «Clave» from its button text) follows it while it is still derived.
    for (const d of sub.filter((sf) => sf.slugFrom?.field === key)) {
      const cur = String(it[d.key] ?? '');
      if (d.slugFrom?.keep?.includes(cur)) continue;
      if (!cur || cur === slugify(String(it[key] ?? ''))) next[d.key] = slugify(String(v ?? ''));
    }
    return next;
  }));
  const renderSub = (sf: FieldSpec, it: Record<string, unknown>, i: number) => {
    const p = `${path}.${i}.${sf.key}`;
    return <Field key={sf.key} spec={sf} value={it[sf.key]} path={p} helpPath={`${helpPath}[].${sf.key}`} ctx={ctx} onChange={(v) => { ctx.edited(p); update(i, sf.key, v); }} />;
  };
  return (
    <fieldset className={`min-w-0 space-y-3 rounded-xl border p-3 ${error ? 'border-coral-400' : 'border-line'}`} aria-describedby={describedBy(id, { hint, error })}>
      <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-subtle">{spec.label}{spec.required && <span aria-hidden="true" className="text-coral-600"> *</span>} ({list.length})</legend>
      {list.map((it, i) => {
        const problems = ctx.issuesUnder(`${path}.${i}.`);
        const title = titleKey ? String(it[titleKey] ?? '').replace(/\*\*/g, '').slice(0, 48) : '';
        return (
          <details key={i} className="group rounded-lg bg-cream-2 p-3" open={list.length <= 3} data-field-path={`${path}.${i}`}>
            <summary className="flex min-h-[32px] cursor-pointer list-none items-center gap-2 text-xs font-semibold text-subtle">
              <ChevronRight size={14} className="shrink-0 transition-transform group-open:rotate-90" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate [contain:inline-size]">{i + 1}. {title || <span className="italic">sin título</span>}</span>
              {problems > 0 && <span className="shrink-0 rounded-full bg-coral-50 px-2 py-0.5 text-[11px] font-semibold text-coral-600">{problems} por corregir</span>}
            </summary>
            <div className="mt-3 space-y-3">
              {main.map((sf) => renderSub(sf, it, i))}
              {advanced.length > 0 && (
                <details className="rounded-lg border border-line bg-white p-2" open={advanced.some((sf) => ctx.issuesUnder(`${path}.${i}.${sf.key}`) > 0) || undefined}>
                  <summary className="flex min-h-[36px] cursor-pointer items-center text-xs font-semibold text-subtle">Avanzado</summary>
                  <div className="mt-2 space-y-3">{advanced.map((sf) => renderSub(sf, it, i))}</div>
                </details>
              )}
              <ItemTools
                label={`elemento ${i + 1}`}
                index={i}
                count={list.length}
                onMove={(d) => onChange(move(list, i, d))}
                onRemove={() => onChange(list.filter((_, j) => j !== i))}
                onDuplicate={() => onChange([...list.slice(0, i + 1), JSON.parse(JSON.stringify(it)), ...list.slice(i + 1)])}
              />
            </div>
          </details>
        );
      })}
      <Button
        id={list.length === 0 ? id : undefined}
        type="button"
        size="sm"
        variant="secondary"
        onClick={() => onChange([...list, Object.fromEntries(sub.map((sf) => [sf.key, emptyOf(sf)]))])}
      >
        <Plus className="h-4 w-4" aria-hidden="true" /> Agregar
      </Button>
      <FieldNotes id={id} hint={hint} error={error} />
    </fieldset>
  );
}

function ItemTools({ label, index, count, onMove, onRemove, onDuplicate }: { label: string; index: number; count: number; onMove: (d: -1 | 1) => void; onRemove: () => void; onDuplicate?: () => void }) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-1">
      <Button type="button" size="sm" variant="ghost" aria-label={`Subir ${label}`} disabled={index === 0} onClick={() => onMove(-1)}><ArrowUp className="h-4 w-4" aria-hidden="true" /></Button>
      <Button type="button" size="sm" variant="ghost" aria-label={`Bajar ${label}`} disabled={index === count - 1} onClick={() => onMove(1)}><ArrowDown className="h-4 w-4" aria-hidden="true" /></Button>
      {onDuplicate && <Button type="button" size="sm" variant="ghost" onClick={onDuplicate} aria-label={`Duplicar ${label}`}><Copy className="h-4 w-4" aria-hidden="true" /> Duplicar</Button>}
      <Button type="button" size="sm" variant="ghost" aria-label={`Quitar ${label}`} onClick={onRemove}><Trash2 className="h-4 w-4" aria-hidden="true" /></Button>
    </div>
  );
}

export default BlockForm;
