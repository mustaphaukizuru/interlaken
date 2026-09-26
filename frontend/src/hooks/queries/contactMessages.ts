import { useMutation, useQueryClient } from '@tanstack/react-query';
import { coreApi, type ContactMessage } from '@/services/api';
import type { BulkRequest, BulkResult } from '@/services/dataOps';
import { createListHook, useBulk, useExport } from './dataOpsHooks';
import { invalidateEntity } from './keys';

/** Entity name for query keys and invalidation. */
export const CONTACT_ENTITY = 'contact-messages';

export interface ContactMessagesListParams {
  page?: number;
  q?: string;
  /** `1` atendidos, `0` pendientes, absent = todos. */
  handled?: string;
  from?: string;
  to?: string;
  ordering?: string;
}

/** Ordering keys whitelisted by `/core/admin/contact-messages/` (docs/API-LISTING.md). */
export const CONTACT_ORDERING_KEYS = ['date', 'name', 'email', 'subject', 'handled'] as const;

export const useContactMessagesList = createListHook<ContactMessage, ContactMessagesListParams>(
  CONTACT_ENTITY,
  coreApi.getContactMessages,
);

export const useContactMessagesExport = () => useExport(CONTACT_ENTITY, coreApi.exportContactMessages);

/** `mark_handled` / `reopen`; a committed run also refreshes the sidebar badges. */
export function useContactMessagesBulk() {
  const qc = useQueryClient();
  const bulk = useBulk(CONTACT_ENTITY, coreApi.bulkContactMessages);
  const run = async (body: BulkRequest): Promise<BulkResult> => {
    const result = await bulk.mutateAsync(body);
    if (!body.dry_run) void qc.invalidateQueries({ queryKey: ['badges'] });
    return result;
  };
  return { run, isPending: bulk.isPending };
}

/** Single-row toggle (audited server-side). */
export function useSetContactHandled() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, is_handled }: { id: number; is_handled: boolean }) => coreApi.setContactHandled(id, is_handled),
    onSuccess: () => {
      void invalidateEntity(qc, CONTACT_ENTITY);
      void qc.invalidateQueries({ queryKey: ['badges'] });
    },
  });
}
