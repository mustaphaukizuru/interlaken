import type { ImportRowAction } from '@/services/dataOps';

export type BadgeVariant = 'success' | 'warning' | 'error' | 'info' | 'neutral';

/** Dry-run row outcome → chip label + variant (ImportDialog, summaries, bitácora). */
export const IMPORT_ACTION_META: Record<ImportRowAction, { label: string; variant: BadgeVariant }> = {
  crear: { label: 'Crear', variant: 'success' },
  actualizar: { label: 'Actualizar', variant: 'info' },
  omitir: { label: 'Omitir', variant: 'neutral' },
  error: { label: 'Error', variant: 'error' },
};

export const IMPORT_ACTIONS: ImportRowAction[] = ['crear', 'actualizar', 'omitir', 'error'];
