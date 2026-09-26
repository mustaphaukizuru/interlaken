import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Ban, CalendarClock, CalendarPlus, Check, Eye, EyeOff, Loader2, RotateCcw, Trash2, Upload, UserCheck, UserX, X,
  type LucideIcon,
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import toast from 'react-hot-toast';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { parseSort, serializeSort, type SortState } from '@/components/ui/SortableTh';
import { PageHeader } from '@/components/layout/PageHeader';
import { ExportMenu } from '@/components/admin/ExportMenu';
import { FilterBar } from '@/components/admin/FilterBar';
import { BulkActionBar } from '@/components/admin/BulkActionBar';
import { BulkConfirmDialog } from '@/components/admin/BulkConfirmDialog';
import { ImportDialog } from '@/components/admin/ImportDialog';
import { useUrlFilters, useUrlPage } from '@/hooks/useUrlFilters';
import { useRowSelection } from '@/hooks/useRowSelection';
import {
  BOOKINGS_ENTITY, SLOTS_ENTITY, slotsImportApi, useBookingAction, useBookingsBulk, useBookingsExport, useBookingsList,
  useSlotDelete, useSlotsBulk, useSlotsExport, useSlotsList, useSlotUpdate,
} from '@/hooks/queries/bookings';
import { invalidateEntity } from '@/hooks/queries/keys';
import { apiErrorMessage } from '@/lib/apiErrors';
import {
  BOOKING_SOURCE_OPTIONS, BOOKING_STATUS_OPTIONS, VISIT_TYPE_LABEL, VISIT_TYPE_OPTIONS, bookingStatusMeta, canMove,
  type BookingStatus,
} from '@/lib/status/booking';
import { idsParam, type BulkActionDef, type ExportFormat } from '@/services/dataOps';
import { bookingsApi, type AdminBookingsParams, type AdminSlot, type AdminSlotsParams, type BookingAction } from '@/services/api';
import type { Booking } from '@/types';

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

// ── shared bits ───────────────────────────────────────────
const fmtDate = (iso: string) => format(parseISO(iso), 'd MMM yyyy', { locale: es });
const hhmm = (t: string) => (t ?? '').slice(0, 5);
const SOURCE_LABEL = Object.fromEntries(BOOKING_SOURCE_OPTIONS.map((o) => [o.value, o.label]));

const ICON_BTN =
  'inline-flex h-11 w-11 items-center justify-center rounded-lg text-subtle transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40 disabled:cursor-not-allowed disabled:opacity-50 md:h-9 md:w-9';

type View = 'reservas' | 'horarios';

/** `BulkActionDef.icon` is typed narrower than lucide's `size: number | string`; the bar only passes numbers. */
const bulkIcon = (icon: LucideIcon) => icon as unknown as BulkActionDef['icon'];

/** Note prompt for the reverse moves (reabrir, corregir asistencia): the server audits it. */
function NoteDialog({
  open, title, message, confirmLabel, loading, onConfirm, onClose,
}: {
  open: boolean; title: string; message: string; confirmLabel: string; loading: boolean;
  onConfirm: (note: string) => void; onClose: () => void;
}) {
  const [note, setNote] = useState('');
  const close = () => { setNote(''); onClose(); };
  return (
    <Modal open={open} onClose={close} title={title} maxWidth={460}>
      <form
        className="space-y-4"
        onSubmit={(e) => { e.preventDefault(); if (note.trim().length >= 3) onConfirm(note.trim()); }}
      >
        <p className="text-sm text-muted">{message}</p>
        <div>
          <label className="label" htmlFor="booking-note">Motivo (queda en la bitácora)</label>
          <textarea
            id="booking-note"
            className="input-field min-h-[88px] text-base"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            required
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={close}>Volver</Button>
          <Button type="submit" loading={loading} disabled={note.trim().length < 3}>{confirmLabel}</Button>
        </div>
      </form>
    </Modal>
  );
}

