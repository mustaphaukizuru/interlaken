import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { agoLabel } from '@/lib/live';

interface Props {
  /** react-query's dataUpdatedAt for the query this badge describes. */
  updatedAt: number | undefined;
  isFetching: boolean;
  onRefresh: () => void;
  /** A refresh the person asked for is running: the button waits for it. */
  busy?: boolean;
  className?: string;
}

/**
 * "En vivo · hace un momento ↻" next to a balance.
 *
 * Says two things a family needs to trust a number that moves by itself: that
 * the screen refreshes on its own, and how old what they are looking at is.
 * The label re-renders every 30 s so it cannot read "hace un momento" forever.
 */
export function LiveBadge({ updatedAt, isFetching, onRefresh, busy = false, className = '' }: Props) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  const label = agoLabel(updatedAt, now);

  return (
    <span className={`inline-flex items-center gap-1.5 text-xs text-subtle ${className}`}>
      {/* A steady dot: no looping pulse (motion only explains a change). */}
      <span className="inline-flex h-2 w-2 rounded-full bg-green" aria-hidden="true" />
      <span>En vivo{label ? ` · ${label}` : ''}</span>
      {/* 44 px target; the negative margin keeps the line height of the badge. */}
      <button
        type="button"
        onClick={onRefresh}
        disabled={busy}
        aria-busy={busy || undefined}
        aria-label="Actualizar ahora"
        title="Actualizar ahora"
        className="-my-2 inline-flex h-11 w-11 items-center justify-center rounded-sm text-muted hover:bg-cream hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40 disabled:cursor-wait disabled:opacity-60"
      >
        <RefreshCw size={16} className={isFetching ? 'animate-spin' : undefined} aria-hidden="true" />
      </button>
    </span>
  );
}

export default LiveBadge;
