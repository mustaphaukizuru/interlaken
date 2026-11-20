import { useEffect, useState } from 'react';
import { History, RefreshCw, Save, Users } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import type { DraftConflict } from './contracts';
import type { LocalCopy } from './localCopy';
import { timeAgo } from './status';

/**
 * Contract C2: someone else saved this page after it was opened here.
 * Autosave is paused and the local edits stay on screen until the person
 * chooses; «recargar» keeps a copy of them in this browser first.
 */
export function ConflictBanner({ conflict, onReload, onOverwrite, busy }: {
  conflict: DraftConflict;
  onReload: () => void;
  onOverwrite: () => void;
  busy?: 'reload' | 'overwrite' | null;
}) {
  const who = conflict.by || 'Otra persona';
  const when = conflict.at ? ` ${timeAgo(conflict.at)}` : '';
  return (
    <div role="alert" className="flex flex-col gap-3 rounded-xl border border-amber/40 bg-amber/10 p-3 text-sm md:flex-row md:items-center md:justify-between">
      <div className="flex items-start gap-2">
        <Users size={18} className="mt-0.5 shrink-0 text-amber" aria-hidden="true" />
        <div>
          <p className="font-semibold text-ink">{who} guardó cambios en esta página{when}.</p>
          <p className="text-muted">Para no borrar el trabajo de nadie, el guardado automático está en pausa. Sus cambios siguen aquí.</p>
        </div>
      </div>
      <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
        <Button variant="secondary" size="md" onClick={onReload} loading={busy === 'reload'} disabled={!!busy}>
          <RefreshCw size={16} aria-hidden="true" /> Ver sus cambios (recargar)
        </Button>
        <Button variant="primary" size="md" onClick={onOverwrite} loading={busy === 'overwrite'} disabled={!!busy}>
          <Save size={16} aria-hidden="true" /> Conservar los míos (sobrescribir)
        </Button>
      </div>
    </div>
  );
}

/** A copy of unsaved edits from an earlier visit (conflict, failed save, leaving). */
export function LocalCopyBanner({ copy, onRestore, onDiscard }: { copy: LocalCopy; onRestore: () => void; onDiscard: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);
  return (
    <div role="status" className="flex flex-col gap-3 rounded-xl border border-line bg-white p-3 text-sm md:flex-row md:items-center md:justify-between">
      <div className="flex items-start gap-2">
        <History size={18} className="mt-0.5 shrink-0 text-purple" aria-hidden="true" />
        <p className="text-ink">Este navegador guardó una copia de cambios suyos que no llegaron al servidor ({timeAgo(copy.savedAt, now)}).</p>
      </div>
      <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
        <Button variant="ghost" size="md" onClick={onDiscard}>Descartar la copia</Button>
        <Button variant="secondary" size="md" onClick={onRestore}>Recuperar mis cambios</Button>
      </div>
    </div>
  );
}
