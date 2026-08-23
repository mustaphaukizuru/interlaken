import { blockSpec, type Block } from '../blocks/registry';
import type { CmsPageAdmin } from '@/services/api';

export const newBlockId = () => `b_${Math.random().toString(36).slice(2, 10)}`;

/** A fresh block with empty props shaped by the registry, so forms render controlled inputs. */
export function newBlock(type: string): Block {
  const spec = blockSpec(type);
  const props: Record<string, unknown> = {};
  for (const f of spec?.fields ?? []) {
    if (f.kind === 'items' || f.kind === 'images') props[f.key] = [];
    else if (f.kind === 'link') props[f.key] = { label: '', href: '' };
    else if (f.kind !== 'image' && f.kind !== 'number') props[f.key] = '';
  }
  return { id: newBlockId(), type, props };
}

export function moveBlock(list: Block[], from: number, to: number): Block[] {
  if (to < 0 || to >= list.length || from === to) return list;
  const next = list.slice();
  const [b] = next.splice(from, 1);
  next.splice(to, 0, b);
  return next;
}

/** CMS pages live under /admin for Dirección and under /staff for Comunicación (P3-10). */
export const cmsBase = (role: string | undefined) => (role === 'staff' ? '/staff/contenido' : '/admin/contenido');

/** ISO datetime → value for <input type="datetime-local"> (local time). */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const slugify = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);

export function pageStatusLabel(p: Pick<CmsPageAdmin, 'status' | 'has_unpublished_changes'> & { review_requested_at?: string | null }): { label: string; tone: 'success' | 'warning' | 'neutral' | 'info' } {
  if (p.review_requested_at) return { label: 'Pendiente de aprobación', tone: 'info' };
  if (p.status !== 'published') return { label: 'Borrador', tone: 'neutral' };
  if (p.has_unpublished_changes) return { label: 'Publicada · cambios sin publicar', tone: 'warning' };
  return { label: 'Publicada', tone: 'success' };
}

/** DRF error payload → flat {field: message}. Empty object when not a field error. */
export function apiErrors(err: unknown): Record<string, string> {
  const data = (err as { response?: { data?: unknown } })?.response?.data;
  if (!data || typeof data !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(data as Record<string, unknown>)) out[k] = Array.isArray(v) ? String(v[0]) : String(v);
  return out;
}

/** Block-level diff between two block lists (CMS versions, BACKLOG P3-4 extra). */
export interface BlockDiffLine { kind: 'added' | 'removed' | 'changed' | 'same' | 'moved'; type: string; id: string; summary: string }
const summarize = (b: Block): string => {
  const p = b.props;
  const t = (p.title ?? p.label ?? p.html ?? p.text ?? p.url ?? '') as string;
  return String(t).replace(/<[^>]+>/g, '').slice(0, 60);
};
export function diffBlocks(before: Block[], after: Block[]): BlockDiffLine[] {
  const beforeById = new Map(before.map((b, i) => [b.id, { b, i }]));
  const afterIds = new Set(after.map((b) => b.id));
  const lines: BlockDiffLine[] = [];
  after.forEach((b, i) => {
    const prev = beforeById.get(b.id);
    if (!prev) { lines.push({ kind: 'added', type: b.type, id: b.id, summary: summarize(b) }); return; }
    const changed = JSON.stringify(prev.b.props) !== JSON.stringify(b.props) || prev.b.type !== b.type;
    const moved = prev.i !== i;
    lines.push({ kind: changed ? 'changed' : moved ? 'moved' : 'same', type: b.type, id: b.id, summary: summarize(b) });
  });
  before.forEach((b) => { if (!afterIds.has(b.id)) lines.push({ kind: 'removed', type: b.type, id: b.id, summary: summarize(b) }); });
  return lines;
}
