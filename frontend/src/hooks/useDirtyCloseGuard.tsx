import { useEffect, useState } from 'react';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

/**
 * Deep comparison for form values (plain objects, arrays, primitives; key
 * order ignored). A field typed and then put back the way it was is not a
 * change, so «dirty» means the values differ, not that a field was touched.
 */
export function valuesDiffer(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return false;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return true;
  if (Array.isArray(a) !== Array.isArray(b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length !== b.length || a.some((v, i) => valuesDiffer(v, b[i]));
  }
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return true;
  return ka.some((k) => valuesDiffer((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

/**
 * A form in a Modal or drawer asks before it closes with unsaved changes.
 * Pass `requestClose` wherever the person can close it (the Modal's
 * `onClose`, so X, Escape and the backdrop; the «Cancelar» button) and render
 * `dialog` next to the Modal (a sibling, not inside it). After a successful
 * save call the plain `onClose` instead, which never asks.
 *
 * `dirty` is either given here (the form state lives next to the Modal) or
 * reported by the form inside it through `reportDirty` and `useReportDirty`.
 */
export function useDirtyCloseGuard(onClose: () => void, dirty?: boolean) {
  const [reported, setReported] = useState(false);
  const [asking, setAsking] = useState(false);
  const isDirty = dirty ?? reported;

  const requestClose = () => {
    if (isDirty) setAsking(true);
    else onClose();
  };
  const discard = () => {
    setAsking(false);
    setReported(false);
    onClose();
  };

  const dialog = (
    <ConfirmDialog
      open={asking}
      title="¿Descartar los cambios?"
      message="Tiene cambios sin guardar. Si cierra ahora, se perderán."
      confirmLabel="Descartar cambios"
      cancelLabel="Seguir editando"
      onConfirm={discard}
      onClose={() => setAsking(false)}
    />
  );

  return { dirty: isDirty, requestClose, reportDirty: setReported, dialog };
}

/**
 * For the form rendered inside a guarded Modal: tells the guard whether it
 * holds unsaved changes, and forgets them when the form unmounts (the Modal
 * closed, or the form was re-keyed for another record).
 */
export function useReportDirty(dirty: boolean, report?: (dirty: boolean) => void) {
  useEffect(() => {
    report?.(dirty);
  }, [dirty, report]);
  useEffect(() => () => report?.(false), [report]);
}
