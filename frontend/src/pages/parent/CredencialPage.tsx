import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Coffee, Store, CalendarCheck, CalendarClock, Star, ShoppingBag } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { ListSkeleton } from '@/components/ui/ListSkeleton';
import { ErrorState } from '@/components/ui/ErrorState';
import { EmptyState } from '@/components/ui/EmptyState';
import StudentCard from '@/components/portal/StudentCard';
import { cafeteriaApi } from '@/services/api';
import type { CafeteriaCard, LoyverseHistoryReceipt } from '@/types';

const money = (v: string | number) =>
  Number(v).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
const fmtDate = (d: string | null, withTime = false) =>
  d ? format(new Date(d), withTime ? "d MMM yyyy · HH:mm" : 'd MMM yyyy', { locale: es }) : '—';

function Stat({ icon: Icon, label, value }: { icon: typeof Store; label: string; value: string }) {
  return (
    <div className="rounded-xl2 border border-line bg-white p-3">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-subtle">
        <Icon className="h-3.5 w-3.5" /> {label}
      </div>
      <p className="mt-1 font-head text-lg font-bold text-ink">{value}</p>
    </div>
  );
}

export default function CredencialPage() {
  const { data: cards, isLoading, isError, refetch } = useQuery<CafeteriaCard[]>({
    queryKey: ['cafeteria-cards'],
    queryFn: async () => (await cafeteriaApi.getCards()).data,
  });

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const active = useMemo(() => {
    if (!cards?.length) return null;
    return cards.find((c) => c.student.id === selectedId) ?? cards[0];
  }, [cards, selectedId]);

  const studentId = active?.student.id;
  const { data: history, isLoading: histLoading } = useQuery({
    queryKey: ['loyverse-history', studentId],
    queryFn: async () => (await cafeteriaApi.getLoyverseHistory(studentId)).data,
    enabled: !!studentId && !!active?.linked,
    staleTime: 1000 * 60 * 5,
  });
  const receipts: LoyverseHistoryReceipt[] = history?.receipts ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-head text-fluid-xl font-bold leading-tight tracking-[-0.3px] text-ink">Credencial de cafetería</h1>
        <p className="mt-1 text-fluid-sm text-muted">Muestra el código en caja para identificar al alumno y cobrar de su saldo.</p>
      </div>

      {isError ? (
        <Card><ErrorState onRetry={() => refetch()} /></Card>
      ) : isLoading ? (
        <div className="mx-auto h-[280px] w-full max-w-sm skeleton rounded-xl3" aria-busy="true" />
      ) : !cards?.length ? (
        <Card>
          <EmptyState icon={Coffee} title="Sin credencial de cafetería"
            description="El colegio debe vincular al alumno con el servicio de cafetería (Loyverse) para generar su credencial." />
        </Card>
      ) : active ? (
        <>
          {/* Child selector */}
          {cards.length > 1 && (
            <div className="flex flex-wrap gap-2">
              {cards.map((c) => {
                const on = c.student.id === active.student.id;
                return (
                  <button
                    key={c.student.id}
                    type="button"
                    onClick={() => setSelectedId(c.student.id)}
                    className={`rounded-full border px-3.5 py-1.5 text-sm font-semibold transition ${
                      on ? 'border-purple bg-purple text-white' : 'border-line bg-white text-muted hover:border-purple/40 hover:text-purple'
                    }`}
                  >
                    {c.student.name.split(' ')[0]}
                  </button>
                );
              })}
            </div>
          )}

          <StudentCard card={active} />

          {/* Loyverse profile stats */}
          {active.loyverse && (
            <div>
              <h2 className="mb-2 font-head text-[15px] font-bold text-ink">Actividad en cafetería</h2>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <Stat icon={Store} label="Visitas" value={String(active.loyverse.total_visits)} />
                <Stat icon={ShoppingBag} label="Gasto histórico" value={money(active.loyverse.total_spent)} />
                <Stat icon={Star} label="Puntos" value={String(Math.round(Number(active.points ?? active.loyverse.total_points)))} />
                <Stat icon={CalendarCheck} label="Primera visita" value={fmtDate(active.loyverse.first_visit)} />
                <Stat icon={CalendarClock} label="Última visita" value={fmtDate(active.loyverse.last_visit, true)} />
              </div>
            </div>
          )}

          {/* Read-only Loyverse history */}
          {active.linked && (
            <Card title="Compras recientes (Loyverse)">
              {histLoading ? (
                <ListSkeleton rows={4} />
              ) : !receipts.length ? (
                <EmptyState icon={ShoppingBag} title="Sin compras recientes"
                  description="No hay compras recientes registradas en Loyverse para este alumno." />
              ) : (
                <>
                  <p className="mb-3 text-xs text-subtle">Historial de solo lectura, directo de Loyverse. No afecta el saldo.</p>
                  <div className="divide-y divide-cream">
                    {receipts.map((r, i) => (
                      <div key={r.receipt_number ?? i} className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-ink">
                            {r.type === 'refund' ? 'Devolución' : 'Compra'}
                          </p>
                          <p className="text-xs text-subtle">{fmtDate(r.date, true)}</p>
                          {r.items?.length > 0 ? (
                            <ul className="mt-1 space-y-0.5 text-xs text-muted">
                              {r.items.slice(0, 6).map((it, j) => (
                                <li key={j}>{it.quantity}× {it.name}</li>
                              ))}
                            </ul>
                          ) : r.description ? (
                            <p className="mt-1 text-xs text-muted">{r.description}</p>
                          ) : null}
                        </div>
                        <span className={`flex-shrink-0 text-sm font-semibold ${r.type === 'refund' ? 'text-green-700' : 'text-ink'}`}>
                          {r.type === 'refund' ? '+' : '-'}{money(r.amount)}
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </Card>
          )}
        </>
      ) : null}
    </div>
  );
}
