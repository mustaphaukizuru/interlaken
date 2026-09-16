import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { agoLabel } from '@/lib/live';

interface Props {
  /** react-query's dataUpdatedAt for the query this badge describes. */
  updatedAt: number | undefined;
  isFetching: boolean;
  onRefresh: () => void;
  className?: string;
}

/**
 * "En vivo · hace un momento ↻" next to a balance.
 *
 * Says two things a family needs to trust a number that moves by itself: that
 * the screen refreshes on its own, and how old what they are looking at is.
 * The label re-renders every 30 s so it cannot read "hace un momento" forever.
 */
export function LiveBadge({ updatedAt, isFetching, onRefresh, className = '' }: Props) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  const label = agoLabel(updatedAt, now);

  return (
    <span className={`inline-flex items-center gap-1.5 text-[12px] text-subtle ${className}`}>
      <span className="relative flex h-2 w-2" aria-hidden="true">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green opacity-60 motion-reduce:animate-none" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-green" />
      </span>
      <span>En vivo{label ? ` · ${label}` : ''}</span>
      <button
        type="button"
        onClick={onRefresh}
        aria-label="Actualizar ahora"
        title="Actualizar ahora"
        className="inline-flex h-7 w-7 items-center justify-center rounded-full text-muted hover:bg-cream hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40"
      >
        <RefreshCw size={13} className={isFetching ? 'animate-spin' : undefined} aria-hidden="true" />
      </button>
    </span>
  );
}

export default LiveBadge;