// ── Reservas ──────────────────────────────────────────────
const BOOKING_COLUMNS: Column<Booking>[] = [
  {
    id: 'date', header: 'Fecha', sortKey: 'date', hideable: false, minWidth: 130, className: 'whitespace-nowrap',
    cell: (b) => (
      <>
        <div className="font-medium text-ink">{fmtDate(b.slot_date)}</div>
        <div className="text-xs text-subtle">{hhmm(b.slot_start_time)} - {hhmm(b.slot_end_time)}</div>
      </>
    ),
  },
  { id: 'type', header: 'Tipo', minWidth: 130, cell: (b) => <Badge variant="neutral">{VISIT_TYPE_LABEL[b.visit_type] ?? b.visit_type}</Badge> },
  { id: 'parent', header: 'Tutor', sortKey: 'parent', hideable: false, minWidth: 160, className: 'text-ink', cell: (b) => b.parent_name },
  {
    id: 'child', header: 'Alumno', sortKey: 'child', minWidth: 140, className: 'text-muted',
    cell: (b) => (
      <>
        {b.child_name || '—'}
        {b.child_grade && <div className="text-xs text-subtle">{b.child_grade}</div>}
      </>
    ),
  },
  {
    id: 'contact', header: 'Contacto', minWidth: 190,
    cell: (b) => (
      <>
        <div className="break-words text-muted">{b.parent_email}</div>
        <div className="text-xs text-subtle">{b.parent_phone}</div>
      </>
    ),
  },
  { id: 'attendees', header: 'Asistentes', sortKey: 'attendees', align: 'right', minWidth: 100, className: 'tabular-nums', cell: (b) => b.num_attendees },
  {
    id: 'status', header: 'Estado', sortKey: 'status', minWidth: 120,
    cell: (b) => { const m = bookingStatusMeta(b.status); return <Badge variant={m.variant}>{m.label}</Badge>; },
  },
  { id: 'source', header: 'Origen', defaultHidden: true, minWidth: 120, className: 'text-muted', cell: (b) => SOURCE_LABEL[b.source] ?? b.source },
  {
    id: 'created_at', header: 'Registrada', sortKey: 'created_at', defaultHidden: true, minWidth: 150, className: 'whitespace-nowrap text-muted',
    cell: (b) => new Date(b.created_at).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' }),
  },
];

const BOOKING_BULK: BulkActionDef[] = [
  { name: 'confirm', label: 'Confirmar', icon: bulkIcon(Check), notifyOption: true, planVerb: 'Se confirmarán' },
  { name: 'attended', label: 'Asistió', icon: bulkIcon(UserCheck), planVerb: 'Se registrará la asistencia de' },
  { name: 'no_show', label: 'No asistió', icon: bulkIcon(UserX), planVerb: 'Se registrará la inasistencia de' },
  { name: 'cancel', label: 'Cancelar', icon: bulkIcon(Ban), danger: true, planVerb: 'Se cancelarán' },
];

interface NoteAsk { booking: Booking; act: BookingAction; title: string; message: string; confirmLabel: string }

