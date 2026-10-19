import { Wallet } from 'lucide-react';
import type { BulkActionDef } from '@/services/dataOps';

/** Bulk «Aplicar» for paid card top-ups already typed into the POS (backend `apply_paid`). */
export const APPLY_PAID_ACTION: BulkActionDef = {
  name: 'apply_paid',
  label: 'Aplicar (ya cargadas en POS)',
  planVerb: 'Se aplicarán al saldo, si Loyverse ya las muestra,',
  icon: Wallet,
};
