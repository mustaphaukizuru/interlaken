import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Bell, CalendarDays, Coffee, FileText, Megaphone, Receipt, Sparkles } from 'lucide-react';
import { SectionCard, SectionEmpty } from '@/components/ui/SectionCard';
import { portalApi, type NovedadItem } from '@/services/api';
import { formatDateTime } from '@/lib/format';

const KEY = 'interlaken:novedades-seen';
const ICON: Record<string, typeof Bell> = { comunicado: Megaphone, evento: CalendarDays, cafeteria: Coffee, pago: Receipt, sitio: FileText };

export function readSeen(): string | null {
  try { return localStorage.getItem(KEY); } catch { return null; }
}
export function writeSeen(iso: string) {
  try { localStorage.setItem(KEY, iso); } catch { /* private mode */ }
}

/** "What's new since your last visit" (BACKLOG P4-11). `since` = last time this panel was shown. */
export function NovedadesPanel({ className = '' }: { className?: string }) {
  const [since] = useState<string | null>(readSeen);
  const { data, isLoading } = useQuery({ queryKey: ['novedades', since], queryFn: async () => (await portalApi.novedades(since ?? undefined)).data, staleTime: 60_000 });
  useEffect(() => { if (data) writeSeen(new Date().toISOString()); }, [data]);
  const items: NovedadItem[] = data?.items ?? [];
  return (
    <SectionCard title={`Novedades${data?.unread ? ` (${data.unread})` : ''}`} className={className}>
      {isLoading ? <div className="skeleton h-24" aria-hidden="true" /> : items.length === 0 ? (
        <SectionEmpty icon={Sparkles}>Nada nuevo desde su última visita</SectionEmpty>
      ) : (
        <ul className="divide-y divide-line" aria-label="Novedades">
          {items.slice(0, 8).map((it, i) => {
            const Icon = ICON[it.type] ?? Bell;
            return (
              <li key={i}>
                <Link to={it.link} className="flex items-start gap-3 py-2.5 hover:bg-cream-2 -mx-2 px-2 rounded-lg">
                  <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${it.unread ? 'bg-purple/10 text-purple' : 'bg-cream-2 text-subtle'}`}><Icon size={14} aria-hidden="true" /></span>
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate text-sm ${it.unread ? 'font-semibold text-ink' : 'text-ink'}`}>{it.title}</span>
                    {it.text && <span className="block truncate text-xs text-muted">{it.text}</span>}
                    <span className="block text-[11px] text-subtle">{formatDateTime(it.at)}</span>
                  </span>
                  {it.unread && <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-pink" aria-label="Nuevo" />}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}

export default NovedadesPanel;
