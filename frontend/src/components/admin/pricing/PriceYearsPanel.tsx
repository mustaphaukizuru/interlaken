import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarCheck, Hourglass } from 'lucide-react';
import toast from 'react-hot-toast';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { apiErrorMessage } from '@/lib/apiErrors';
import { cycleLabel } from '@/lib/siteMeta';
import {
  cleanYears, missingGroups, PRICE_GROUPS, priceCycleStart, priceYearLabel, reminderYear,
  type PriceGroup, type PriceYears,
} from '@/lib/priceYears';
import { pricingAdminApi } from '@/services/pricingAdminApi';

export const PRICE_YEARS_KEY = ['price-years'] as const;

const labelOf = (g: PriceGroup) => PRICE_GROUPS.find((x) => x.key === g)?.label ?? g;
const joinEs = (items: string[]) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`);

/** The price years and what is missing, for the panel and the dashboard reminder. */
export function usePriceYearsAdmin(enabled = true) {
  const query = useQuery({
    queryKey: PRICE_YEARS_KEY,
    queryFn: async () => (await pricingAdminApi.years()).data,
    staleTime: 60_000,
    enabled,
  });
  const years: PriceYears = cleanYears(query.data?.years);
  const fromMonth = query.data?.admissions_next_from_month ?? 1;
  const now = new Date();
  const shown = priceCycleStart(years, now, fromMonth);
  const due = reminderYear(years, now, fromMonth);
  return { ...query, years, fromMonth, shown, due, missing: missingGroups(years, due) };
}

/**
 * «Año de los precios» in Costos y precios (owner, 2026-11-22): Costos is the
 * one page whose year never follows the calendar by itself. Each section says
 * which year its prices are; publishing a year is one deliberate, audited
 * step, and a section still on an older year reads «Precios AAAA: pendientes»
 * on the site once the site announces that cycle.
 */
export function PriceYearsPanel() {
  const qc = useQueryClient();
  const { data, isLoading, isError, years, shown, due, missing } = usePriceYearsAdmin();
  const [asking, setAsking] = useState<{ groups: PriceGroup[]; year: number } | null>(null);

  const publish = useMutation({
    mutationFn: (req: { groups: PriceGroup[]; year: number }) =>
      pricingAdminApi.setYears(Object.fromEntries(req.groups.map((g) => [g, req.year]))),
    onSuccess: (_res, req) => {
      setAsking(null);
      void qc.invalidateQueries({ queryKey: PRICE_YEARS_KEY });
      void qc.invalidateQueries({ queryKey: ['site-settings'] });
      void qc.invalidateQueries({ queryKey: ['badges'] });
      toast.success(`Precios ${req.year} publicados: ${joinEs(req.groups.map(labelOf))}.`);
    },
    onError: (e) => toast.error(apiErrorMessage(e, 'No se pudo publicar. Intente de nuevo.')),
  });

  if (isError) {
    return <p className="mb-5 text-sm text-danger" role="alert">No se pudo cargar el año de los precios. Recargue la página.</p>;
  }
  if (isLoading || !data) return <div className="skeleton mb-5 h-40 rounded-md" aria-hidden="true" />;

  const options = (current?: number) => {
    const low = Math.min(current ?? due, due) - 1;
    return Array.from({ length: due + 1 - low + 1 }, (_, i) => low + i);
  };

  return (
    <section aria-labelledby="price-years-title" className="card mb-5 !p-4 sm:!p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 max-w-2xl">
          <h2 id="price-years-title" className="font-head text-lg font-bold text-ink">Año de los precios</h2>
          <p className="mt-1 text-sm text-muted">
            La página de Costos muestra el <strong className="text-ink">ciclo {cycleLabel(shown)}</strong>. Cada sección dice de qué año son sus precios;
            no cambian solos con el calendario. Cuando el sitio pase al siguiente ciclo, las secciones que no publique dirán «pendientes».
          </p>
        </div>
        {missing.length > 1 && (
          <Button size="sm" onClick={() => setAsking({ groups: missing, year: due })}>
            <CalendarCheck size={15} aria-hidden="true" /> Publicar precios {due} en las {missing.length} secciones
          </Button>
        )}
      </div>

      {missing.length > 0 && (
        <p className="mt-3 flex items-start gap-2 rounded-sm bg-warning-bg px-3 py-2 text-sm text-warning" role="status">
          <Hourglass className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
          <span>
            Faltan los precios {due} de {joinEs(missing.map(labelOf))}. Actualice sus cifras en las pestañas de abajo y después publíquelos aquí.
          </span>
        </p>
      )}

      <ul className="mt-3 divide-y divide-line">
        {PRICE_GROUPS.map(({ key, label }) => {
          const year = years[key];
          const late = (year ?? 0) < due;
          return (
            <li key={key} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 py-3 md:grid-cols-[minmax(0,1fr)_7rem_9.5rem_16rem]">
              <span className="font-medium text-ink">{label}</span>
              <span className="text-sm tabular-nums text-muted">{year ? priceYearLabel(year) : 'Sin año'}</span>
              <span>
                {late
                  ? <Badge variant="warning" icon={Hourglass}>Pendiente: {due}</Badge>
                  : <Badge variant="success">Al día</Badge>}
              </span>
              <span className="flex items-center justify-end gap-2">
                {late && (
                  <Button size="sm" variant="secondary" onClick={() => setAsking({ groups: [key], year: due })}>
                    Publicar {due}
                  </Button>
                )}
                <label className="sr-only" htmlFor={`year-${key}`}>Año de los precios de {label}</label>
                <select
                  id={`year-${key}`}
                  value={year ?? ''}
                  onChange={(e) => { const y = Number(e.target.value); if (y && y !== year) setAsking({ groups: [key], year: y }); }}
                  className="input-field !min-h-[40px] w-auto !py-1.5 text-sm"
                >
                  {!year && <option value="">Elegir año</option>}
                  {options(year).map((y) => <option key={y} value={y}>{priceYearLabel(y)}</option>)}
                </select>
              </span>
            </li>
          );
        })}
      </ul>

      <Modal open={!!asking} onClose={() => { if (!publish.isPending) setAsking(null); }} title={asking ? `¿Publicar los precios ${asking.year}?` : ''} maxWidth={460}>
        {asking && (
          <div className="space-y-4 text-sm text-ink">
            <p>
              {joinEs(asking.groups.map(labelOf))} {asking.groups.length === 1 ? 'mostrará' : 'mostrarán'} <strong>«{priceYearLabel(asking.year)}»</strong> en
              la página de Costos y en el estimador de Admisiones{asking.year >= shown ? ', sin el aviso de pendientes' : ''}.
            </p>
            <p className="text-muted">
              Antes, revise que las cifras de {asking.groups.length === 1 ? 'esa tabla' : 'esas tablas'} ya sean las del ciclo {cycleLabel(asking.year)}. Queda registrado en Auditoría.
            </p>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="secondary" onClick={() => setAsking(null)} disabled={publish.isPending}>Cancelar</Button>
              <Button onClick={() => publish.mutate(asking)} loading={publish.isPending} disabled={publish.isPending}>
                Publicar precios {asking.year}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </section>
  );
}

export default PriceYearsPanel;
