import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { format, isSameDay, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import { ArrowLeft, Clock, Coffee, CreditCard, Store, CalendarCheck, CalendarClock, ShoppingBag, WifiOff } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { ListSkeleton } from '@/components/ui/ListSkeleton';
import { ErrorState } from '@/components/ui/ErrorState';
import { EmptyState } from '@/components/ui/EmptyState';
import StudentCard from '@/components/portal/StudentCard';
import { InstallPrompt, LowBalancePrompt, useLowBalancePrompt } from '@/components/portal/CardPrompts';
import { useFamilyChildren } from '@/components/portal/familyChildren';
import { cafeteriaApi } from '@/services/api';
import { useMineScope } from '@/lib/cafeteriaScope';
import { useOnline } from '@/hooks/useOnline';
import { useSelectedChildStore } from '@/store/selectedChildStore';
import type { CafeteriaCard, LoyverseHistoryReceipt } from '@/types';
import { formatMXN } from '@/lib/format';

const money = formatMXN;
const fmtDate = (d: string | null, withTime = false) =>
  d ? format(new Date(d), withTime ? "d MMM yyyy · HH:mm" : 'd MMM yyyy', { locale: es }) : '—';
// A calendar date (YYYY-MM-DD) is that local day: `new Date('2024-09-03')` is
// UTC midnight, which in Mexico is still the 2nd.
const fmtDay = (ymd: string) => format(parseISO(ymd), 'd MMM yyyy', { locale: es });

/** «Saldo actualizado hace 3 min» / «… hoy a las 08:30» / «… el 18 nov a las 08:30». Exported for tests. */
export function freshnessLabel(at: number, now: number): string {
  const s = Math.max(0, Math.floor((now - at) / 1000));
  if (s < 45) return 'Saldo actualizado hace un momento';
  const m = Math.floor(s / 60);
  if (m < 60) return `Saldo actualizado hace ${m} min`;
  const d = new Date(at);
  if (isSameDay(d, new Date(now))) return `Saldo actualizado hoy a las ${format(d, 'HH:mm')}`;
  return `Saldo actualizado el ${format(d, "d 'de' MMM 'a las' HH:mm", { locale: es })}`;
}

function Stat({ icon: Icon, label, value, hint }: { icon: typeof Store; label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-md bg-white p-3 shadow-card print:p-0">
      <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-subtle">
        <Icon size={16} aria-hidden="true" /> {label}
      </div>
      <p className="mt-1 font-head text-lg font-bold text-ink">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-subtle">{hint}</p>}
    </div>
  );
}

export default function CredencialPage() {
  // «Mi cafetería»: the caller's own staff card only.
  const mine = useMineScope();
  // The service worker answers from its 7-day cache when offline, and React
  // Query then stamps that old answer as new: the server's Date header says
  // when the balance really left the school.
  const [servedAt, setServedAt] = useState<number | null>(null);
  const { data: cards, isLoading, isError, refetch, dataUpdatedAt } = useQuery<CafeteriaCard[]>({
    queryKey: mine ? ['cafeteria-cards', 'mine'] : ['cafeteria-cards'],
    queryFn: async () => {
      const r = await cafeteriaApi.getCards(mine);
      const date = Date.parse(String((r as { headers?: Record<string, unknown> }).headers?.date ?? ''));
      setServedAt(Number.isFinite(date) ? date : null);
      return r.data;
    },
  });

  // The child is the one picked anywhere in the portal (header switcher,
  // Inicio, Cafetería): the shared store, never a choice of this page's own
  // (P0, 2026-11-21: a parent who picked B opened A's barcode at the till).
  const storedId = useSelectedChildStore((s) => s.childId);
  const setChildId = useSelectedChildStore((s) => s.setChildId);
  const { children: family, loaded: familyLoaded, isFamily } = useFamilyChildren();
  const cardOf = (id: number | null) => (id == null ? undefined : cards?.find((c) => c.student.id === id));
  // The picked child has no card in this answer: until the family list says
  // whether that child is ours (and simply has no credential yet), wait.
  // Falling back to cards[0] meanwhile would show a sibling's barcode and
  // overwrite the pick (code review 2026-11-22).
  const pickUnresolved = !mine && isFamily && storedId != null && !!cards && !cardOf(storedId) && !familyLoaded;
  // A child of this family with no credential yet: say so, never show a sibling's.
  const missingChild = !mine && storedId != null && !cardOf(storedId)
    ? family.find((c) => c.id === storedId)
    : undefined;
  const active = mine
    ? cards?.[0]
    : (cardOf(storedId) ?? (missingChild || pickUnresolved ? undefined : cards?.[0]));

  // No (or a stale) pick and several cards: adopt the one shown, so the
  // header and every other page agree with the barcode on screen.
  useEffect(() => {
    if (mine || !cards || cards.length < 2 || missingChild || pickUnresolved) return;
    if (storedId != null && cards.some((c) => c.student.id === storedId)) return;
    setChildId(cards[0].student.id);
  }, [mine, cards, storedId, missingChild, pickUnresolved, setChildId]);

  // «Saldo bajo» (once a day per card) and «Instalar la app»: never both at once.
  const lowPrompt = useLowBalancePrompt(active);
  // Brothers and sisters: a swipe on the card moves between their credentials.
  const siblings = !mine && cards && cards.length > 1 ? cards.map((c) => ({ id: c.student.id, name: c.student.name })) : [];

  const studentId = active?.student.id;
  const {
    data: history,
    isLoading: histLoading,
    isError: histError,
    refetch: refetchHistory,
  } = useQuery({
    queryKey: ['loyverse-history', studentId],
    queryFn: async () => (await cafeteriaApi.getLoyverseHistory(studentId, 20, mine)).data,
    enabled: !!studentId && !!active?.linked,
    staleTime: 1000 * 60 * 5,
  });
  const receipts: LoyverseHistoryReceipt[] = history?.receipts ?? [];
  // A staff member's own credential (portal-only staff login, or «Mi
  // credencial» from the console) speaks to the holder, never of «el alumno».
  const ownCard = mine || (!!cards?.length && cards.every((c) => c.student.tipo === 'personal'));

  return (
    <div className="space-y-6">
      <div>
        {mine && (
          <Link to="/portal/mi-cafeteria" className="mb-2 inline-flex min-h-[44px] items-center gap-1.5 rounded-sm text-sm font-semibold text-purple hover:underline print:hidden">
            <ArrowLeft size={16} aria-hidden="true" /> Volver a Mi cafetería
          </Link>
        )}
        <h1 className="font-head text-fluid-xl font-bold leading-tight tracking-[-0.3px] text-ink">{ownCard ? 'Mi credencial de cafetería' : 'Credencial de cafetería'}</h1>
        <p className="mt-1 text-fluid-sm text-muted print:hidden">{ownCard
          ? 'Muestre el código en caja para que le cobren de su saldo.'
          : 'Muestre el código en caja para identificar al alumno y cobrar de su saldo.'}</p>
      </div>

      {isError ? (
        <Card><ErrorState onRetry={() => refetch()} /></Card>
      ) : isLoading || pickUnresolved ? (
        <div className="mx-auto grid w-full max-w-4xl items-start gap-5 md:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] md:gap-6 xl:grid-cols-[minmax(0,30rem)_minmax(0,1fr)] xl:gap-8" aria-busy="true">
          <div className="skeleton mx-auto aspect-[4050/2550] w-full max-w-[28rem] rounded-md md:max-w-none" />
          <div className="skeleton h-40 rounded-md" />
        </div>
      ) : !cards?.length ? (
        <Card>
          <EmptyState icon={Coffee} title="Sin credencial de cafetería"
            description={mine
              ? 'El colegio aún no vincula su cuenta con la cafetería.'
              : 'El colegio aún no vincula al alumno con la cafetería.'}
            action={
              <Link to="/contacto" className="btn-secondary text-sm">
                Contactar al colegio
              </Link>
            } />
        </Card>
      ) : missingChild ? (
        <Card>
          <EmptyState icon={CreditCard} title={`${missingChild.name.split(' ')[0]} aún no tiene credencial`}
            description="El colegio aún no activa su credencial de cafetería. Puede ver la de otro alumno."
            action={
              <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
                {cards.map((c) => (
                  <button key={c.student.id} type="button" onClick={() => setChildId(c.student.id)} className="btn-secondary min-h-[48px] text-sm">
                    Ver credencial de {c.student.name.split(' ')[0]}
                  </button>
                ))}
              </div>
            } />
        </Card>
      ) : active ? (
        <>
          <StudentCard card={active} footer={<Freshness at={freshAt(dataUpdatedAt, servedAt)} />} siblings={siblings} onPick={setChildId} />
          {lowPrompt.open && <LowBalancePrompt card={active} mine={mine} onClose={lowPrompt.close} />}
          <InstallPrompt hold={lowPrompt.open} />

          {/* Activity: visits from Loyverse; consumption from the school's
              ledger. Loyverse's own "total_spent" only counts cash/card (the
              wallet is points), and the points ARE the balance on the card. */}
          {active.loyverse && (
            <section aria-labelledby="actividad-cafeteria" className="print:break-inside-avoid">
              <h2 id="actividad-cafeteria" className="mb-2 font-head text-base font-bold text-ink">Actividad en cafetería</h2>
              <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
                <Stat icon={Store} label="Visitas" value={String(active.loyverse.total_visits)} />
                <Stat
                  icon={ShoppingBag}
                  label="Consumo registrado"
                  value={money(active.consumption.total)}
                  hint={active.consumption.since ? `desde ${fmtDay(active.consumption.since)}` : 'Sin compras registradas'}
                />
                <Stat icon={CalendarCheck} label="Primera visita" value={fmtDate(active.loyverse.first_visit)} />
                <Stat icon={CalendarClock} label="Última visita" value={fmtDate(active.loyverse.last_visit, true)} />
              </div>
            </section>
          )}

          {/* Read-only Loyverse history */}
          {active.linked && (
            <Card title="Compras recientes (Loyverse)">
              {histLoading ? (
                <ListSkeleton rows={4} />
              ) : histError ? (
                <ErrorState onRetry={() => refetchHistory()} />
              ) : !receipts.length ? (
                <EmptyState icon={ShoppingBag} title="Sin compras recientes"
                  description="Aún no hay compras recientes en Loyverse." />
              ) : (
                <>
                  <p className="mb-3 text-xs text-subtle">Historial de solo lectura, directo de Loyverse. No afecta el saldo.</p>
                  <div className="divide-y divide-line">
                    {receipts.map((r, i) => (
                      <div key={r.receipt_number ?? i} className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0 print:break-inside-avoid">
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
                        <span className={`flex-shrink-0 text-sm font-semibold tabular-nums ${r.type === 'refund' ? 'text-success' : 'text-ink'}`}>
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

/** When the balance left the school: the server's own time once the answer is
 *  clearly older than the fetch (the offline cache), else the fetch time. */
function freshAt(fetchedAt: number, servedAt: number | null): number {
  if (servedAt != null && fetchedAt - servedAt > 10 * 60_000) return servedAt;
  return fetchedAt;
}

/** The time under the card, honest offline (Phase 6: cached data says when). */
function Freshness({ at }: { at: number }) {
  const online = useOnline();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  if (!at) return null;
  return (
    <p aria-live="polite" className="flex items-center gap-1.5 text-[13px] text-muted">
      {online ? <Clock size={16} aria-hidden="true" /> : <WifiOff size={16} aria-hidden="true" />}
      <span>
        {freshnessLabel(at, Math.max(now, at))}
        {!online && <span className="font-semibold text-ink"> · Sin conexión</span>}
      </span>
    </p>
  );
}
