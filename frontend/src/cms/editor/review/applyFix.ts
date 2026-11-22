import type { Block } from '../../blocks/registry';
import type { CmsPageAdmin } from '@/services/api';
import type { ReviewIssue } from './types';

type Seo = CmsPageAdmin['seo'];

const clone = <T,>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));

/** `obj` with `value` at `path` (`items.2.title`), copied along the way; lists keep their other items. */
export function setAtPath(obj: Record<string, unknown>, path: string, value: unknown): Record<string, unknown> {
  const parts = path.split('.').filter(Boolean);
  if (!parts.length) return obj;
  const [head, ...rest] = parts;
  const copy: Record<string, unknown> | unknown[] = Array.isArray(obj) ? [...obj] : { ...obj };
  const key: string | number = Array.isArray(copy) ? Number(head) : head;
  const current = (copy as Record<string | number, unknown>)[key];
  const next = rest.length
    ? setAtPath((current && typeof current === 'object' ? current : /^\d+$/.test(rest[0]) ? [] : {}) as Record<string, unknown>, rest.join('.'), value)
    : clone(value);
  (copy as Record<string | number, unknown>)[key] = next;
  return copy as Record<string, unknown>;
}

/** The section an issue is about: by id, else by its number in the list. */
export function issueBlock(blocks: Block[], issue: Pick<ReviewIssue, 'block_id' | 'block_index'>): Block | undefined {
  return (issue.block_id ? blocks.find((b) => b.id === issue.block_id) : undefined)
    ?? (typeof issue.block_index === 'number' ? blocks[issue.block_index] : undefined);
}

export const isSeoField = (field: string) => field.startsWith('seo.');

/**
 * The draft with an issue's quick fix applied (the backend sends the field's
 * new value), or null when the issue has none or its section is gone.
 */
export function applyFix(blocks: Block[], seo: Seo, issue: ReviewIssue): { blocks?: Block[]; seo?: Seo } | null {
  const fix = issue.fix;
  if (!fix) return null;
  if (isSeoField(issue.field)) {
    const name = issue.field.slice(4) as keyof Seo;
    return { seo: { ...seo, [name]: clone(fix.value) as never } };
  }
  const target = issueBlock(blocks, issue);
  if (!target) return null;
  if (fix.kind === 'show_section') return { blocks: blocks.map((b) => (b === target ? { ...b, hidden: false } : b)) };
  if (!issue.field) return null;
  const props = setAtPath(target.props ?? {}, issue.field, fix.value);
  return { blocks: blocks.map((b) => (b === target ? { ...b, props } : b)) };
}
