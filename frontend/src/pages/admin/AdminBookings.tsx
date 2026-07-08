import { useState } from 'react';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { CalendarClock, CalendarPlus, Check, X, UserCheck } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import toast from 'react-hot-toast';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { EmptyState } from '@/components/ui/EmptyState';
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
  const [form, setForm] = useState({
    start_date: '',
    end_date: '',
    window_start: '09:00',
    window_end: '11:00',
    interval_minutes: 30,
    capacity: 1,
    location: 'Campus Interlaken',
  });
  const [weekdays, setWeekdays] = useState<number[]>([1, 2, 3, 4, 5]);

  const mutation = useMutation({
    mutationFn: () =>
      bookingsApi.generateSlots({
        visit_type: 'individual',
        weekdays,
        ...form,
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

  return (
    <form onSubmit={submit} className="space-y-4">
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

      <div>
        <label className="label">Días de la semana</label>
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
          <label className="label">Duración (min)</label>
          <select
            className="input-field"
            value={form.interval_minutes}
            onChange={(e) => setForm({ ...form, interval_minutes: Number(e.target.value) })}
          >
            {[15, 20, 30, 45, 60].map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </div>
        <Input
          label="Cupo por horario"
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
        <CalendarPlus className="w-4 h-4" /> Generar horarios
      </Button>
    </form>
  );
}

type BookingAct = 'confirm' | 'cancel' | 'attended' | 'no_show';

function BookingActions({
  booking,
  onAction,
  onCancelRequest,
}: {
  booking: Booking;
  onAction: (v: { id: number; act: BookingAct }) => void;
  onCancelRequest: (b: Booking) => void;
}) {
  const { id, parent_name: parentName } = booking;
  const base =
    'inline-flex items-center justify-center w-11 h-11 md:w-9 md:h-9 rounded-lg text-subtle transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500';
  return (
    <>
      <button
        title="Marcar asistió"
        aria-label={`Marcar que ${parentName} asistió`}
        onClick={() => onAction({ id, act: 'attended' })}
        className={`${base} hover:bg-brand-50 hover:text-brand-600`}
      >
        <UserCheck className="w-4 h-4" />
      </button>
      <button
        title="Confirmar"
        aria-label={`Confirmar la reserva de ${parentName}`}
        onClick={() => onAction({ id, act: 'confirm' })}
        className={`${base} hover:bg-green-50 hover:text-green-600`}
      >
        <Check className="w-4 h-4" />
      </button>
      <button
        title="Cancelar"
        aria-label={`Cancelar la reserva de ${parentName}`}
        onClick={() => onCancelRequest(booking)}
        className={`${base} hover:bg-coral-50 hover:text-coral-600`}
      >
        <X className="w-4 h-4" />
      </button>
    </>
  );
}

export default function AdminBookings() {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [cancelFor, setCancelFor] = useState<Booking | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['admin-bookings', statusFilter, page],
    queryFn: async () =>
      toPaged<Booking>(
        (await bookingsApi.getAdminBookings({ ...(statusFilter ? { status: statusFilter } : {}), page })).data,
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
        <h1 className="text-fluid-xl font-bold text-ink">Visitas</h1>
        <p className="text-muted text-sm mt-0.5">
          Publique disponibilidad y gestione las visitas individuales.
        </p>
      </div>

      <Card title="Publicar disponibilidad" subtitle="Genere horarios recurrentes para visitas individuales.">
        <SlotGenerator onDone={() => qc.invalidateQueries({ queryKey: ['admin-bookings'] })} />
      </Card>

      <Card
        title="Reservas"
        action={
          <select
            className="input-field text-sm py-1.5"
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
        }
      >
        {isLoading ? (
          <LoadingSpinner />
        ) : !bookings?.length ? (
          <EmptyState
            icon={CalendarClock}
            title="Sin reservas"
            description="Las visitas agendadas aparecerán aquí."
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
                      <Badge variant={meta.variant}>{meta.label}</Badge>
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
                      <BookingActions booking={b} onAction={action.mutate} onCancelRequest={setCancelFor} />
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
                            <BookingActions booking={b} onAction={action.mutate} onCancelRequest={setCancelFor} />
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
