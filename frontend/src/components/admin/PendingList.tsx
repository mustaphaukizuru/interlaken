import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  AlertOctagon, CalendarCheck, CalendarClock, CalendarX2, CheckCircle2, ChevronRight, CircleDollarSign, ClipboardList, Coffee, CreditCard,
  FileCheck2, FormInput, Inbox, KeyRound, RefreshCw, Scale, ShieldAlert, UserPlus, UserX, Wallet, type LucideIcon,
} from 'lucide-react';
import { coreApi } from '@/services/api';
import { formatMXN } from '@/lib/format';
import { ErrorState } from '@/components/ui/ErrorState';
import type { AreaKey } from '@/lib/areas';

/** GET /core/badges/: counts per queue plus `<key>_edad` (minutes the oldest has waited). */
export type Counters = Record<string, number>;

type Tone = 'danger' | 'warning' | 'info';

const TONE: Record<Tone, string> = {
  danger: 'bg-danger-bg text-danger',
  warning: 'bg-warning-bg text-warning',
  info: 'bg-info-bg text-info',
};

/** Money figures only the admin dashboard payload carries (staff get counts). */
export interface PendingTotals {
  verificar?: string;
  /** How many of the top-ups to verify the app already loaded (instant auto-load). */
  verificarCargadas?: number;
  aplicar?: string;
}

interface Item {
  key: string;
  /** Console area of the queue; admin-only queues have none. */
  area: AreaKey | null;
  icon: LucideIcon;
  tone: Tone;
  one: string;
  many: string;
  /** Built when the row renders, so links with dates follow the clock (a console left open overnight). */
  to: string | (() => string);
  /** One supporting line (what to do next), optional. */
  hint?: (c: Counters, totals: PendingTotals) => string | undefined;
}

/** YYYY-MM-DD, local, `days` before today (the failed-payments window start). */
function daysAgo(days: number, now = new Date()): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - days);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** «hace 20 minutos», «hace 3 horas», «hace 1 día». */
export function waitedFor(minutes: number | undefined): string {
  if (minutes === undefined || !Number.isFinite(minutes)) return '';
  const unit = (n: number, one: string, many: string) => `hace ${n} ${n === 1 ? one : many}`;
  if (minutes < 1) return 'hace un momento';
  if (minutes < 60) return unit(minutes, 'minuto', 'minutos');
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return unit(hours, 'hora', 'horas');
  return unit(Math.floor(hours / 24), 'día', 'días');
}

/**
 * «Recargas por verificar» says whether the money already reached the wallet
 * (school, 2026-11-22): with the instant auto-load most are in the balance and
 * in Loyverse, and only the MultiCobros confirmation is missing. Without the
 * loaded count (staff payload) it only asks for the check.
 */
export function verifyHint(count: number, loaded: number | undefined, total?: string): string {
  const paid = `Pagadas con tarjeta${total ? ` (${formatMXN(total)})` : ''}.`;
  if (loaded === undefined || count <= 0) return `${paid} Verifíquelas en MultiCobros.`;
  const done = Math.min(Math.max(loaded, 0), count);
  const one = count === 1;
  if (done === count) {
    return `${paid} Ya ${one ? 'está' : 'están'} en el saldo y en Loyverse: solo falta confirmarla${one ? '' : 's'} en MultiCobros.`;
  }
  if (done === 0) return `${paid} No ${one ? 'llega' : 'llegan'} al saldo hasta verificarla${one ? '' : 's'} en MultiCobros.`;
  const waiting = count - done;
  return `${paid} ${done} ya ${done === 1 ? 'está' : 'están'} en el saldo y en Loyverse; `
    + `${waiting} ${waiting === 1 ? 'llega' : 'llegan'} al saldo al verificarla${waiting === 1 ? '' : 's'} en MultiCobros.`;
}

/**
 * The queues, most urgent first: money that has not reached a wallet, then
 * legal deadlines, then admissions and the office's inboxes. Each opens its
 * filtered list. Keys are those of GET /core/badges/ (backend core/badges.py).
 */