/** Row actions: only the moves the transition table allows from the row's status. */
function BookingRowActions({
  booking, busyAct, onAct, onCancel, onNote,
}: {
  booking: Booking;
  busyAct?: BookingAction;
  onAct: (b: Booking, act: BookingAction) => void;
  onCancel: (b: Booking) => void;
  onNote: (ask: NoteAsk) => void;
}) {
  const s = booking.status as BookingStatus;
  const who = booking.parent_name;
  const busy = busyAct !== undefined;
  const icon = (act: BookingAction, Icon: typeof Check) =>
    busyAct === act ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Icon className="h-4 w-4" aria-hidden="true" />;
  return (
    <div className="flex items-center gap-1">
      {canMove(s, 'confirmed') && (
        <button type="button" title="Confirmar" aria-label={`Confirmar la reserva de ${who}`} disabled={busy}
          onClick={() => onAct(booking, 'confirm')} className={`${ICON_BTN} hover:bg-green-50 hover:text-green-600`}>
          {icon('confirm', Check)}
        </button>
      )}
      {canMove(s, 'attended') && (
        <button type="button" title="Asistió" aria-label={`Marcar que ${who} asistió`} disabled={busy}
          onClick={() => (s === 'no_show'
            ? onNote({ booking, act: 'attended', title: 'Corregir: sí asistió', confirmLabel: 'Marcar asistió', message: `La visita de ${who} está marcada como «No asistió». Indique por qué se corrige.` })
            : onAct(booking, 'attended'))}
          className={`${ICON_BTN} hover:bg-brand-50 hover:text-brand-600`}>
          {icon('attended', UserCheck)}
        </button>
      )}
      {canMove(s, 'no_show') && (
        <button type="button" title="No asistió" aria-label={`Marcar que ${who} no asistió`} disabled={busy}
          onClick={() => (s === 'attended'
            ? onNote({ booking, act: 'no_show', title: 'Corregir: no asistió', confirmLabel: 'Marcar no asistió', message: `La visita de ${who} está marcada como «Asistió». Indique por qué se corrige.` })
            : onAct(booking, 'no_show'))}
          className={`${ICON_BTN} hover:bg-coral-50 hover:text-coral-600`}>
          {icon('no_show', UserX)}
        </button>
      )}
      {canMove(s, 'cancelled') && (
        <button type="button" title="Cancelar" aria-label={`Cancelar la reserva de ${who}`} disabled={busy}
          onClick={() => onCancel(booking)} className={`${ICON_BTN} hover:bg-coral-50 hover:text-coral-600`}>
          {icon('cancel', X)}
        </button>
      )}
      {canMove(s, 'pending') && (
        <button type="button" title="Reabrir" aria-label={`Reabrir la reserva de ${who}`} disabled={busy}
          onClick={() => onNote({ booking, act: 'reopen', title: 'Reabrir reserva', confirmLabel: 'Reabrir', message: `La reserva de ${who} volverá a «Pendiente» si el horario aún tiene cupo para ${booking.num_attendees} persona(s).` })}
          className={`${ICON_BTN} hover:bg-brand-50 hover:text-brand-600`}>
          {icon('reopen', RotateCcw)}
        </button>
      )}
    </div>
  );
}

