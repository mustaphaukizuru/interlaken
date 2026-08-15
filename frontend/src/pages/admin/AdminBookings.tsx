import { useState } from 'react';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { CalendarClock, CalendarPlus, Check, Loader2, X, UserCheck } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import toast from 'react-hot-toast';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { TableSkeleton } from '@/components/ui/TableSkeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Pagination } from '@/components/ui/Pagination';
import { bookingsApi } from '@/services/api';
import { toPaged, ADMIN_PAGE_SIZE } from '@/lib/pagination';
import type { Booking } from '@/types';

const statusMeta: Record<string, { label: string; variant: any }> = {
  pending:   { label: 'Pendiente', variant: 'warning' },
  confirmed: { label: 'Confirmada', variant: 'success' },
  cancelled: { label: 'Cancelada', variant: 'error' },
  attended:  { label: 'Asistió', variant: 'info' },
  no_show:   { label: 'No asistió', variant: 'error' },
};

const WEEKDAYS = [
  { value: 1, label: 'Lun' },
  { value: 2, label: 'Mar' },
  { value: 3, label: 'Mié' },
  { value: 4, label: 'Jue' },
  { value: 5, label: 'Vie' },
  { value: 6, label: 'Sáb' },
  { value: 0, label: 'Dom' },
];

