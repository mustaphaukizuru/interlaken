import { useEffect, useState } from 'react';
import { AlertTriangle, Check, Loader2, PauseCircle, PencilLine, RotateCw } from 'lucide-react';
import type { SaveStatus } from './useDraftSaver';
import { timeAgo } from './status';

interface Props {
  status: SaveStatus;
  /** When this session last saved (ms). */
  lastSavedAt: number | null;
  /** When the server copy was last saved, for a draft opened without edits. */
  serverSavedAt?: string | null;
  onRetry: () => void;
  /** Shorter wording for the phone bar. */
  compact?: boolean;
}

/** Re-render every 30 s so «hace 1 min» keeps counting. */
function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

/** Autosave state: «Guardando…», «Guardado hace 1 min», or the error with «Reintentar». */
export function SaveIndicator({ status, lastSavedAt, serverSavedAt, onRetry, compact = false }: Props) {
  const now = useNow();
  const base = 'inline-flex min-w-0 items-center gap-1.5 text-xs';
  if (status === 'error') {
    return (
      <span className={`${base} font-semibold text-coral-700`} role="alert">
        <AlertTriangle size={14} className="shrink-0" aria-hidden="true" />
        <span className="truncate">{compact ? 'No se guardó' : 'No se guardó el borrador'}</span>
        <button type="button" onClick={onRetry} className="inline-flex min-h-[44px] items-center gap-1 rounded-full px-2 font-semibold text-purple underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40">
          <RotateCw size={13} aria-hidden="true" /> Reintentar
        </button>
      </span>
    );
  }
  let icon = <Check size={14} className="shrink-0 text-green-700" aria-hidden="true" />;
  let text: string;
  if (status === 'saving') {
    icon = <Loader2 size={14} className="shrink-0 motion-safe:animate-spin" aria-hidden="true" />;
    text = 'Guardando…';
  } else if (status === 'pending') {
    icon = <PencilLine size={14} className="shrink-0" aria-hidden="true" />;
    text = 'Cambios sin guardar';
  } else if (status === 'conflict') {
    icon = <PauseCircle size={14} className="shrink-0 text-amber" aria-hidden="true" />;
    text = compact ? 'Guardado en pausa' : 'Guardado en pausa: otra persona editó';
  } else if (lastSavedAt) {
    text = `Guardado ${timeAgo(lastSavedAt, now)}`;
  } else if (serverSavedAt) {
    text = `Guardado ${timeAgo(serverSavedAt, now)}`;
  } else {
    text = 'Borrador guardado';
  }
  return (
    <span className={`${base} text-subtle`} aria-live="polite">
      {icon}
      <span className="truncate">{text}</span>
    </span>
  );
}
