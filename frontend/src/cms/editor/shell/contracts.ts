import { apiErrorCode, apiErrorStatus } from '@/lib/apiErrors';
import { editorName } from './status';

/**
 * Error bodies of the CMS contracts the editor shell consumes
 * (docs/cms/editor-shell.md). The backend side lives in the «safe» branch;
 * every reader here tolerates the field or code being absent.
 */
function body(err: unknown): Record<string, unknown> {
  const data = (err as { response?: { data?: unknown } } | undefined)?.response?.data;
  return data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
}

/** C1: HTTP 409 `{"code":"legacy_seed_draft","detail":"…"}` on publish without `confirm_legacy`. */
export function isLegacySeedRefusal(err: unknown): boolean {
  return apiErrorStatus(err) === 409 && apiErrorCode(err) === 'legacy_seed_draft';
}

export interface DraftConflict {
  revision: number;
  by: string;
  at: string | null;
}

/** C2: HTTP 409 `{"code":"draft_conflict","draft_revision":n,"draft_updated_by":"…","draft_updated_at":"…"}`. */
export function draftConflictFrom(err: unknown): DraftConflict | null {
  if (apiErrorStatus(err) !== 409 || apiErrorCode(err) !== 'draft_conflict') return null;
  const b = body(err);
  const revision = Number(b.draft_revision);
  return {
    revision: Number.isFinite(revision) ? revision : 0,
    by: editorName(b.draft_updated_by),
    at: typeof b.draft_updated_at === 'string' ? b.draft_updated_at : null,
  };
}

/** C3 (owned by the «fields» branch): one problem in one field of one block. */
export interface BlockFieldError {
  block_index?: number;
  block_id?: string;
  block_label?: string;
  field?: string;
  field_label?: string;
  message: string;
}

/** C3 `errors: [...]` of a 400, if the backend sends them. */
export function blockErrorsFrom(err: unknown): BlockFieldError[] {
  const list = body(err).errors;
  return Array.isArray(list) ? list.filter((e): e is BlockFieldError => !!e && typeof e === 'object' && typeof (e as BlockFieldError).message === 'string') : [];
}
