import type { QueryClient } from '@tanstack/react-query';

/**
 * Query-key vocabulary for the admin console (Data Ops round, C6).
 *
 *   ['admin', <entity>]                       everything about one entity
 *   ['admin', <entity>, 'list', <params>]     one page of a list
 *   ['admin', <entity>, 'detail', <id>]       one record
 *   ['admin', <entity>, 'summary', <params>]  aggregates (cards, series)
 *
 * Invalidation always targets the entity prefix, so a bulk action or an import
 * refreshes every open list, detail and summary of that entity at once.
 */
export type AdminEntity = string;

export const adminKeys = {
  all: ['admin'] as const,
  entity: (entity: AdminEntity) => ['admin', entity] as const,
  list: (entity: AdminEntity, params: unknown) => ['admin', entity, 'list', params] as const,
  detail: (entity: AdminEntity, id: string | number) => ['admin', entity, 'detail', id] as const,
  summary: (entity: AdminEntity, params: unknown = null) => ['admin', entity, 'summary', params] as const,
};

/** Refetch every query of `entity` (and of any `related` entities it touches). */
export function invalidateEntity(qc: QueryClient, entity: AdminEntity, related: AdminEntity[] = []) {
  return Promise.all([entity, ...related].map((e) => qc.invalidateQueries({ queryKey: adminKeys.entity(e) })));
}