function BookingsView() {
  const [page, setPage] = useUrlPage();
  const { get, set } = useUrlFilters();
  const sort = parseSort(get('orden'));
  const filters: Omit<AdminBookingsParams, 'page'> = {
    q: get('q') || undefined,
    status: get('estado') || undefined,
    type: get('tipo') || undefined,
    source: get('origen') || undefined,
    from: get('desde') || undefined,
    to: get('hasta') || undefined,
    ordering: serializeSort(sort) || undefined,
  };
  const filterKey = JSON.stringify(filters);

  const { data, isLoading, isError, refetch } = useBookingsList({ page, ...filters });
  const rows = data?.results ?? [];
  const count = data?.count ?? 0;
  const selection = useRowSelection(count, filterKey);
  const exporter = useBookingsExport();
  const bulk = useBookingsBulk();
  const action = useBookingAction();
  const [bulkAction, setBulkAction] = useState<BulkActionDef | null>(null);
  const [cancelFor, setCancelFor] = useState<Booking | null>(null);
  const [noteAsk, setNoteAsk] = useState<NoteAsk | null>(null);

  const onSort = (next: SortState) => set({ orden: serializeSort(next), page: null });
  const fetchExport = (fmt: ExportFormat, { selectedOnly }: { selectedOnly: boolean }) =>
    exporter.mutateAsync({ ...filters, fmt, ids: selectedOnly && !selection.allMatching ? idsParam(selection.ids) : undefined });

  const act = (b: Booking, a: BookingAction, note?: string) =>
    action.mutate({ id: b.id, act: a, note }, {
      onSuccess: () => { toast.success('Reserva actualizada.'); setCancelFor(null); setNoteAsk(null); },
      onError: (e) => toast.error(apiErrorMessage(e, 'No fue posible actualizar la reserva.')),
    });

  return (
    <Card title={`${count.toLocaleString('es-MX')} reservas`}
      action={<ExportMenu filenamePrefix="visitas" selectedCount={selection.count} fetch={fetchExport} />}>
      <DataTable<Booking>
        tableId="bookings"
        caption="Reservas de visitas"
        columns={BOOKING_COLUMNS}
        rows={rows}
        rowKey={(b) => b.id}
        rowLabel={(b) => `reserva de ${b.parent_name} del ${fmtDate(b.slot_date)}`}
        rowClassName={(b) => (b.status === 'cancelled' ? 'opacity-60' : '')}
        sort={sort}
        onSort={onSort}
        page={page}
        count={count}
        onPage={setPage}
        itemLabel="reservas"
        isLoading={isLoading}
        isError={isError}
        onRetry={() => refetch()}
        columnControls
        resizable
        pinFirstColumn
        selection={selection}
        rowActions={(b) => (
          <BookingRowActions
            booking={b}
            busyAct={action.isPending && action.variables?.id === b.id ? action.variables.act : undefined}
            onAct={act}
            onCancel={setCancelFor}
            onNote={setNoteAsk}
          />
        )}
        toolbar={(
          <FilterBar
            search={{ placeholder: 'Tutor, correo, teléfono o alumno…', label: 'Buscar reservas' }}
            tabs={{ paramKey: 'estado', options: BOOKING_STATUS_OPTIONS, allLabel: 'Todas', label: 'Filtrar por estado' }}
            selects={[
              { key: 'tipo', label: 'Tipo de visita', options: VISIT_TYPE_OPTIONS, allLabel: 'Todos los tipos' },
              { key: 'origen', label: 'Origen', options: BOOKING_SOURCE_OPTIONS, allLabel: 'Todos los orígenes' },
            ]}
            dateRange={{ idPrefix: 'visitas', label: 'Fecha de la visita' }}
          />
        )}
        bulkBar={(
          <BulkActionBar
            count={selection.count}
            allMatching={selection.allMatching}
            allMatchingCount={count}
            onSelectAllMatching={selection.onSelectAllMatching}
            onClear={selection.onClear}
            itemLabel="reservas"
            actions={BOOKING_BULK}
            onAction={setBulkAction}
            busy={bulk.isPending}
            exportMenu={<ExportMenu label="Exportar seleccionadas" filenamePrefix="visitas" selectedCount={selection.count} forceSelected fetch={fetchExport} />}
          />
        )}
        empty={{ icon: CalendarClock, title: 'Sin reservas', description: 'Ninguna reserva coincide con los filtros. Las visitas agendadas aparecerán aquí.' }}
      />

      <BulkConfirmDialog
        open={!!bulkAction}
        onClose={() => setBulkAction(null)}
        action={bulkAction}
        entityLabel="reservas"
        ids={selection.ids}
        allMatching={selection.allMatching}
        filters={filters}
        execute={(body) => bulk.mutateAsync(body)}
        onDone={(r) => { if (r.ok) selection.onClear(); }}
      />

      <ConfirmDialog
        open={!!cancelFor}
        title="Cancelar visita"
        confirmLabel="Cancelar visita"
        loading={action.isPending}
        onClose={() => setCancelFor(null)}
        onConfirm={() => cancelFor && act(cancelFor, 'cancel')}
        message={cancelFor && (
          <>
            Esto cancelará la visita de <span className="font-semibold text-ink">{cancelFor.parent_name}</span> del{' '}
            <span className="font-semibold text-ink">{format(parseISO(cancelFor.slot_date), "d 'de' MMM yyyy", { locale: es })}</span>{' '}
            a las {hhmm(cancelFor.slot_start_time)} y liberará el cupo.
          </>
        )}
      />

      <NoteDialog
        // A fresh note per booking and move: never carry the last motive over.
        key={noteAsk ? `${noteAsk.booking.id}-${noteAsk.act}` : 'closed'}
        open={!!noteAsk}
        title={noteAsk?.title ?? ''}
        message={noteAsk?.message ?? ''}
        confirmLabel={noteAsk?.confirmLabel ?? 'Guardar'}
        loading={action.isPending}
        onClose={() => setNoteAsk(null)}
        onConfirm={(note) => noteAsk && act(noteAsk.booking, noteAsk.act, note)}
      />
    </Card>
  );
}

