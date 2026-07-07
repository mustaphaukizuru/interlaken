import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
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
import { bookingsApi } from '@/services/api';
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
                  : 'border-slate-200 text-slate-600 hover:border-brand-400'
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

export default function AdminBookings() {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('');

  const { data: bookings, isLoading } = useQuery<Booking[]>({
    queryKey: ['admin-bookings', statusFilter],
    queryFn: async () => {
      const { data } = await bookingsApi.getAdminBookings(
        statusFilter ? { status: statusFilter } : undefined,
      );
      return data.results ?? data;
    },
  });

  const action = useMutation({
    mutationFn: ({ id, act }: { id: number; act: 'confirm' | 'cancel' | 'attended' | 'no_show' }) =>
      bookingsApi.bookingAction(id, act),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-bookings'] });
      toast.success('Reserva actualizada.');
    },
    onError: () => toast.error('No fue posible actualizar la reserva.'),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Visitas</h1>
        <p className="text-slate-500 text-sm mt-0.5">
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
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
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
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="text-left py-2 pr-4 text-xs font-semibold text-slate-500">Fecha</th>
                  <th className="text-left py-2 pr-4 text-xs font-semibold text-slate-500">Tutor</th>
                  <th className="text-left py-2 pr-4 text-xs font-semibold text-slate-500">Contacto</th>
                  <th className="text-left py-2 pr-4 text-xs font-semibold text-slate-500">Estado</th>
                  <th className="text-left py-2 text-xs font-semibold text-slate-500">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {bookings.map((b) => {
                  const meta = statusMeta[b.status] ?? statusMeta.pending;
                  return (
                    <tr key={b.id} className="hover:bg-slate-50/50">
                      <td className="py-3 pr-4 whitespace-nowrap">
                        <div className="font-medium text-slate-900">
                          {format(parseISO(b.slot_date), 'd MMM yyyy', { locale: es })}
                        </div>
                        <div className="text-slate-400 text-xs">
                          {b.slot_start_time.slice(0, 5)} - {b.slot_end_time.slice(0, 5)}
                        </div>
                      </td>
                      <td className="py-3 pr-4 text-slate-700">
                        {b.parent_name}
                        {b.child_name && (
                          <div className="text-slate-400 text-xs">Alumno: {b.child_name}</div>
                        )}
                      </td>
                      <td className="py-3 pr-4">
                        <div className="text-slate-500">{b.parent_email}</div>
                        <div className="text-slate-400 text-xs">{b.parent_phone}</div>
                      </td>
                      <td className="py-3 pr-4">
                        <Badge variant={meta.variant}>{meta.label}</Badge>
                      </td>
                      <td className="py-3">
                        <div className="flex items-center gap-1">
                          <button
                            title="Marcar asistió"
                            onClick={() => action.mutate({ id: b.id, act: 'attended' })}
                            className="p-1.5 rounded-lg text-slate-400 hover:bg-brand-50 hover:text-brand-600 transition-colors"
                          >
                            <UserCheck className="w-4 h-4" />
                          </button>
                          <button
                            title="Confirmar"
                            onClick={() => action.mutate({ id: b.id, act: 'confirm' })}
                            className="p-1.5 rounded-lg text-slate-400 hover:bg-green-50 hover:text-green-600 transition-colors"
                          >
                            <Check className="w-4 h-4" />
                          </button>
                          <button
                            title="Cancelar"
                            onClick={() => action.mutate({ id: b.id, act: 'cancel' })}
                            className="p-1.5 rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600 transition-colors"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
