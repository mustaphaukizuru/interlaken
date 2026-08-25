import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, ChevronLeft, ChevronRight, MessageCircle, MoveRight, ClipboardCheck } from 'lucide-react';
import toast from 'react-hot-toast';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Badge } from '@/components/ui/Badge';
import { ListSkeleton } from '@/components/ui/ListSkeleton';
import { ErrorState } from '@/components/ui/ErrorState';
import { bookingsApi, type WeekBooking, type WeekSlot } from '@/services/api';
import { apiErrors } from '@/cms/editor/helpers';

const DAY_NAMES = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const STATUS_TONE: Record<string, 'info' | 'success' | 'warning' | 'error' | 'neutral'> = { pending: 'warning', confirmed: 'info', attended: 'success', no_show: 'error', cancelled: 'neutral' };
const STATUS_LABEL: Record<string, string> = { pending: 'Pendiente', confirmed: 'Confirmada', attended: 'Asistió', no_show: 'No asistió', cancelled: 'Cancelada' };
const OUTCOMES: [string, string][] = [['interested', 'Interesada, dar seguimiento'], ['enrolling', 'Se inscribirá'], ['not_now', 'No por ahora'], ['declined', 'No le interesó']];

/** Monday of the week containing `d` (ISO date). */
export function mondayOf(d: Date): string {
  const x = new Date(d);
  const day = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - day);
  return x.toISOString().slice(0, 10);
}
export function shiftWeek(iso: string, weeks: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + weeks * 7);
  return d.toISOString().slice(0, 10);
}

