import { useLayoutEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Megaphone, X } from 'lucide-react';
import type { SiteNotice } from '@/services/api';

/**
 * The aviso itself (SiteNoticeBanner loads it only when there is one, so a
 * visit without avisos never downloads it). While it shows, its height is the
 * root's `--site-notice-h`, so the home hero still fits the first screen of a
 * phone (header version 3, 2026-11-23).
 */
export default function SiteNoticeView({ notice: n, onDismiss }: { notice: SiteNotice; onDismiss: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current!;
    const root = document.documentElement.style;
    const set = () => root.setProperty('--site-notice-h', `${el.offsetHeight}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => { ro.disconnect(); root.removeProperty('--site-notice-h'); };
  }, [n.id]);
  const isExternal = n.link.startsWith('http');
  return (
    // Warning status pair (AA: ink body 16:1, amber title/icon/link 4.6:1 on
    // warning-bg). The old solid amber + ink pair was ~3.6:1.
    <div ref={ref} role="status" aria-live="polite" className="bg-warning-bg text-ink print:hidden">
      <div className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-1.5 text-sm sm:gap-3 sm:px-6">
        <Megaphone className="h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
        <p className="line-clamp-2 min-w-0 flex-1 sm:line-clamp-1">
          <strong className="font-semibold text-warning">{n.title}.</strong> {n.body}
        </p>
        {n.link && (isExternal
          ? <a href={n.link} className="shrink-0 whitespace-nowrap font-semibold text-warning underline underline-offset-2" target="_blank" rel="noopener noreferrer">Ver más</a>
          : <Link to={n.link} className="shrink-0 whitespace-nowrap font-semibold text-warning underline underline-offset-2">Ver más</Link>)}
        <button type="button" onClick={onDismiss} aria-label="Cerrar aviso" className="grid h-11 w-11 shrink-0 place-items-center rounded-sm text-warning hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/40"><X className="h-4 w-4" aria-hidden="true" /></button>
      </div>
    </div>
  );
}
