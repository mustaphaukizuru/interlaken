import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, ChevronLeft, ChevronRight, MessageCircle, MoveRight, ClipboardCheck, FolderOpen, PenLine } from 'lucide-react';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Badge } from '@/components/ui/Badge';
import { ListSkeleton } from '@/components/ui/ListSkeleton';
import { ErrorState } from '@/components/ui/ErrorState';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { BOOKINGS_ENTITY, SLOTS_ENTITY } from '@/hooks/queries/bookings';
import { invalidateEntity } from '@/hooks/queries/keys';
import { bookingsApi, type WeekBooking, type WeekSlot } from '@/services/api';
import { apiFieldErrors } from '@/lib/apiErrors';
import { BOOKING_STATUS_META, type BookingStatus } from '@/lib/status/booking';
import { stageMeta } from '@/lib/caseStages';
import { canOpen } from '@/lib/areas';
import { useAuthStore } from '@/store/authStore';
import { useExamsWeek, type ExamItem } from '@/hooks/queries/cases';

const DAY_NAMES = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const OUTCOMES: [string, string][] = [['interested', 'Interesada, dar seguimiento'], ['enrolling', 'Se inscribirá'], ['not_now', 'No por ahora'], ['declined', 'No le interesó']];

/** Local calendar date (YYYY-MM-DD). toISOString() is UTC: in Mexico it
 *  already reads "tomorrow" from 18:00, which mislabeled today and the week. */
export const localISODate = (d: Date): string => format(d, 'yyyy-MM-dd');

/** Monday of the week containing `d` (ISO date, local time). */
export function mondayOf(d: Date): string {
  const x = new Date(d);
  const day = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - day);
  return localISODate(x);
}
export function shiftWeek(iso: string, weeks: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + weeks * 7);
  return localISODate(d);
}
/** Sunday of the week that starts on `monday`. */
export function weekEnd(monday: string): string {
  const d = new Date(`${monday}T12:00:00`);
  d.setDate(d.getDate() + 6);
  return localISODate(d);
}

const EXAM_RESULT: Record<string, string> = { aceptado: 'Aceptado', no_aceptado: 'No aceptado' };

/**
 * /admin/visitas/semana — weekly calendar, reschedule and post-visit outcome
 * (BACKLOG P4-2), with the week's admission exams (Fase 5) in the same grid
 * for accounts that see Admisiones. Visits and exams open their Expediente.
 */
