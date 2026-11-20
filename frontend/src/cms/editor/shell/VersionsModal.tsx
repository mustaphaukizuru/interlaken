import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { ErrorState } from '@/components/ui/ErrorState';
import { contentApi, type CmsPageAdmin } from '@/services/api';
import { apiFieldErrors } from '@/lib/apiErrors';
import type { Block } from '../../blocks/registry';
import { diffBlocks } from '../helpers';

/** Published versions with a block diff against the draft, and «Restaurar» into the draft (admin only). */
export function VersionsModal({ open, pageId, current, onClose, onRestored }: { open: boolean; pageId: number; current: Block[]; onClose: () => void; onRestored: (page: CmsPageAdmin) => void }) {
  const [diffOf, setDiffOf] = useState<number | null>(null);
  const [toRestore, setToRestore] = useState<number | null>(null);
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['admin-page-versions', pageId], queryFn: async () => (await contentApi.adminPageVersions(pageId)).data, enabled: open });
  const rollback = useMutation({
    mutationFn: (version: number) => contentApi.adminRollbackPage(pageId, version),
    onSuccess: (res) => {
      toast.success(`Versión ${res.data.restored_from} restaurada en el borrador. El sitio no cambia hasta que la publique.`);
      setToRestore(null);
      onRestored(res.data.page);
    },
    onError: (e) => { setToRestore(null); toast.error(apiFieldErrors(e).detail || 'No se pudo restaurar.'); },
  });
  return (
    <Modal open={open} onClose={onClose} title="Versiones publicadas" maxWidth={480}>
      {isError ? (
        <ErrorState title="No se pudieron cargar las versiones" onRetry={() => refetch()} />
      ) : isLoading ? (
        <div className="flex justify-center py-6"><LoadingSpinner /></div>
      ) : (data ?? []).length === 0 ? <p className="text-sm text-muted">Esta página aún no se ha publicado.</p> : (
        <ul className="divide-y divide-line" aria-label="Versiones">
          {(data ?? []).map((v) => (
            <li key={v.id} className="py-2 text-sm">
              <div className="flex items-center justify-between gap-3">
                <div><span className="font-semibold text-ink">Versión {v.number}</span><p className="text-xs text-subtle">{v.author_name} · {new Date(v.created_at).toLocaleString('es-MX')}</p></div>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => setDiffOf(diffOf === v.number ? null : v.number)}>{diffOf === v.number ? 'Ocultar cambios' : 'Ver cambios'}</Button>
                  <Button size="sm" variant="secondary" onClick={() => setToRestore(v.number)}>Restaurar</Button>
                </div>
              </div>
              {diffOf === v.number && <VersionDiff lines={diffBlocks(v.blocks ?? [], current)} number={v.number} />}
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={toRestore !== null}
        title={`¿Restaurar la versión ${toRestore ?? ''} en el borrador?`}
        message="El borrador actual (incluidos los cambios sin publicar) se reemplaza por esta versión. El sitio público no cambia hasta que publique."
        confirmLabel="Restaurar en el borrador"
        loading={rollback.isPending}
        onConfirm={() => toRestore !== null && rollback.mutate(toRestore)}
        onClose={() => setToRestore(null)}
      />
    </Modal>
  );
}

const DIFF_LABEL: Record<string, string> = { added: '+ Nuevo', removed: '− Eliminado', changed: '± Modificado', moved: '↕ Movido', same: '' };
function VersionDiff({ lines, number }: { lines: ReturnType<typeof diffBlocks>; number: number }) {
  const changes = lines.filter((l) => l.kind !== 'same');
  return (
    <ul className="mt-2 space-y-0.5 rounded-lg bg-cream-2 p-2 text-xs" aria-label={`Cambios del borrador respecto a la versión ${number}`}>
      {changes.length === 0 && <li className="text-muted">El borrador es idéntico a esta versión.</li>}
      {changes.map((l) => (
        <li key={`${l.kind}-${l.id}`} className={l.kind === 'added' ? 'text-green-700' : l.kind === 'removed' ? 'text-coral-600' : 'text-ink'}>
          {DIFF_LABEL[l.kind]} {l.type}{l.summary ? `: ${l.summary}` : ''}
        </li>
      ))}
    </ul>
  );
}