// ── Horarios ──────────────────────────────────────────────
const SLOT_COLUMNS: Column<AdminSlot>[] = [
  {
    id: 'date', header: 'Fecha', sortKey: 'date', hideable: false, minWidth: 130, className: 'whitespace-nowrap font-medium text-ink',
    cell: (s) => format(parseISO(s.date), 'EEE d MMM yyyy', { locale: es }),
  },
  { id: 'start', header: 'Horario', sortKey: 'start', minWidth: 110, className: 'whitespace-nowrap tabular-nums', cell: (s) => `${hhmm(s.start_time)}–${hhmm(s.end_time)}` },
  { id: 'type', header: 'Tipo', sortKey: 'type', minWidth: 130, cell: (s) => <Badge variant="neutral">{VISIT_TYPE_LABEL[s.visit_type] ?? s.visit_type}</Badge> },
  { id: 'title', header: 'Evento', minWidth: 140, className: 'text-muted', cell: (s) => s.title || '—' },
  { id: 'location', header: 'Lugar', minWidth: 140, className: 'text-muted', cell: (s) => s.location || '—' },
  { id: 'capacity', header: 'Cupo', sortKey: 'capacity', align: 'right', minWidth: 80, className: 'tabular-nums', cell: (s) => s.capacity },
  {
    id: 'booked', header: 'Reservados', sortKey: 'booked', align: 'right', minWidth: 110, className: 'tabular-nums',
    cell: (s) => <span className={s.is_full ? 'font-semibold text-coral-700' : ''}>{s.booked_count}/{s.capacity}</span>,
  },
  {
    id: 'active', header: 'Estado', minWidth: 100,
    cell: (s) => <Badge variant={s.is_active ? 'success' : 'neutral'}>{s.is_active ? 'Activo' : 'Inactivo'}</Badge>,
  },
];

const SLOT_BULK: BulkActionDef[] = [
  { name: 'activate', label: 'Activar', icon: bulkIcon(Eye), planVerb: 'Se activarán' },
  { name: 'deactivate', label: 'Desactivar', icon: bulkIcon(EyeOff), planVerb: 'Se desactivarán' },
  { name: 'delete', label: 'Eliminar', icon: bulkIcon(Trash2), danger: true, planVerb: 'Se eliminarán' },
];

const ACTIVE_OPTIONS = [
  { value: 'true', label: 'Activos' },
  { value: 'false', label: 'Inactivos' },
];

const IMPORT_HEADERS = [
  { key: 'tipo', required: true },
  { key: 'fecha', required: true },
  { key: 'inicio', required: true },
  { key: 'fin', required: true },
  { key: 'cupo', required: true },
  { key: 'lugar' },
  { key: 'titulo' },
];