export default function AdminVisitsWeek() {
  const qc = useQueryClient();
  const [start, setStart] = useState(() => mondayOf(new Date()));
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['visits-week', start], queryFn: async () => (await bookingsApi.adminWeek(start)).data });
  const seesAdmissions = useAuthStore((s) => canOpen(s.user, '/admin/admisiones'));
  const exams = useExamsWeek(start, weekEnd(start), seesAdmissions);
  const examsByDay = new Map<string, ExamItem[]>((exams.data?.days ?? []).map((d) => [d.date, d.exams]));
  const [moving, setMoving] = useState<WeekBooking | null>(null);
  const [outcomeFor, setOutcomeFor] = useState<WeekBooking | null>(null);
  const [outcome, setOutcome] = useState('interested');
  const [note, setNote] = useState('');
  const [targetSlot, setTargetSlot] = useState<number | null>(null);
  const [noShowFor, setNoShowFor] = useState<WeekBooking | null>(null);
  // The bookings/slots lists live under ['admin', 'bookings' | 'slots', ...].
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['visits-week'] });
    void invalidateEntity(qc, BOOKINGS_ENTITY, [SLOTS_ENTITY]);
    qc.invalidateQueries({ queryKey: ['badges'] });
  };
  const reschedule = useMutation({
    mutationFn: () => bookingsApi.adminReschedule(moving!.id, targetSlot!),
    onSuccess: () => { toast.success('Visita reprogramada; se avisó a la familia.'); setMoving(null); invalidate(); },
    onError: (e) => { const f = apiFieldErrors(e); toast.error(f.slot || f.detail || 'No se pudo reprogramar.'); },
  });
  const setOutcomeM = useMutation({
    mutationFn: () => bookingsApi.adminOutcome(outcomeFor!.id, { outcome, note }),
    onSuccess: ({ data: r }) => {
      const pr = r.pre_registration;
      const label = pr ? stageMeta(pr.stage ?? '').label : '';
      toast.success(!pr ? 'Resultado guardado.' : pr.changed ? `Resultado guardado; expediente en «${label}».` : pr.skipped ? `Resultado guardado. ${pr.skipped}` : `Resultado guardado; el expediente sigue en «${label}».`);
      setOutcomeFor(null); setNote(''); invalidate();
    },
    onError: (e) => toast.error(apiFieldErrors(e).detail || 'No se pudo guardar.'),
  });
  const action = useMutation({
    mutationFn: ({ id, act }: { id: number; act: 'no_show' }) => bookingsApi.bookingAction(id, act),
    onSuccess: () => { toast.success('Visita marcada como «No asistió».'); setNoShowFor(null); invalidate(); },
    onError: (e) => { setNoShowFor(null); toast.error(apiFieldErrors(e).detail || 'No se pudo actualizar.'); },
  });
  const today = localISODate(new Date());
  const nowKey = format(new Date(), "yyyy-MM-dd'T'HH:mm");
  const allSlots: WeekSlot[] = data?.days.flatMap((d) => d.slots.map((s) => ({ ...s, date: d.date }))) ?? [];
  const weekLabel = data ? `${new Date(`${data.start}T12:00:00`).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })} al ${new Date(`${data.end}T12:00:00`).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}` : '';

  return (
    <>
      <PageHeader title="Visitas · semana" subtitle={seesAdmissions
        ? 'Agenda semanal de visitas y exámenes de admisión. Reprograme con un clic y registre el resultado al terminar.'
        : 'Agenda semanal de clases abiertas y visitas individuales. Reprograme con un clic y registre el resultado al terminar.'}
        actions={<Link to="/admin/visitas" className="btn-outline">Lista de visitas</Link>} />
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="inline-flex items-center gap-1">
          <Button size="sm" variant="ghost" onClick={() => setStart((s) => shiftWeek(s, -1))} aria-label="Semana anterior"><ChevronLeft size={16} /></Button>
          <Button size="sm" variant="secondary" onClick={() => setStart(mondayOf(new Date()))}>Hoy</Button>
          <Button size="sm" variant="ghost" onClick={() => setStart((s) => shiftWeek(s, 1))} aria-label="Semana siguiente"><ChevronRight size={16} /></Button>
        </div>
        <span className="inline-flex items-center gap-1 text-sm font-semibold text-ink"><CalendarDays size={16} className="text-purple" aria-hidden="true" /> {weekLabel}</span>
      </div>
      {seesAdmissions && (
        <ul className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted" aria-label="Simbología">
          <li className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded border border-subtle/50 bg-white" aria-hidden="true" /> Visita</li>
          <li className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded border border-pink/40 bg-pink-light" aria-hidden="true" /> <PenLine size={12} className="text-pink-dark" aria-hidden="true" /> Examen de admisión</li>
          {exams.isError && <li className="text-coral-700" role="status">No se pudieron cargar los exámenes.</li>}
        </ul>
      )}
      {isError ? <ErrorState onRetry={() => refetch()} /> : isLoading || !data ? <ListSkeleton /> : (
        <div className="-mx-4 px-4 pb-4 md:overflow-x-auto">
          <div className="grid grid-cols-1 gap-2 md:min-w-[980px] md:grid-cols-7" role="list" aria-label="Días de la semana">
            {data.days.map((d, i) => {
              const isToday = d.date === today;
              return (
                <section key={d.date} role="listitem" className={`rounded-xl2 p-2 ${isToday ? 'bg-purple/5 ring-1 ring-purple/30' : 'bg-cream-2'}`} aria-label={`${DAY_NAMES[i]} ${d.date}`}>
                  <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-subtle">{DAY_NAMES[i]} <span className="text-ink">{Number(d.date.slice(8))}</span></h2>
                  {d.slots.length === 0 && !(examsByDay.get(d.date)?.length) && <p className="text-[11px] text-subtle">Sin horarios</p>}
                  <ul className="space-y-2">
                    {d.slots.map((s) => (
                      <li key={s.id} className={`rounded-xl border bg-white p-2 text-xs ${s.is_active ? 'border-line' : 'border-dashed border-line opacity-60'}`}>
                        <p className="font-semibold text-ink">{s.start_time}–{s.end_time} <span className="font-normal text-subtle">· {s.visit_type === 'open_class' ? 'Clase abierta' : 'Individual'} · {s.booked}/{s.capacity}</span></p>
                        {s.title && <p className="truncate text-subtle">{s.title}</p>}
                        <ul className="mt-1 space-y-1">
                          {s.bookings.map((b) => (
                            <li key={b.id} className="rounded-lg bg-cream-2 p-1.5">
                              <div className="flex items-center justify-between gap-1">
                                <span className="truncate font-medium text-ink">{b.parent_name}{b.child_name ? ` · ${b.child_name}` : ''}</span>
                                <Badge variant={BOOKING_STATUS_META[b.status as BookingStatus]?.variant ?? 'neutral'}>{BOOKING_STATUS_META[b.status as BookingStatus]?.label ?? b.status}</Badge>
                              </div>
                              {b.outcome && <p className="text-[11px] text-green-700">Resultado: {OUTCOMES.find(([k]) => k === b.outcome)?.[1] ?? b.outcome}</p>}
                              <div className="mt-1 flex flex-wrap gap-1">
                                {(b.status === 'confirmed' || b.status === 'pending') && <button type="button" className="inline-flex min-h-[36px] items-center rounded-lg px-2 text-[11px] text-subtle hover:bg-white hover:text-ink md:min-h-[32px]" onClick={() => { setMoving(b); setTargetSlot(null); }}><MoveRight size={11} className="mr-0.5 inline" aria-hidden="true" />Reprogramar</button>}
                                {(b.status === 'confirmed' || b.status === 'pending' || b.status === 'attended') && !b.outcome && <button type="button" className="inline-flex min-h-[36px] items-center rounded-lg px-2 text-[11px] text-subtle hover:bg-white hover:text-ink md:min-h-[32px]" onClick={() => { setOutcomeFor(b); setOutcome('interested'); setNote(''); }}><ClipboardCheck size={11} className="mr-0.5 inline" aria-hidden="true" />Resultado</button>}
                                {(b.status === 'confirmed' || b.status === 'pending') && <button type="button" className="inline-flex min-h-[36px] items-center rounded-lg px-2 text-[11px] text-coral-600 hover:bg-white md:min-h-[32px]" disabled={action.isPending && action.variables?.id === b.id} onClick={() => setNoShowFor(b)}>{action.isPending && action.variables?.id === b.id ? 'Guardando…' : 'No asistió'}</button>}
                                {b.parent_phone && <a href={`https://wa.me/52${b.parent_phone.replace(/\D/g, '').slice(-10)}`} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-[36px] items-center rounded-lg px-2 text-[11px] text-subtle hover:bg-white hover:text-ink md:min-h-[32px]" aria-label={`WhatsApp a ${b.parent_name}`}><MessageCircle size={11} /></a>}
                                {b.case && seesAdmissions && <Link to={`/admin/admisiones/${b.case}`} className="inline-flex min-h-[36px] items-center rounded-lg px-2 text-[11px] text-purple hover:bg-white md:min-h-[32px]" aria-label={`Expediente de ${b.child_name || b.parent_name}`}><FolderOpen size={11} className="mr-0.5" aria-hidden="true" />Expediente</Link>}
                              </div>
                            </li>
                          ))}
                        </ul>
                      </li>
                    ))}
                  </ul>
                  {(examsByDay.get(d.date) ?? []).length > 0 && (
                    <ul className="mt-2 space-y-2" aria-label={`Exámenes del ${DAY_NAMES[i]} ${Number(d.date.slice(8))}`}>
                      {(examsByDay.get(d.date) ?? []).map((x) => (
                        <li key={x.case}>
                          <Link to={`/admin/admisiones/${x.case}`}
                            className="block min-h-[44px] rounded-xl border border-pink/30 bg-pink-light p-2 text-xs hover:border-pink/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-purple/40">
                            <span className="flex items-center gap-1 font-semibold text-pink-dark"><PenLine size={12} aria-hidden="true" /> {x.time} · Examen</span>
                            <span className="block truncate font-medium text-ink">{x.child_name}</span>
                            <span className="block truncate text-subtle">{x.grade_applying}{x.result ? ` · ${EXAM_RESULT[x.result] ?? x.result}` : ''}</span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              );
            })}
          </div>
        </div>
      )}

      <Modal open={!!moving} onClose={() => setMoving(null)} title={`Reprogramar: ${moving?.parent_name ?? ''}`} maxWidth={480}>
        <div className="space-y-3">
          <p className="text-sm text-muted">Elija otro horario de esta semana con cupo. La familia recibe un correo con la nueva fecha.</p>
          <label className="label" htmlFor="target-slot">Nuevo horario</label>
          <select id="target-slot" className="input-field" value={targetSlot ?? ''} onChange={(e) => setTargetSlot(Number(e.target.value) || null)}>
            <option value="">Seleccione…</option>
            {allSlots.filter((s) => s.is_active && s.booked < s.capacity && `${s.date}T${s.start_time}` > nowKey).map((s) => <option key={s.id} value={s.id}>{s.date} {s.start_time} · {s.visit_type === 'open_class' ? 'Clase abierta' : 'Individual'} · libres {s.capacity - s.booked}</option>)}
          </select>
          <p className="text-xs text-subtle">¿Otra semana? Navegue a esa semana antes de abrir este diálogo.</p>
          <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setMoving(null)}>Cancelar</Button><Button onClick={() => reschedule.mutate()} loading={reschedule.isPending} disabled={!targetSlot}>Reprogramar</Button></div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!noShowFor}
        onClose={() => setNoShowFor(null)}
        onConfirm={() => noShowFor && action.mutate({ id: noShowFor.id, act: 'no_show' })}
        title="Marcar «No asistió»"
        message={`Se registrará que ${noShowFor?.parent_name ?? 'la familia'} no asistió a la visita y se liberará su lugar.`}
        confirmLabel="Marcar «No asistió»"
        loading={action.isPending}
      />

      <Modal open={!!outcomeFor} onClose={() => setOutcomeFor(null)} title={`Resultado de la visita: ${outcomeFor?.parent_name ?? ''}`} maxWidth={480}>
        <div className="space-y-3">
          <fieldset>
            <legend className="label">¿Cómo terminó?</legend>
            <div className="space-y-1">{OUTCOMES.map(([k, l]) => <label key={k} className="flex items-center gap-2 text-sm"><input type="radio" name="outcome" value={k} checked={outcome === k} onChange={() => setOutcome(k)} /> {l}</label>)}</div>
          </fieldset>
          <div><label className="label" htmlFor="outcome-note">Nota (opcional)</label><textarea id="outcome-note" className="input-field" rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></div>
          <p className="text-xs text-subtle">Marca la visita como asistida y mueve el expediente de la familia: se inscribirá → Examen, no le interesó → cerrado, los demás siguen en Visita guiada.</p>
          <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setOutcomeFor(null)}>Cancelar</Button><Button onClick={() => setOutcomeM.mutate()} loading={setOutcomeM.isPending}>Guardar resultado</Button></div>
        </div>
      </Modal>
    </>
  );
}
