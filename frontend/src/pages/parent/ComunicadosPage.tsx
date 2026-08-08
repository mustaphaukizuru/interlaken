import { useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Megaphone, MessageCircle, ChevronRight } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { SectionCard, SectionEmpty } from '@/components/ui/SectionCard';
import { ErrorState } from '@/components/ui/ErrorState';
import { Pagination } from '@/components/ui/Pagination';
import { Reveal } from '@/components/ui/Reveal';
import { portalApi } from '@/services/api';
import { ADMIN_PAGE_SIZE, toPaged } from '@/lib/pagination';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

interface Announcement {
  id: number;
  title: string;
  body: string;
  audience: string;
  created_at: string;
  comment_count: number;
}

const audienceLabel: Record<string, string> = {
  all: 'Todos', parents: 'Padres', students: 'Alumnos', staff: 'Personal',
};

export default function ComunicadosPage() {
  const [page, setPage] = useState(1);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['announcements', page],
    queryFn: async () => {
      const { data: body } = await portalApi.getAnnouncements({ page });
      return toPaged<Announcement>(body);
    },
    placeholderData: keepPreviousData,
    staleTime: 1000 * 60 * 2,
  });

  const announcements = data?.results ?? [];
  const count = data?.count ?? 0;

  return (
    <>
      <PageHeader title="Comunicados" subtitle="Avisos y noticias del colegio" />

      {isError ? (
        <div className="card"><ErrorState onRetry={() => refetch()} /></div>
      ) : (
        <SectionCard title="Todos los comunicados">
          {isLoading ? (
            <div className="space-y-3 p-5">
              {[0, 1, 2, 3].map(i => <div key={i} className="skeleton h-16 rounded-xl2" />)}
            </div>
          ) : !announcements.length ? (
            <SectionEmpty icon={Megaphone}>Sin comunicados por ahora</SectionEmpty>
          ) : (
            <>
              <div>
                {announcements.map((a, i) => (
                  <Reveal key={a.id} delay={i * 40}>
                    <Link
                      to={`/portal/comunicados/${a.id}`}
                      className={`group flex items-start gap-3 px-5 py-4 transition hover:bg-cream/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-purple/30 ${i === 0 ? '' : 'border-t border-cream'}`}
                    >
                      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl2 bg-gradient-to-br from-pink to-purple text-white">
                        <Megaphone className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="truncate font-head text-[14.5px] font-bold text-ink">{a.title}</span>
                          <span className="badge-purple shrink-0">{audienceLabel[a.audience] ?? a.audience}</span>
                        </span>
                        <span className="mt-0.5 line-clamp-2 block text-[13px] text-muted">{a.body}</span>
                        <span className="mt-1.5 flex items-center gap-3 text-[11.5px] text-subtle">
                          <span>{format(new Date(a.created_at), "d 'de' MMM yyyy", { locale: es })}</span>
                          <span className="inline-flex items-center gap-1">
                            <MessageCircle className="h-3.5 w-3.5" />{a.comment_count}
                          </span>
                        </span>
                      </span>
                      <ChevronRight className="mt-2 h-4 w-4 shrink-0 text-subtle transition group-hover:translate-x-0.5 group-hover:text-purple" />
                    </Link>
                  </Reveal>
                ))}
              </div>
              <div className="px-5 pb-4">
                <Pagination
                  page={page}
                  pageSize={ADMIN_PAGE_SIZE}
                  count={count}
                  onChange={setPage}
                  itemLabel="comunicados"
                />
              </div>
            </>
          )}
        </SectionCard>
      )}
    </>
  );
}
