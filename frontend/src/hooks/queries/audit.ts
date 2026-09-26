import { coreApi } from '@/services/api';
import type { AuditLogEntry } from '@/types';
import { createListHook, useExport } from './dataOpsHooks';

/** Entity name for query keys and invalidation. */
export const AUDIT_ENTITY = 'audit';

export interface AuditListParams {
  page?: number;
  ordering?: string;
  q?: string;
  actor?: string;
  action?: string;
  context?: string;
  object_type?: string;
  object_id?: string | number;
  from?: string;
  to?: string;
}

/** Ordering keys the backend whitelists for `/core/admin/audit/` (docs/API-LISTING.md). */
export const AUDIT_ORDERING_KEYS = ['date', 'actor', 'action', 'object', 'context'] as const;

export const useAuditList = createListHook<AuditLogEntry, AuditListParams>(AUDIT_ENTITY, coreApi.getAuditLog);

export const useAuditExport = () => useExport(AUDIT_ENTITY, coreApi.exportAuditLog);