const ITEMS: Item[] = [
  { key: 'cafeteria_verificar', area: 'cafeteria', icon: ShieldAlert, tone: 'warning',
    one: 'recarga por verificar', many: 'recargas por verificar', to: '/admin/cafeteria?tab=pos',
    hint: (c, t) => verifyHint(c.cafeteria_verificar ?? 0, t.verificarCargadas, t.verificar) },
  { key: 'cafeteria_aplicar', area: 'cafeteria', icon: Coffee, tone: 'warning',
    one: 'recarga con tarjeta por aplicar', many: 'recargas con tarjeta por aplicar', to: '/admin/cafeteria?tab=pos',
    hint: (_c, t) => `Cárguelas en Loyverse a las 7:30${t.aplicar ? ` (${formatMXN(t.aplicar)})` : ''}.` },
  { key: 'cafeteria_caja', area: 'cafeteria', icon: Wallet, tone: 'warning',
    one: 'depósito en caja por aplicar', many: 'depósitos en caja por aplicar',
    to: '/admin/cafeteria?tab=deposits&estado=pending&metodo=office' },
  { key: 'pagos_fallidos', area: 'cafeteria', icon: CreditCard, tone: 'danger',
    one: 'pago con tarjeta fallido', many: 'pagos con tarjeta fallidos',
    to: () => `/admin/pagos?estado=failed&desde=${daysAgo(6)}`,
    hint: () => 'Últimos 7 días. La lista también muestra los cancelados por la familia.' },
  { key: 'loyverse_alertas', area: 'cafeteria', icon: RefreshCw, tone: 'danger',
    one: 'alerta de sincronización con Loyverse', many: 'alertas de sincronización con Loyverse',
    to: '/admin/cafeteria', hint: () => 'Revise «Estado de la sincronización».' },
  // Costos sections without the next cycle's prices (admin-only counter, from a
  // month before the site moves to that cycle; lib/priceYears).
  { key: 'precios', area: null, icon: CircleDollarSign, tone: 'warning',
    one: 'sección de Costos sin precios nuevos', many: 'secciones de Costos sin precios nuevos', to: '/admin/costos',
    hint: (c) => (c.precios_anio ? `Faltan los precios ${c.precios_anio}. Publíquelos en «Costos y precios».` : undefined) },
  { key: 'arco', area: null, icon: Scale, tone: 'info',
    one: 'solicitud ARCO abierta', many: 'solicitudes ARCO abiertas', to: '/admin/arco',
    hint: (c) => (c.arco_vencidas ? `${c.arco_vencidas} fuera de plazo legal.` : undefined) },
  { key: 'documentos', area: 'admisiones', icon: FileCheck2, tone: 'info',
    one: 'documento por revisar', many: 'documentos por revisar', to: '/admin/admisiones?vista=inscripciones&docs=true' },
  { key: 'inscripciones', area: 'admisiones', icon: ClipboardList, tone: 'info',
    one: 'inscripción enviada por revisar', many: 'inscripciones enviadas por revisar',
    to: '/admin/admisiones?vista=inscripciones&estado=submitted' },
  { key: 'preregistros', area: 'admisiones', icon: UserPlus, tone: 'info',
    one: 'pre-registro nuevo', many: 'pre-registros nuevos', to: '/admin/admisiones?etapa=informes' },
  // Past visits nobody closed, then the people coming (Visitas' red dot).
  { key: 'visitas_cerrar', area: 'visitas', icon: CalendarX2, tone: 'warning',
    one: 'visita por cerrar', many: 'visitas por cerrar', to: '/admin/visitas?seguimiento=por_cerrar',
    hint: () => 'Ya pasaron: márquelas «Asistió» o «No asistió».' },
  { key: 'visitas', area: 'visitas', icon: CalendarClock, tone: 'info',
    one: 'visita próxima', many: 'visitas próximas', to: '/admin/visitas?seguimiento=proximas',
    hint: () => 'Agendadas desde hoy en adelante.' },
  { key: 'visitas_hoy', area: 'visitas', icon: CalendarCheck, tone: 'info',
    one: 'visita hoy', many: 'visitas hoy', to: () => `/admin/visitas?desde=${daysAgo(0)}&hasta=${daysAgo(0)}` },
  { key: 'mensajes', area: 'mensajes', icon: Inbox, tone: 'info',
    one: 'mensaje sin atender', many: 'mensajes sin atender', to: '/admin/mensajes' },
  { key: 'formularios', area: 'mensajes', icon: FormInput, tone: 'info',
    one: 'respuesta de formulario sin atender', many: 'respuestas de formulario sin atender', to: '/admin/formularios' },
  { key: 'contrasenas', area: 'accesos', icon: KeyRound, tone: 'info',
    one: 'solicitud de contraseña', many: 'solicitudes de contraseña', to: '/admin/contrasenas' },
  { key: 'saldo_bajo', area: 'cafeteria', icon: AlertOctagon, tone: 'info',
    one: 'alumno con saldo bajo', many: 'alumnos con saldo bajo', to: '/admin/cafeteria?tab=low' },
  { key: 'sin_loyverse', area: 'alumnos', icon: UserX, tone: 'info',
    one: 'alumno sin cliente en Loyverse', many: 'alumnos sin cliente en Loyverse', to: '/admin/alumnos?vinculado=missing',
    hint: () => 'Probablemente ya no estudian aquí.' },
];