function SlotsView() {
  const qc = useQueryClient();
  const [page, setPage] = useUrlPage();
  const { get, set } = useUrlFilters();
  const sort = parseSort(get('orden'));
  const active = get('activo');
  const filters: Omit<AdminSlotsParams, 'page'> = {
    q: get('q') || undefined,
    type: get('tipo') || undefined,
    active: active === 'true' || active === 'false' ? active : undefined,
    from: get('desde') || undefined,
    to: get('hasta') || undefined,
    ordering: serializeSort(sort) || undefined,
  };
  const filterKey = JSON.stringify(filters);

  const { data, isLoading, isError, refetch } = useSlotsList({ page, ...filters });
  const rows = data?.results ?? [];
  const count = data?.count ?? 0;
  const selection = useRowSelection(count, filterKey);
  const exporter = useSlotsExport();
  const bulk = useSlotsBulk();
  const update = useSlotUpdate();
  const del = useSlotDelete();
  const [bulkAction, setBulkAction] = useState<BulkActionDef | null>(null);
  const [deleteFor, setDeleteFor] = useState<AdminSlot | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const onSort = (next: SortState) => set({ orden: serializeSort(next), page: null });
  const fetchExport = (fmt: ExportFormat, { selectedOnly }: { selectedOnly: boolean }) =>
    exporter.mutateAsync({ ...filters, fmt, ids: selectedOnly && !selection.allMatching ? idsParam(selection.ids) : undefined });

  const toggle = (s: AdminSlot) =>
    update.mutate({ id: s.id, is_active: !s.is_active }, {
      onSuccess: () => toast.success(s.is_active ? 'Horario desactivado.' : 'Horario activado.'),
      onError: (e) => toast.error(apiErrorMessage(e, 'No se pudo actualizar el horario.')),
    });
  const remove = (s: AdminSlot) =>
    del.mutate(s.id, {
      onSuccess: () => { toast.success('Horario eliminado.'); setDeleteFor(null); },
      onError: (e) => { toast.error(apiErrorMessage(e, 'No se pudo eliminar el horario.')); setDeleteFor(null); },
    });

  return (
    <>
      <Card title="Publicar disponibilidad" subtitle="Elija el tipo: recorrido individual o evento de clase abierta.">
        <SlotGenerator onDone={() => { void invalidateEntity(qc, SLOTS_ENTITY, [BOOKINGS_ENTITY]); }} />
      </Card>

      <Card
        title={`${count.toLocaleString('es-MX')} horarios publicados`}
        subtitle="Active, desactive, elimine o cargue horarios desde un archivo."
        action={(
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => setImportOpen(true)}>
              <Upload className="h-3.5 w-3.5" aria-hidden="true" /> Cargar horarios
            </Button>
            <ExportMenu filenamePrefix="horarios_visita" selectedCount={selection.count} fetch={fetchExport} />
          </div>
        )}
      >
        <DataTable<AdminSlot>
          tableId="booking-slots"
          caption="Horarios de visita publicados"
          columns={SLOT_COLUMNS}
          rows={rows}
          rowKey={(s) => s.id}
          rowLabel={(s) => `horario del ${fmtDate(s.date)} a las ${hhmm(s.start_time)}`}
          rowClassName={(s) => (s.is_active ? '' : 'opacity-60')}
          sort={sort}
          onSort={onSort}
          page={page}
          count={count}
          onPage={setPage}
          itemLabel="horarios"
          isLoading={isLoading}
          isError={isError}
          onRetry={() => refetch()}
          columnControls
          resizable
          pinFirstColumn
          selection={selection}
          rowActions={(s) => (
            <div className="flex items-center gap-1">
              <button type="button" title={s.is_active ? 'Desactivar' : 'Activar'}
                aria-label={`${s.is_active ? 'Desactivar' : 'Activar'} el horario del ${fmtDate(s.date)} a las ${hhmm(s.start_time)}`}
                disabled={update.isPending && update.variables?.id === s.id}
                onClick={() => toggle(s)} className={`${ICON_BTN} hover:bg-brand-50 hover:text-brand-600`}>
                {update.isPending && update.variables?.id === s.id
                  ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  : s.is_active ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
              </button>
              <button type="button" title="Eliminar"
                aria-label={`Eliminar el horario del ${fmtDate(s.date)} a las ${hhmm(s.start_time)}`}
                onClick={() => setDeleteFor(s)} className={`${ICON_BTN} hover:bg-coral-50 hover:text-coral-600`}>
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          )}
          toolbar={(
            <FilterBar
              search={{ placeholder: 'Evento o lugar…', label: 'Buscar horarios' }}
              tabs={{ paramKey: 'activo', options: ACTIVE_OPTIONS, allLabel: 'Todos', label: 'Filtrar por estado' }}
              selects={[{ key: 'tipo', label: 'Tipo de visita', options: VISIT_TYPE_OPTIONS, allLabel: 'Todos los tipos' }]}
              dateRange={{ idPrefix: 'horarios', label: 'Fecha del horario' }}
            />
          )}
          bulkBar={(
            <BulkActionBar
              count={selection.count}
              allMatching={selection.allMatching}
              allMatchingCount={count}
              onSelectAllMatching={selection.onSelectAllMatching}
              onClear={selection.onClear}
              itemLabel="horarios"
              gender="m"
              actions={SLOT_BULK}
              onAction={setBulkAction}
              busy={bulk.isPending}
              exportMenu={<ExportMenu label="Exportar seleccionados" filenamePrefix="horarios_visita" selectedCount={selection.count} forceSelected fetch={fetchExport} />}
            />
          )}
          empty={{ icon: CalendarClock, title: 'Sin horarios', description: 'Genere disponibilidad con el formulario de arriba o cargue un archivo.' }}
        />
      </Card>

      <BulkConfirmDialog
        open={!!bulkAction}
        onClose={() => setBulkAction(null)}
        action={bulkAction}
        entityLabel="horarios"
        gender="m"
        ids={selection.ids}
        allMatching={selection.allMatching}
        filters={filters}
        execute={(body) => bulk.mutateAsync(body)}
        onDone={(r) => { if (r.ok) selection.onClear(); }}
      />

      <ConfirmDialog
        open={!!deleteFor}
        title="¿Eliminar horario?"
        confirmLabel="Eliminar"
        loading={del.isPending}
        onClose={() => setDeleteFor(null)}
        onConfirm={() => deleteFor && remove(deleteFor)}
        message={(
          <>
            Se eliminará este horario de forma permanente. Los horarios con reservas no pueden eliminarse: use{' '}
            <span className="font-semibold text-ink">Desactivar</span> para ocultarlos sin perder el historial.
          </>
        )}
      />

      <ImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        title="Cargar horarios de visita"
        entity={SLOTS_ENTITY}
        related={[BOOKINGS_ENTITY]}
        api={slotsImportApi}
        headers={IMPORT_HEADERS}
        templatePrefix="plantilla_horarios"
        description={(
          <>
            Una fila por horario: <strong>tipo</strong> (individual o puertas abiertas), <strong>fecha</strong> (DD/MM/AAAA),{' '}
            <strong>inicio</strong> y <strong>fin</strong> (HH:MM), <strong>cupo</strong>, <strong>lugar</strong> y, opcional,{' '}
            <strong>titulo</strong>. Un horario que ya existe (mismo tipo, fecha y horas) se actualiza; nunca se duplica.
          </>
        )}
      />
    </>
  );
}

