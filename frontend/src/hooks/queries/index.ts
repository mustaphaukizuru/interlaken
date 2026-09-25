/**
 * Admin hooks layer (Data Ops round, C6). Import the concrete module for the
 * entity you work with (`@/hooks/queries/payments`), or the factories to bind
 * a new one.
 */
export { adminKeys, invalidateEntity, type AdminEntity } from './keys';
export { useAdminList, createListHook, useAdminSummary, useBulk, useExport, useImport, importApiFor } from './dataOpsHooks';
