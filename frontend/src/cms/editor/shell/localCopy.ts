import type { Block } from '../../blocks/registry';
import type { CmsPageAdmin } from '@/services/api';

/**
 * A copy of the local draft kept in this browser while it could not be saved
 * (a C2 conflict, a failed save, leaving with unsaved edits), so a person's
 * edits are never lost silently. The editor offers it back on the next visit.
 */
export interface LocalCopy {
  blocks: Block[];
  title?: string;
  seo?: CmsPageAdmin['seo'];
  savedAt: number;
}

const key = (pageId: number) => `cms-local-copy:${pageId}`;

export function writeLocalCopy(pageId: number, copy: Omit<LocalCopy, 'savedAt'>): void {
  try {
    localStorage.setItem(key(pageId), JSON.stringify({ ...copy, savedAt: Date.now() }));
  } catch {
    /* private mode or full storage: the copy lives only in memory */
  }
}

export function readLocalCopy(pageId: number): LocalCopy | null {
  try {
    const v = JSON.parse(localStorage.getItem(key(pageId)) ?? 'null') as LocalCopy | null;
    return v && Array.isArray(v.blocks) && typeof v.savedAt === 'number' ? v : null;
  } catch {
    return null;
  }
}

export function clearLocalCopy(pageId: number): void {
  try {
    localStorage.removeItem(key(pageId));
  } catch {
    /* nothing stored */
  }
}