/** The rows to show: non-zero queues, most urgent first. ARCO past its deadline turns red. */
export function pendingRows(counters: Counters) {
  return ITEMS
    .filter((it) => (counters[it.key] ?? 0) > 0)
    .map((it) => (it.key === 'arco' && (counters.arco_vencidas ?? 0) > 0
      ? { ...it, tone: 'danger' as Tone, to: '/admin/arco?vencidas=1' }
      : it));
}

/**
 * True when the API sends the «Pendientes» counters. An older backend (the
 * SPA deployed before the API) sends the sidebar keys only: then the list
 * hides instead of claiming «Todo al día» over queues it cannot see.
 */
const LEGACY_AREA_KEYS = ['admisiones', 'visitas', 'cafeteria'];
const PENDIENTES_KEYS = ['preregistros', 'inscripciones', 'documentos', 'visitas_hoy', 'cafeteria_caja',
  'cafeteria_aplicar', 'pagos_fallidos', 'saldo_bajo', 'loyverse_alertas'];
export function speaksPendientes(counters: Counters): boolean {
  const hasLegacy = LEGACY_AREA_KEYS.some((k) => k in counters);
  return !hasLegacy || PENDIENTES_KEYS.some((k) => k in counters);
}

/** Same query as the sidebar badges (one request, shared cache). */
export function usePendingCounters() {
  return useQuery({
    queryKey: ['badges'],
    queryFn: async () => (await coreApi.getBadges()).data as Counters,
    refetchInterval: 60_000,
    staleTime: 30_000,
    retry: false,
  });
}

/**
 * «Pendientes»: one row per queue that has something waiting, with its count,
 * how long the oldest has waited and a one-click way to the filtered list.
 * The counters come scoped from the API (a staff account only gets its areas),
 * so this list never offers a queue the person cannot open. «Todo al día»
 * when nothing waits.
 */
export function PendingList({ totals = {} }: { totals?: PendingTotals }) {
  const { data, isLoading, isError, refetch } = usePendingCounters();
  const rows = data ? pendingRows(data) : [];
  if (data && !speaksPendientes(data)) return null;

  return (
    <section aria-labelledby="pending-title" className="card mb-6 !p-0">
      <div className="flex items-baseline justify-between gap-3 px-5 pb-2 pt-4 sm:px-[22px]">
        <h2 id="pending-title" className="font-head text-[15px] font-bold text-ink">Pendientes</h2>
        {rows.length > 0 && (
          <span className="text-xs text-muted">{rows.length} {rows.length === 1 ? 'lista' : 'listas'} con trabajo</span>
        )}
      </div>
      {isError && !data ? (
        <ErrorState title="No se pudieron cargar los pendientes" description="Intente de nuevo en un momento." onRetry={() => refetch()} />
      ) : isLoading ? (
        <div className="space-y-2 px-5 pb-5 sm:px-[22px]" aria-busy="true">
          {[0, 1, 2].map((i) => <div key={i} className="skeleton h-14 rounded-sm" />)}
        </div>
      ) : rows.length === 0 ? (
        <div className="flex items-center gap-3 px-5 pb-5 pt-1 sm:px-[22px]" role="status">
          <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-sm bg-success-bg text-success">
            <CheckCircle2 size={20} aria-hidden="true" />
          </span>
          <div>
            <p className="font-semibold text-ink">Todo al día</p>
            <p className="text-sm text-muted">No hay nada esperando en sus listas.</p>
          </div>
        </div>
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((it) => {
            const n = counters(data, it.key);
            const waited = waitedFor(data?.[`${it.key}_edad`]);
            const hint = it.hint?.(data ?? {}, totals);
            const Icon = it.icon;
            return (
              <li key={it.key}>
                <Link
                  to={typeof it.to === 'function' ? it.to() : it.to}
                  className="group flex min-h-[56px] items-center gap-3 px-5 py-3 transition-colors hover:bg-cream/60 focus-visible:bg-cream/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-purple/40 sm:px-[22px]"
                >
                  <span className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-sm ${TONE[it.tone]}`}>
                    <Icon size={20} aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-ink">
                      <strong className="font-head text-base tabular-nums">{n.toLocaleString('es-MX')}</strong>{' '}
                      {n === 1 ? it.one : it.many}
                    </span>
                    {(hint || waited) && (
                      <span className="mt-0.5 block text-[13px] text-muted">
                        {[hint, waited && `Desde ${waited}`].filter(Boolean).join(' · ')}
                      </span>
                    )}
                  </span>
                  <ChevronRight size={20} className="flex-shrink-0 text-subtle transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

const counters = (data: Counters | undefined, key: string) => data?.[key] ?? 0;

export default PendingList;
