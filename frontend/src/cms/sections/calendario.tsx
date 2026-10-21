/**
 * Calendario (/calendario): designed sections (docs/CMS-COMPLETION-PLAN.md).
 * The hero is the shared page.hero; the level filter and the events list are
 * a locked section whose dates come from the Calendario admin screen.
 */
import './page';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays } from 'lucide-react';
import { Section } from '@/components/ui/Section';
import { Reveal } from '@/components/ui/Reveal';
import { EmptyState } from '@/components/ui/EmptyState';
import { ListSkeleton } from '@/components/ui/ListSkeleton';
import { contentApi, type SchoolEvent } from '@/services/api';
import { CURRENT_CYCLE } from '@/lib/siteMeta';
import { useTokens } from '../runtime';
import { defineModule, f, sectionsOf } from './kit';

const section = sectionsOf('calendario');

const KIND_COLOR: Record<string, string> = {
  holiday: 'bg-coral/10 text-coral-dark', vacation: 'bg-amber/10 text-amber', exam: 'bg-purple/10 text-purple',
  event: 'bg-green/10 text-green-dark', meeting: 'bg-pink/10 text-pink-dark', deadline: 'bg-ink/10 text-ink',
};
const LEVELS = [['', 'Todos los niveles'], ['preescolar', 'Preescolar'], ['primaria', 'Primaria'], ['secundaria', 'Secundaria']] as const;

function cycleRange(): { from: string; to: string } {
  const now = new Date();
  const startYear = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
  return { from: `${startYear}-08-01`, to: `${startYear + 1}-07-31` };
}

function fmt(d: string) {
  return new Date(`${d}T12:00:00`).toLocaleDateString('es-MX', { day: 'numeric', month: 'long' });
}

/* ── Fechas del ciclo (BACKLOG P2-16) ───────────────────────────────────── */
interface EventsProps { allLabel?: string; emptyTitle?: string; emptyText?: string }
function CalendarioEventsView(p: EventsProps) {
  const t = useTokens();
  const [level, setLevel] = useState('');
  const { from, to } = useMemo(() => cycleRange(), []);
  const { data, isLoading } = useQuery({
    queryKey: ['school-calendar', from, to, level],
    queryFn: async () => (await contentApi.getCalendar({ from, to, level: level || undefined })).data as SchoolEvent[],
    staleTime: 5 * 60_000,
  });
  const byMonth = useMemo(() => {
    const map = new Map<string, SchoolEvent[]>();
    for (const e of data ?? []) {
      const key = new Date(`${e.start_date}T12:00:00`).toLocaleDateString('es-MX', { month: 'long', year: 'numeric' });
      map.set(key, [...(map.get(key) ?? []), e]);
    }
    return [...map.entries()];
  }, [data]);

  return (
    <Section bg="white" containerSize="md">
      <div className="mb-6 flex flex-wrap gap-2" role="group" aria-label="Nivel">
        {LEVELS.map(([v, label]) => (
          <button key={v} type="button" aria-pressed={level === v} onClick={() => setLevel(v)}
            className={`min-h-[40px] rounded-full px-4 text-sm font-semibold ${level === v ? 'bg-purple text-white' : 'border border-line bg-white text-muted hover:text-ink'}`}>
            {v === '' && p.allLabel ? t(p.allLabel) : label}
          </button>
        ))}
      </div>
      {isLoading ? <ListSkeleton /> : byMonth.length === 0 ? (
        <EmptyState icon={CalendarDays} title={t(p.emptyTitle)} description={p.emptyText ? t(p.emptyText) : undefined} />
      ) : (
        <div className="space-y-8">
          {byMonth.map(([month, events]) => (
            <Reveal key={month}>
              <h2 className="mb-3 font-head text-lg font-bold capitalize text-ink">{month}</h2>
              <ul className="divide-y divide-line rounded-xl2 border border-line bg-white">
                {events.map((e) => (
                  <li key={e.id} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
                    <span className="w-40 shrink-0 text-sm font-semibold text-ink">
                      {fmt(e.start_date)}{e.end_date && e.end_date !== e.start_date ? ` al ${fmt(e.end_date)}` : ''}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm text-ink">{e.title}</span>
                      {e.description && <span className="block text-xs text-muted">{e.description}</span>}
                    </span>
                    <span className="flex gap-1.5">
                      <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${KIND_COLOR[e.kind] ?? 'bg-cream-2 text-muted'}`}>{e.kind_label}</span>
                      {e.level && <span className="rounded-full bg-cream-2 px-2.5 py-0.5 text-[11px] font-bold capitalize text-muted">{e.level}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </Reveal>
          ))}
        </div>
      )}
    </Section>
  );
}

export const sections = [
  section({
    type: 'events', label: 'Calendario · Fechas del ciclo', locked: true,
    description: 'Filtro por nivel y fechas del ciclo en curso, agrupadas por mes. Las fechas se editan en Calendario.',
    component: CalendarioEventsView,
    fields: [
      f.text('allLabel', 'Botón «todos los niveles»'),
      f.text('emptyTitle', 'Título cuando no hay fechas'),
      f.textarea('emptyText', 'Texto cuando no hay fechas'),
    ],
    defaults: {
      allLabel: 'Todos los niveles',
      emptyTitle: 'Calendario en preparación',
      emptyText: 'El colegio publicará aquí las fechas del ciclo.',
    },
  }),
];

export const templates = [{
  slug: 'calendario', path: '/calendario', title: 'Calendario escolar', group: 'calendario',
  seo: { title: 'Calendario escolar', description: `Fechas importantes del ciclo ${CURRENT_CYCLE} en Colegio Interlaken: vacaciones, evaluaciones, eventos y juntas.` },
  sections: [
    { type: 'page.hero', props: {
      label: 'Comunidad', labelClass: 'section-label-green', image: '/assets/classroom.webp',
      title: 'Calendario escolar {{ciclo}}',
      subtitle: 'Suspensiones, vacaciones, evaluaciones, eventos y juntas del ciclo en curso.',
    } },
    'calendario.events',
  ],
}];

export default defineModule(sections, templates);
