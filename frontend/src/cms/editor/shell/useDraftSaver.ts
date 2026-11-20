import { useCallback, useEffect, useRef, useState } from 'react';
import type { CmsPageAdmin } from '@/services/api';
import { apiErrorStatus, apiFieldErrors } from '@/lib/apiErrors';
import { blockErrorsFrom, draftConflictFrom, type BlockFieldError, type DraftConflict } from './contracts';

export type SaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error' | 'conflict';

export interface SaveFailure {
  message: string;
  fields: Record<string, string>;
  /** Contract C3, when the backend sends it. */
  blockErrors: BlockFieldError[];
}

interface Options {
  /** PATCH body for the current editor state (draft_revision is added here). */
  buildBody: () => Partial<CmsPageAdmin>;
  send: (body: Partial<CmsPageAdmin>) => Promise<{ data: CmsPageAdmin }>;
  onSaved: (page: CmsPageAdmin) => void;
  onConflict?: (conflict: DraftConflict) => void;
  onFailure?: (failure: SaveFailure) => void;
  /** Autosave delay after the last change. */
  delay?: number;
}

/**
 * Autosave of the page draft (docs/cms/editor-shell.md):
 *
 * - one request at a time; edits made while a save is in flight are saved
 *   right after it (they used to be marked as saved and lost);
 * - contract C2: sends the `draft_revision` it started from and keeps the
 *   one the server returns; a 409 `draft_conflict` pauses autosave and keeps
 *   every local edit until the person picks «recargar» or «sobrescribir»;
 * - when the backend has no `draft_revision`, nothing is sent: today's
 *   last-save-wins behaviour.
 */
export function useDraftSaver(options: Options) {
  const latest = useRef(options);
  useEffect(() => { latest.current = options; });
  const delay = options.delay ?? 1500;

  const [status, setStatus] = useState<SaveStatus>('idle');
  const [dirty, setDirty] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [failure, setFailure] = useState<SaveFailure | null>(null);
  const [conflict, setConflict] = useState<DraftConflict | null>(null);

  const revision = useRef<number | undefined>(undefined);
  const seq = useRef(0);
  const savedSeq = useRef(0);
  const generation = useRef(0);
  const conflictRef = useRef<DraftConflict | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const running = useRef<Promise<boolean> | null>(null);
  const flushRef = useRef<() => Promise<boolean>>(async () => true);

  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const schedule = useCallback(() => {
    clearTimer();
    timer.current = setTimeout(() => { void flushRef.current(); }, delay);
  }, [delay]);

  const flush = useCallback(async (): Promise<boolean> => {
    clearTimer();
    while (running.current) await running.current;
    if (conflictRef.current) return false;
    if (seq.current === savedSeq.current) return true;
    const gen = generation.current;
    const target = seq.current;
    const body: Partial<CmsPageAdmin> = { ...latest.current.buildBody() };
    if (revision.current !== undefined) body.draft_revision = revision.current;
    setStatus('saving');
    const attempt = (async () => {
      try {
        const { data } = await latest.current.send(body);
        if (gen !== generation.current) return true;
        if (typeof data?.draft_revision === 'number') revision.current = data.draft_revision;
        savedSeq.current = target;
        setFailure(null);
        setLastSavedAt(Date.now());
        const clean = seq.current === target;
        setDirty(!clean);
        setStatus(clean ? 'saved' : 'pending');
        if (!clean) schedule();
        latest.current.onSaved(data);
        return true;
      } catch (err) {
        if (gen !== generation.current) return false;
        const c = draftConflictFrom(err);
        if (c) {
          conflictRef.current = c;
          setConflict(c);
          setStatus('conflict');
          latest.current.onConflict?.(c);
          return false;
        }
        const fields = apiFieldErrors(err);
        const offline = apiErrorStatus(err) === undefined;
        const f: SaveFailure = {
          message: fields.detail || fields.blocks || fields.draft_blocks || fields.title || fields.slug
            || (offline ? 'Sin conexión con el servidor.' : 'No se pudo guardar el borrador.'),
          fields,
          blockErrors: blockErrorsFrom(err),
        };
        setFailure(f);
        setStatus('error');
        latest.current.onFailure?.(f);
        return false;
      }
    })();
    running.current = attempt;
    try {
      return await attempt;
    } finally {
      if (running.current === attempt) running.current = null;
    }
  }, [schedule]);
  useEffect(() => { flushRef.current = flush; }, [flush]);

  /** A local edit: autosave after `delay` (paused while a conflict is open). */
  const touch = useCallback(() => {
    seq.current += 1;
    setDirty(true);
    if (conflictRef.current) return;
    setStatus((s) => (s === 'saving' ? s : 'pending'));
    schedule();
  }, [schedule]);

  /** The editor (re)loaded `page` from the server: start clean from its revision. */
  const reset = useCallback((page: Pick<CmsPageAdmin, 'draft_revision'>) => {
    clearTimer();
    generation.current += 1;
    running.current = null;
    revision.current = typeof page.draft_revision === 'number' ? page.draft_revision : undefined;
    seq.current = 0;
    savedSeq.current = 0;
    conflictRef.current = null;
    setConflict(null);
    setFailure(null);
    setDirty(false);
    setStatus('idle');
    setLastSavedAt(null);
  }, []);

  /** C2 «Conservar los míos»: resend the local draft over the newer revision. */
  const overwrite = useCallback(async () => {
    const c = conflictRef.current;
    if (!c) return flushRef.current();
    revision.current = c.revision;
    conflictRef.current = null;
    setConflict(null);
    if (seq.current === savedSeq.current) seq.current += 1;
    return flushRef.current();
  }, []);

  // Leaving the editor in-app with a pending save: send it anyway.
  useEffect(() => () => {
    clearTimer();
    if (!conflictRef.current && seq.current !== savedSeq.current && !running.current) void flushRef.current();
  }, []);

  return { status, dirty, lastSavedAt, failure, conflict, touch, flush, reset, overwrite, revision };
}

export type DraftSaver = ReturnType<typeof useDraftSaver>;
