import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Megaphone, X } from 'lucide-react';
import { portalApi, type SiteNotice } from '@/services/api';

const KEY = 'interlaken:dismissed-notices';

function readDismissed(): number[] {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
}

/** Visible notices minus those the visitor dismissed (BACKLOG P3-9). */
export function pickNotices(all: SiteNotice[], dismissed: number[]): SiteNotice[] {
  return all.filter((n) => !dismissed.includes(n.id));
}

/**
 * Public avisos banner above the header: announcements flagged "publicar en
 * el sitio" by Comunicación. Dismissal is per-aviso and per-browser, so a new
 * aviso always shows up again.
 */
export function SiteNoticeBanner() {
  const { data } = useQuery({ queryKey: ['site-notices'], queryFn: async () => (await portalApi.getSiteNotices()).data, staleTime: 120_000, retry: false });
  const [dismissed, setDismissed] = useState<number[]>(readDismissed);
  const notices = pickNotices(data ?? [], dismissed);
  if (notices.length === 0) return null;
  const n = notices[0];
  const dismiss = () => {
    const next = [...dismissed, n.id];
    setDismissed(next);
    try { localStorage.setItem(KEY, JSON.stringify(next.slice(-20))); } catch { /* private mode */ }
  };
  const isExternal = n.link.startsWith('http');
  return (
    <div role="status" aria-live="polite" className="bg-amber text-ink">
      <div className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-1.5 text-sm sm:gap-3 sm:px-6">
        <Megaphone className="h-4 w-4 shrink-0" aria-hidden="true" />
        <p className="line-clamp-2 min-w-0 flex-1 sm:line-clamp-1">
          <strong className="font-semibold">{n.title}.</strong> {n.body}
        </p>
        {n.link && (isExternal
          ? <a href={n.link} className="shrink-0 whitespace-nowrap font-semibold underline underline-offset-2" target="_blank" rel="noopener noreferrer">Ver más</a>
          : <Link to={n.link} className="shrink-0 whitespace-nowrap font-semibold underline underline-offset-2">Ver más</Link>)}
        <button type="button" onClick={dismiss} aria-label="Cerrar aviso" className="grid h-11 w-11 shrink-0 place-items-center rounded-full hover:bg-black/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/40"><X className="h-4 w-4" aria-hidden="true" /></button>
      </div>
    </div>
  );
}

export default SiteNoticeBanner;
