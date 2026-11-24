import { lazy, Suspense, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { portalApi, type SiteNotice } from '@/services/api';

// The aviso's markup loads only when there is one to show (most visits: none).
const SiteNoticeView = lazy(() => import('./SiteNoticeView'));

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
  return <Suspense fallback={null}><SiteNoticeView notice={n} onDismiss={dismiss} /></Suspense>;
}

export default SiteNoticeBanner;
