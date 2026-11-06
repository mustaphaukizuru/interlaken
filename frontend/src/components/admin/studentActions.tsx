import { RotateCcw, Trash2, UserMinus } from 'lucide-react';
import type { BulkActionDef, BulkResult } from '@/services/api';

/**
 * What the office does to a student's place on the platform, shared by the
 * roster (one row or a selection) and the student file. All three go through
 * BulkConfirmDialog, so each one previews who is affected before it runs.
 */
export const WITHDRAW_ACTION: BulkActionDef = {
  key: 'withdraw',
  name: 'status',
  label: 'Dar de baja',
  icon: UserMinus,
  danger: true,
  planVerb: 'Se darán de baja',
  payload: { value: 'withdrawn' },
};

export const REACTIVATE_ACTION: BulkActionDef = {
  key: 'reactivate',
  name: 'status',
  label: 'Reactivar',
  icon: RotateCcw,
  planVerb: 'Se reactivarán',
  payload: { value: 'active' },
};

export const DELETE_ACTION: BulkActionDef = {
  key: 'delete',
  name: 'delete',
  label: 'Eliminar definitivamente',
  icon: Trash2,
  danger: true,
  planVerb: 'Se eliminarán para siempre',
  requireText: 'ELIMINAR',
};

/** The next step for whoever a plan could not include, or for what a baja keeps. */
export function studentPlanNote(action: BulkActionDef | null | undefined) {
  if (action?.key === 'withdraw') {
    return () => <p className="text-xs">No se borra nada: el alumno ya no entra al portal, pasa a «Baja definitiva» y se puede reactivar.</p>;
  }
  if (action?.key === 'delete') {
    return (plan: BulkResult) => (plan.skipped.length > 0
      ? <p className="text-xs">A quienes se omiten use «Dar de baja»: quedan archivados y se pueden reactivar.</p>
      : null);
  }
  return undefined;
}