// ── page ──────────────────────────────────────────────────
const VIEWS: { value: View; label: string }[] = [
  { value: 'reservas', label: 'Reservas' },
  { value: 'horarios', label: 'Horarios' },
];

/**
 * /admin/visitas — reservas and published horarios on the Data Ops contracts:
 * every filter, the sort, the page and the view live in the URL (`?vista=`),
 * DataTable v2 with column controls, selection + bulk actions, CSV / Excel /
 * PDF export and, for horarios, the file import.
 */
export default function AdminBookings() {
  const { get, set, params } = useUrlFilters();
  const view: View = get('vista') === 'horarios' ? 'horarios' : 'reservas';
  // A view switch starts clean: the two lists do not share filters.
  const switchTo = (next: View) => {
    if (next === view) return;
    const cleared: Record<string, null | string> = {};
    params.forEach((_v, k) => { cleared[k] = null; });
    set({ ...cleared, vista: next === 'reservas' ? null : next });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Visitas"
        subtitle="Reservas de visitas individuales (/agendar-visita) y Puertas Abiertas (/puertas-abiertas), y los horarios publicados."
      />
      <div role="tablist" aria-label="Vista" className="inline-flex rounded-xl2 border border-line bg-white p-1">
        {VIEWS.map((t) => (
          <button
            key={t.value}
            type="button"
            role="tab"
            aria-selected={view === t.value}
            onClick={() => switchTo(t.value)}
            className={`min-h-[44px] rounded-lg px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40 ${
              view === t.value ? 'bg-purple text-white' : 'text-muted hover:text-ink'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {view === 'reservas' ? <BookingsView /> : <SlotsView />}
    </div>
  );
}
