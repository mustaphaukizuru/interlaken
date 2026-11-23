import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { CalendarRange } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { contentApi } from '@/services/api';
import { apiFieldErrors } from '@/lib/apiErrors';
import { announcedCycleStart, cycleLabel } from '@/lib/siteMeta';
import type { SiteSettings } from '@/types/content';

/** The months the school can choose (backend SiteSettings.ADMISSIONS_NEXT_FROM_CHOICES). */
export const NEXT_CYCLE_MONTHS = [
  { value: 9, label: '1 de septiembre' },
  { value: 10, label: '1 de octubre' },
  { value: 11, label: '1 de noviembre' },
  { value: 12, label: '1 de diciembre' },
  { value: 1, label: '1 de enero (como hasta ahora)' },
];

/** «Desde el 1 de noviembre de 2026 el sitio anuncia el ciclo 2027–2028.» */
export function nextCycleSentence(month: number, now = new Date()): string {
  const shown = announcedCycleStart(now, month);
  const y = now.getFullYear();
  // The next switch: this year's date if it is still ahead, otherwise next year's.
  const switchYear = month === 1 ? y + 1 : now.getMonth() + 1 >= month ? y + 1 : y;
  const label = NEXT_CYCLE_MONTHS.find((m) => m.value === month)?.label.replace(' (como hasta ahora)', '') ?? '';
  return `Hoy el sitio anuncia el ciclo ${cycleLabel(shown)}. A partir del ${label} de ${switchYear} anunciará el ${cycleLabel(month === 1 ? switchYear : switchYear + 1)}.`;
}

/**
 * Ajustes → «Ciclo escolar del sitio» (owner, 2026-11-22): every year on the
 * site moves by itself; this only chooses from which date the public texts
 * ({{ciclo}}: «Ciclo Escolar 2027–2028 · Inscripciones abiertas», titles,
 * new admissions records) announce the next school cycle. Costos keeps its
 * own rule (the year of its published prices). Saved at once, on its own.
 */
export function SchoolCycleCard({ value, loaded }: { value: number | undefined; loaded: boolean }) {
  const qc = useQueryClient();
  const month = value ?? 1;
  const save = useMutation({
    mutationFn: (next: number) => contentApi.adminUpdateSettings({ admissions_next_from_month: next }),
    onSuccess: (_res, next) => {
      qc.setQueryData<Partial<SiteSettings>>(['admin-site-settings'], (prev) => ({ ...prev, admissions_next_from_month: next }));
      void qc.invalidateQueries({ queryKey: ['admin-site-settings'] });
      void qc.invalidateQueries({ queryKey: ['site-settings'] });
      void qc.invalidateQueries({ queryKey: ['badges'] });
      toast.success(nextCycleSentence(next));
    },
    onError: (err) => toast.error(apiFieldErrors(err).detail || 'No se pudo guardar el ajuste.'),
  });

  return (
    <Card title="Ciclo escolar del sitio">
      <div className="space-y-3 text-sm">
        <p className="text-subtle">
          Los años del sitio cambian solos: el ciclo escolar, el año del pie de página, los años de historia y la credencial.
          Aquí solo elige desde qué fecha los textos de Admisiones anuncian el ciclo siguiente. Costos sigue sus precios publicados.
        </p>
        <div className="max-w-xs">
          <label className="label" htmlFor="next-cycle-month">Anunciar el ciclo siguiente desde el</label>
          <select
            id="next-cycle-month"
            className="input-field"
            value={month}
            disabled={!loaded || save.isPending}
            onChange={(e) => save.mutate(Number(e.target.value))}
          >
            {NEXT_CYCLE_MONTHS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </div>
        <p className="inline-flex items-start gap-1.5 font-medium text-ink" aria-live="polite">
          <CalendarRange className="mt-0.5 h-4 w-4 flex-shrink-0 text-purple" aria-hidden="true" />
          {nextCycleSentence(month)}
        </p>
      </div>
    </Card>
  );
}

export default SchoolCycleCard;