function SlotGenerator({ onDone }: { onDone: () => void }) {
  const [visitType, setVisitType] = useState<'individual' | 'open_class'>('individual');
  const [form, setForm] = useState({
    title: '',
    start_date: '',
    end_date: '',
    window_start: '09:00',
    window_end: '11:00',
    interval_minutes: 30,
    capacity: 1,
    location: 'Campus Interlaken',
  });
  const [weekdays, setWeekdays] = useState<number[]>([1, 2, 3, 4, 5]);

  const setVisitTypeAndDefaults = (next: 'individual' | 'open_class') => {
    setVisitType(next);
    setForm((f) => ({
      ...f,
      title: next === 'open_class' ? (f.title || 'Puertas Abiertas') : '',
      // Open-class = one event block per day; individual = short tour slots.
      interval_minutes: next === 'open_class' ? 120 : 30,
      capacity: next === 'open_class' ? 30 : 1,
      window_end: next === 'open_class' ? '11:00' : f.window_end,
    }));
  };

  const mutation = useMutation({
    mutationFn: () =>
      bookingsApi.generateSlots({
        visit_type: visitType,
        title: visitType === 'open_class' ? (form.title.trim() || 'Puertas Abiertas') : undefined,
        weekdays,
        start_date: form.start_date,
        end_date: form.end_date,
        window_start: form.window_start,
        window_end: form.window_end,
        location: form.location,
        interval_minutes: Number(form.interval_minutes),
        capacity: Number(form.capacity),
      }),
    onSuccess: ({ data }) => {
      toast.success(data.detail ?? 'Horarios generados.');
      onDone();
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.detail ?? 'No fue posible generar los horarios.');
    },
  });

  const toggleDay = (d: number) =>
    setWeekdays((w) => (w.includes(d) ? w.filter((x) => x !== d) : [...w, d]));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.start_date || !form.end_date) {
      toast.error('Seleccione el rango de fechas.');
      return;
    }
    if (!weekdays.length) {
      toast.error('Seleccione al menos un día de la semana.');
      return;
    }
    mutation.mutate();
  };

  const isOpenClass = visitType === 'open_class';

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label className="label" htmlFor="slot-visit-type">Tipo de visita</label>
        <select
          id="slot-visit-type"
          className="input-field"
          aria-label="Tipo de visita a publicar"
          value={visitType}
          onChange={(e) => setVisitTypeAndDefaults(e.target.value as 'individual' | 'open_class')}
        >
          <option value="individual">Visita individual (Agendar visita)</option>
          <option value="open_class">Puertas Abiertas (clase abierta)</option>
        </select>
        <p className="mt-1.5 text-xs text-subtle">
          {isOpenClass
            ? 'Se publica en /puertas-abiertas. Use una duración igual a la ventana (ej. 09:00–11:00 y 120 min) para un solo evento por día.'
            : 'Se publica en /agendar-visita como horarios cortos de recorrido personalizado.'}
        </p>
      </div>

      {isOpenClass && (
        <Input
          label="Nombre del evento"
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          placeholder="Puertas Abiertas"
        />
      )}

      <div className="grid sm:grid-cols-2 gap-4">
        <Input
          label="Desde"
          type="date"
          value={form.start_date}
          onChange={(e) => setForm({ ...form, start_date: e.target.value })}
        />
        <Input
          label="Hasta"
          type="date"
          value={form.end_date}
          onChange={(e) => setForm({ ...form, end_date: e.target.value })}
        />
      </div>

      <div role="group" aria-label="Días de la semana">
        <span className="label">Días de la semana</span>
        <div className="flex flex-wrap gap-2">
          {WEEKDAYS.map((d) => (
            <button
              key={d.value}
              type="button"
              onClick={() => toggleDay(d.value)}
              className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                weekdays.includes(d.value)
                  ? 'border-brand-500 bg-brand-500 text-white'
                  : 'border-line text-muted hover:border-brand-400'
              }`}
            >
              {d.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <Input
          label="Hora inicio"
          type="time"
          value={form.window_start}
          onChange={(e) => setForm({ ...form, window_start: e.target.value })}
        />
        <Input
          label="Hora fin"
          type="time"
          value={form.window_end}
          onChange={(e) => setForm({ ...form, window_end: e.target.value })}
        />
      </div>

      <div className="grid sm:grid-cols-3 gap-4">
        <div>
          <label className="label" htmlFor="slot-interval">Duración (min)</label>
          <select
            id="slot-interval"
            className="input-field"
            value={form.interval_minutes}
            onChange={(e) => setForm({ ...form, interval_minutes: Number(e.target.value) })}
          >
            {[15, 20, 30, 45, 60, 90, 120, 180].map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </div>
        <Input
          label={isOpenClass ? 'Cupo del evento' : 'Cupo por horario'}
          type="number"
          min={1}
          value={form.capacity}
          onChange={(e) => setForm({ ...form, capacity: Number(e.target.value) })}
        />
        <Input
          label="Ubicación"
          value={form.location}
          onChange={(e) => setForm({ ...form, location: e.target.value })}
        />
      </div>

      <Button type="submit" loading={mutation.isPending}>
        <CalendarPlus className="w-4 h-4" />
        {isOpenClass ? 'Publicar eventos' : 'Generar horarios'}
      </Button>
    </form>
  );
}

type BookingAct = 'confirm' | 'cancel' | 'attended' | 'no_show';

function BookingActions({
  booking,
  onAction,
  onCancelRequest,
  pendingAct,
}: {
  booking: Booking;
  onAction: (v: { id: number; act: BookingAct }) => void;
  onCancelRequest: (b: Booking) => void;
  /** Action currently in flight for THIS booking (undefined when idle). */
  pendingAct?: BookingAct;
}) {
  const { id, parent_name: parentName } = booking;
  const pending = pendingAct !== undefined;
  const base =
    'inline-flex items-center justify-center w-11 h-11 md:w-9 md:h-9 rounded-lg text-subtle transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:cursor-not-allowed disabled:opacity-50';
  return (
    <>
      <button
        title="Marcar asistió"
        aria-label={`Marcar que ${parentName} asistió`}
        onClick={() => onAction({ id, act: 'attended' })}
        disabled={pending}
        className={`${base} hover:bg-brand-50 hover:text-brand-600`}
      >
        {pendingAct === 'attended'
          ? <Loader2 className="w-4 h-4 animate-spin" />
          : <UserCheck className="w-4 h-4" />}
      </button>
      <button
        title="Confirmar"
        aria-label={`Confirmar la reserva de ${parentName}`}
        onClick={() => onAction({ id, act: 'confirm' })}
        disabled={pending}
        className={`${base} hover:bg-green-50 hover:text-green-600`}
      >
        {pendingAct === 'confirm'
          ? <Loader2 className="w-4 h-4 animate-spin" />
          : <Check className="w-4 h-4" />}
      </button>
      <button
        title="Cancelar"
        aria-label={`Cancelar la reserva de ${parentName}`}
        onClick={() => onCancelRequest(booking)}
        disabled={pending}
        className={`${base} hover:bg-coral-50 hover:text-coral-600`}
      >
        {pendingAct === 'cancel' || pendingAct === 'no_show'
          ? <Loader2 className="w-4 h-4 animate-spin" />
          : <X className="w-4 h-4" />}
      </button>
    </>
  );
}

interface AdminSlot {
  id: number; visit_type: string; title: string; date: string;
  start_time: string; end_time: string; capacity: number; location: string;
  is_active: boolean; booked_count: number; spots_remaining: number; is_full: boolean;
}

const VISIT_TYPE_LABEL: Record<string, string> = {
  individual: 'Individual', open_class: 'Puertas Abiertas',
};

/** View / deactivate / delete published availability slots. */
function SlotManager() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [typeFilter, setTypeFilter] = useState<'individual' | 'open_class' | ''>('');
  const [deleteFor, setDeleteFor] = useState<AdminSlot | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin-slots', page, typeFilter],
    queryFn: async () =>
      toPaged<AdminSlot>(
        (await bookingsApi.getAdminSlots({
          page,
          ...(typeFilter ? { type: typeFilter } : {}),
        })).data,
      ),
    placeholderData: keepPreviousData,
  });
  const slots = data?.results;
  const count = data?.count ?? 0;

  const toggleActive = useMutation({
    mutationFn: (s: AdminSlot) => bookingsApi.updateSlot(s.id, { is_active: !s.is_active }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-slots'] }); toast.success('Horario actualizado.'); },
    onError: () => toast.error('No se pudo actualizar el horario.'),
  });
  const del = useMutation({
    mutationFn: (id: number) => bookingsApi.deleteSlot(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-slots'] }); setDeleteFor(null); toast.success('Horario eliminado.'); },
    onError: (e: any) => { toast.error(e?.response?.data?.detail ?? 'No se pudo eliminar el horario.'); setDeleteFor(null); },
  });

  return (
    <>
      <div className="mb-4">
        <select
          className="input-field text-base sm:text-sm py-1.5 max-w-xs"
          aria-label="Filtrar horarios por tipo"
          value={typeFilter}
          onChange={(e) => {
            setTypeFilter(e.target.value as 'individual' | 'open_class' | '');
            setPage(1);
          }}
        >
          <option value="">Todos los tipos</option>
          <option value="individual">Visitas individuales</option>
          <option value="open_class">Puertas Abiertas</option>
        </select>
      </div>

      {isError ? (
        <ErrorState onRetry={() => refetch()} />
      ) : isLoading ? (
        <TableSkeleton />
      ) : !slots?.length ? (
        <EmptyState
          icon={CalendarClock}
          title="Sin horarios"
          description={
            typeFilter
              ? 'Ningún horario coincide con el filtro. Genere disponibilidad arriba o cambie el filtro.'
              : 'Genere disponibilidad con el formulario de arriba.'
          }
        />
      ) : (
      <div className="divide-y divide-line">
        {slots.map((s) => (
          <div key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
            <div className="min-w-0">
              <p className="text-sm font-medium text-ink">
                {format(parseISO(s.date), 'EEE d MMM yyyy', { locale: es })} · {s.start_time.slice(0, 5)}–{s.end_time.slice(0, 5)}
                {s.title ? ` · ${s.title}` : ''}
              </p>
              <p className="text-xs text-subtle">
                {VISIT_TYPE_LABEL[s.visit_type] ?? s.visit_type} · {s.booked_count}/{s.capacity} reservas · {s.location || 'Campus'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={s.is_active ? 'success' : 'neutral'}>{s.is_active ? 'Activo' : 'Inactivo'}</Badge>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => toggleActive.mutate(s)}
                loading={toggleActive.isPending && toggleActive.variables?.id === s.id}
              >
                {s.is_active ? 'Desactivar' : 'Activar'}
              </Button>
              <Button variant="ghost" size="sm" className="text-coral-600" onClick={() => setDeleteFor(s)}>
                Eliminar
              </Button>
            </div>
          </div>
        ))}
      </div>
      )}
      {!!slots?.length && (
        <Pagination page={page} pageSize={ADMIN_PAGE_SIZE} count={count} onChange={setPage} itemLabel="horarios" />
      )}
      <ConfirmDialog
        open={!!deleteFor}
        title="¿Eliminar horario?"
        confirmLabel="Eliminar"
        loading={del.isPending}
        onClose={() => setDeleteFor(null)}
        onConfirm={() => deleteFor && del.mutate(deleteFor.id)}
        message={
          <>
            Se eliminará este horario de forma permanente. Los horarios con
            reservas no pueden eliminarse — use <span className="font-semibold text-ink">Desactivar</span> para ocultarlos sin perder el historial.
          </>
        }
      />
    </>
  );
}

export default function AdminBookings() {
  const qc = useQueryClient();
  // Default to individual visits — matches page copy / slot generator; open_class
  // bookings are still reachable via the type filter.
  const [typeFilter, setTypeFilter] = useState<'individual' | 'open_class' | ''>('individual');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [cancelFor, setCancelFor] = useState<Booking | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin-bookings', typeFilter, statusFilter, page],
    queryFn: async () =>
      toPaged<Booking>(
        (await bookingsApi.getAdminBookings({
          ...(typeFilter ? { type: typeFilter } : {}),
          ...(statusFilter ? { status: statusFilter } : {}),
          page,
        })).data,
      ),
    placeholderData: keepPreviousData,
  });

  const bookings = data?.results;
  const count = data?.count ?? 0;

  const action = useMutation({
    mutationFn: ({ id, act }: { id: number; act: 'confirm' | 'cancel' | 'attended' | 'no_show' }) =>
      bookingsApi.bookingAction(id, act),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-bookings'] });
      toast.success('Reserva actualizada.');
      setCancelFor(null);
    },
    onError: () => toast.error('No fue posible actualizar la reserva.'),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-head text-fluid-xl font-bold leading-tight tracking-[-0.3px] text-ink">Visitas</h1>
        <p className="text-muted text-sm mt-0.5">
          Publique fechas para visitas individuales (/agendar-visita) y Puertas Abiertas (/puertas-abiertas).
        </p>
      </div>

      <Card
        title="Publicar disponibilidad"
        subtitle="Elija el tipo: recorrido individual o evento de clase abierta."
      >
        <SlotGenerator onDone={() => {
          qc.invalidateQueries({ queryKey: ['admin-bookings'] });
          qc.invalidateQueries({ queryKey: ['admin-slots'] });
        }} />
      </Card>

      <Card title="Horarios publicados" subtitle="Active, desactive o elimine los horarios de ambos tipos.">
        <SlotManager />
      </Card>

      <Card
        title="Reservas"
        action={
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            <select
              className="input-field w-full sm:w-auto text-base sm:text-sm py-1.5"
              aria-label="Filtrar por tipo de visita"
              value={typeFilter}
              onChange={(e) => {
                setTypeFilter(e.target.value as 'individual' | 'open_class' | '');
                setPage(1);
              }}
            >
              <option value="individual">Individuales</option>
              <option value="open_class">Puertas Abiertas</option>
              <option value="">Todos los tipos</option>
            </select>
            <select
              className="input-field w-full sm:w-auto text-base sm:text-sm py-1.5"
              aria-label="Filtrar por estado"
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
            >
              <option value="">Todas</option>
              <option value="confirmed">Confirmadas</option>
              <option value="pending">Pendientes</option>
              <option value="attended">Asistió</option>
              <option value="cancelled">Canceladas</option>
              <option value="no_show">No asistió</option>
            </select>
          </div>
        }
      >
        {isError ? (
          <ErrorState onRetry={() => refetch()} />
        ) : isLoading ? (
          <TableSkeleton />
        ) : !bookings?.length ? (
          <EmptyState
            icon={CalendarClock}
            title={(statusFilter || typeFilter) ? 'Sin resultados' : 'Sin reservas'}
            description={(statusFilter || typeFilter)
              ? 'Ninguna reserva coincide con los filtros seleccionados.'
              : 'Las visitas agendadas aparecerán aquí.'}
            action={(statusFilter || typeFilter)
              ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => { setStatusFilter(''); setTypeFilter(''); setPage(1); }}
                >
                  Ver todas
                </Button>
              )
              : undefined}
          />
        ) : (
          <>
            {/* Mobile: stacked cards */}
            <ul className="space-y-3 md:hidden">
              {bookings.map((b) => {
                const meta = statusMeta[b.status] ?? statusMeta.pending;
                return (
                  <li key={b.id} className="rounded-xl2 border border-line p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium text-ink">
                          {format(parseISO(b.slot_date), 'd MMM yyyy', { locale: es })}
                        </p>
                        <p className="text-subtle text-xs">
                          {b.slot_start_time.slice(0, 5)} - {b.slot_end_time.slice(0, 5)}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <Badge variant="neutral">
                          {VISIT_TYPE_LABEL[b.visit_type] ?? b.visit_type}
                        </Badge>
                        <Badge variant={meta.variant}>{meta.label}</Badge>
                      </div>
                    </div>
                    <div className="mt-3 text-sm">
                      <p className="text-muted">{b.parent_name}</p>
                      {b.child_name && (
                        <p className="text-subtle text-xs">Alumno: {b.child_name}</p>
                      )}
                      <p className="text-muted mt-1 break-words">{b.parent_email}</p>
                      <p className="text-subtle text-xs">{b.parent_phone}</p>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-1">
                      <BookingActions
                        booking={b}
                        onAction={action.mutate}
                        onCancelRequest={setCancelFor}
                        pendingAct={action.isPending && action.variables?.id === b.id ? action.variables?.act : undefined}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>

            {/* Desktop: dense table */}
            <div className="admin-table-wrap hidden md:block">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Tipo</th>
                    <th>Tutor</th>
                    <th>Contacto</th>
                    <th>Estado</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {bookings.map((b) => {
                    const meta = statusMeta[b.status] ?? statusMeta.pending;
                    return (
                      <tr key={b.id}>
                        <td className="whitespace-nowrap">
                          <div className="font-medium text-ink">
                            {format(parseISO(b.slot_date), 'd MMM yyyy', { locale: es })}
                          </div>
                          <div className="text-subtle text-xs">
                            {b.slot_start_time.slice(0, 5)} - {b.slot_end_time.slice(0, 5)}
                          </div>
                        </td>
                        <td data-label="Tipo">
                          <Badge variant="neutral">
                            {VISIT_TYPE_LABEL[b.visit_type] ?? b.visit_type}
                          </Badge>
                        </td>
                        <td className="text-muted">
                          {b.parent_name}
                          {b.child_name && (
                            <div className="text-subtle text-xs">Alumno: {b.child_name}</div>
                          )}
                        </td>
                        <td>
                          <div className="text-muted">{b.parent_email}</div>
                          <div className="text-subtle text-xs">{b.parent_phone}</div>
                        </td>
                        <td>
                          <Badge variant={meta.variant}>{meta.label}</Badge>
                        </td>
                        <td>
                          <div className="flex items-center gap-1">
                            <BookingActions
                              booking={b}
                              onAction={action.mutate}
                              onCancelRequest={setCancelFor}
                              pendingAct={action.isPending && action.variables?.id === b.id ? action.variables?.act : undefined}
                            />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}

        <Pagination page={page} pageSize={ADMIN_PAGE_SIZE} count={count} onChange={setPage} itemLabel="reservas" />
      </Card>

      <ConfirmDialog
        open={!!cancelFor}
        title="Cancelar visita"
        confirmLabel="Cancelar visita"
        loading={action.isPending}
        onClose={() => setCancelFor(null)}
        onConfirm={() => cancelFor && action.mutate({ id: cancelFor.id, act: 'cancel' })}
        message={
          cancelFor && (
            <>
              Esto cancelará la visita de{' '}
              <span className="font-semibold text-ink">{cancelFor.parent_name}</span> del{' '}
              <span className="font-semibold text-ink">
                {format(parseISO(cancelFor.slot_date), "d 'de' MMM yyyy", { locale: es })}
              </span>{' '}
              a las {cancelFor.slot_start_time.slice(0, 5)}. Se liberará el cupo y se notificará al tutor.
            </>
          )
        }
      />
    </div>
  );
}