/** /admin/visitas/semana — weekly calendar, reschedule and post-visit outcome (BACKLOG P4-2). */
export default function AdminVisitsWeek() {
  const qc = useQueryClient();
  const [start, setStart] = useState(() => mondayOf(new Date()));
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['visits-week', start], queryFn: async () => (await bookingsApi.adminWeek(start)).data });
  const [moving, setMoving] = useState<WeekBooking | null>(null);
  const [outcomeFor, setOutcomeFor] = useState<WeekBooking | null>(null);
  const [outcome, setOutcome] = useState('interested');
  const [note, setNote] = useState('');
  const [targetSlot, setTargetSlot] = useState<number | null>(null);
  const invalidate = () => { qc.invalidateQueries({ queryKey: ['visits-week'] }); qc.invalidateQueries({ queryKey: ['admin-bookings'] }); qc.invalidateQueries({ queryKey: ['badges'] }); };
  const reschedule = useMutation({
    mutationFn: () => bookingsApi.adminReschedule(moving!.id, targetSlot!),
    onSuccess: () => { toast.success('Visita reprogramada; se avisó a la familia.'); setMoving(null); invalidate(); },
    onError: (e) => toast.error(apiErrors(e).slot || 'No se pudo reprogramar.'),
  });
  const setOutcomeM = useMutation({
    mutationFn: () => bookingsApi.adminOutcome(outcomeFor!.id, { outcome, note }),
    onSuccess: ({ data: r }) => { toast.success(r.pre_registration ? `Resultado guardado; pre-registro → ${r.pre_registration.status}.` : 'Resultado guardado.'); setOutcomeFor(null); setNote(''); invalidate(); },
    onError: () => toast.error('No se pudo guardar.'),
  });
  const action = useMutation({
    mutationFn: ({ id, act }: { id: number; act: 'no_show' }) => bookingsApi.bookingAction(id, act),
    onSuccess: () => invalidate(),
    onError: () => toast.error('No se pudo actualizar.'),
  });
  const allSlots: WeekSlot[] = data?.days.flatMap((d) => d.slots.map((s) => ({ ...s, date: d.date }))) ?? [];
  const weekLabel = data ? `${new Date(`${data.start}T12:00:00`).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })} al ${new Date(`${data.end}T12:00:00`).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}` : '';

  return (
    <>
      <PageHeader title="Visitas · semana" subtitle="Agenda semanal de clases abiertas y visitas individuales. Reprograme con un clic y registre el resultado al terminar."
        actions={<Link to="/admin/visitas" className="btn-outline">Lista de visitas</Link>} />
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="inline-flex items-center gap-1">
          <Button size="sm" variant="ghost" onClick={() => setStart((s) => shiftWeek(s, -1))} aria-label="Semana anterior"><ChevronLeft size={16} /></Button>
          <Button size="sm" variant="secondary" onClick={() => setStart(mondayOf(new Date()))}>Hoy</Button>
          <Button size="sm" variant="ghost" onClick={() => setStart((s) => shiftWeek(s, 1))} aria-label="Semana siguiente"><ChevronRight size={16} /></Button>
        </div>
        <span className="inline-flex items-center gap-1 text-sm font-semibold text-ink"><CalendarDays size={16} className="text-purple" aria-hidden="true" /> {weekLabel}</span>
      </div>
      {isError ? <ErrorState onRetry={() => refetch()} /> : isLoading || !data ? <ListSkeleton /> : (
        <div className="-mx-4 px-4 pb-4 md:overflow-x-auto">
          <div className="grid grid-cols-1 gap-2 md:min-w-[980px] md:grid-cols-7" role="list" aria-label="Días de la semana">
            {data.days.map((d, i) => {
              const isToday = d.date === new Date().toISOString().slice(0, 10);
              return (
                <section key={d.date} role="listitem" className={`rounded-xl2 p-2 ${isToday ? 'bg-purple/5 ring-1 ring-purple/30' : 'bg-cream-2'}`} aria-label={`${DAY_NAMES[i]} ${d.date}`}>
                  <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-subtle">{DAY_NAMES[i]} <span className="text-ink">{Number(d.date.slice(8))}</span></h2>
                  {d.slots.length === 0 && <p className="text-[11px] text-subtle">Sin horarios</p>}
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
                                <Badge variant={STATUS_TONE[b.status] ?? 'neutral'}>{STATUS_LABEL[b.status] ?? b.status}</Badge>
                              </div>
                              {b.outcome && <p className="text-[11px] text-green-700">Resultado: {OUTCOMES.find(([k]) => k === b.outcome)?.[1] ?? b.outcome}</p>}
                              <div className="mt-1 flex flex-wrap gap-1">
                                {(b.status === 'confirmed' || b.status === 'pending') && <button type="button" className="inline-flex min-h-[36px] items-center rounded-lg px-2 text-[11px] text-subtle hover:bg-white hover:text-ink md:min-h-[32px]" onClick={() => { setMoving(b); setTargetSlot(null); }}><MoveRight size={11} className="mr-0.5 inline" aria-hidden="true" />Reprogramar</button>}
                                {(b.status === 'confirmed' || b.status === 'pending' || b.status === 'attended') && !b.outcome && <button type="button" className="inline-flex min-h-[36px] items-center rounded-lg px-2 text-[11px] text-subtle hover:bg-white hover:text-ink md:min-h-[32px]" onClick={() => { setOutcomeFor(b); setOutcome('interested'); setNote(''); }}><ClipboardCheck size={11} className="mr-0.5 inline" aria-hidden="true" />Resultado</button>}
                                {(b.status === 'confirmed' || b.status === 'pending') && <button type="button" className="inline-flex min-h-[36px] items-center rounded-lg px-2 text-[11px] text-coral-600 hover:bg-white md:min-h-[32px]" onClick={() => action.mutate({ id: b.id, act: 'no_show' })}>No asistió</button>}
                                {b.parent_phone && <a href={`https://wa.me/52${b.parent_phone.replace(/\D/g, '').slice(-10)}`} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-[36px] items-center rounded-lg px-2 text-[11px] text-subtle hover:bg-white hover:text-ink md:min-h-[32px]" aria-label={`WhatsApp a ${b.parent_name}`}><MessageCircle size={11} /></a>}
                              </div>
                            </li>
                          ))}
                        </ul>
                      </li>
                    ))}
                  </ul>
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
            {allSlots.filter((s) => s.is_active && s.booked < s.capacity).map((s) => <option key={s.id} value={s.id}>{s.date} {s.start_time} · {s.visit_type === 'open_class' ? 'Clase abierta' : 'Individual'} · libres {s.capacity - s.booked}</option>)}
          </select>
          <p className="text-xs text-subtle">¿Otra semana? Navegue a esa semana antes de abrir este diálogo.</p>
          <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setMoving(null)}>Cancelar</Button><Button onClick={() => reschedule.mutate()} loading={reschedule.isPending} disabled={!targetSlot}>Reprogramar</Button></div>
        </div>
      </Modal>

      <Modal open={!!outcomeFor} onClose={() => setOutcomeFor(null)} title={`Resultado de la visita: ${outcomeFor?.parent_name ?? ''}`} maxWidth={480}>
        <div className="space-y-3">
          <fieldset>
            <legend className="label">¿Cómo terminó?</legend>
            <div className="space-y-1">{OUTCOMES.map(([k, l]) => <label key={k} className="flex items-center gap-2 text-sm"><input type="radio" name="outcome" value={k} checked={outcome === k} onChange={() => setOutcome(k)} /> {l}</label>)}</div>
          </fieldset>
          <div><label className="label" htmlFor="outcome-note">Nota (opcional)</label><textarea id="outcome-note" className="input-field" rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></div>
          <p className="text-xs text-subtle">Marca la visita como asistida y actualiza el pre-registro de la familia (por correo): se inscribirá → Inscrito, no le interesó → No procedió, los demás → Contactado.</p>
          <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setOutcomeFor(null)}>Cancelar</Button><Button onClick={() => setOutcomeM.mutate()} loading={setOutcomeM.isPending}>Guardar resultado</Button></div>
        </div>
      </Modal>
    </>
  );
}
