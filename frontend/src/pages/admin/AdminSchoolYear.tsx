import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, CalendarRange, CheckCircle2, GraduationCap } from 'lucide-react';
import toast from 'react-hot-toast';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ListSkeleton } from '@/components/ui/ListSkeleton';
import { ErrorState } from '@/components/ui/ErrorState';
import { portalApi, type SchoolYearPreview, type SchoolYearResult } from '@/services/api';
import { apiErrors } from '@/cms/editor/helpers';

type Step = 'preview' | 'confirm' | 'done';

/** /admin/nuevo-ciclo — promote grades, graduate 3° Secundaria, new cycle label (BACKLOG P4-5). */
export default function AdminSchoolYear() {
  const qc = useQueryClient();
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['school-year-preview'], queryFn: async () => (await portalApi.schoolYearPreview()).data });
  const [step, setStep] = useState<Step>('preview');
  const [cycle, setCycle] = useState('');
  const [resetThreshold, setResetThreshold] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [result, setResult] = useState<SchoolYearResult | null>(null);
  const run = useMutation({
    mutationFn: () => portalApi.schoolYearRun({ confirm, new_cycle: cycle, reset_threshold: resetThreshold === '' ? null : Number(resetThreshold) }),
    onSuccess: ({ data: res }) => { setResult(res); setStep('done'); qc.invalidateQueries({ queryKey: ['admin-students'] }); qc.invalidateQueries({ queryKey: ['school-year-preview'] }); toast.success('Nuevo ciclo aplicado.'); },
    onError: (e) => { const f = apiErrors(e); setErrors(f); toast.error(f.confirm || f.new_cycle || f.reset_threshold || f.detail || 'No se pudo aplicar.'); },
  });
  const newCycle = cycle || data?.suggested_cycle || '';

  return (
    <>
      <PageHeader title="Nuevo ciclo escolar" subtitle="Promueve a todos los alumnos activos un grado, egresa a 3° de Secundaria y fija la etiqueta del ciclo. Se ejecuta una vez al año." />
      {isError ? <Card><ErrorState onRetry={() => refetch()} /></Card> : isLoading || !data ? <Card><ListSkeleton /></Card> : step === 'done' && result ? (
        <Card>
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-green-600" aria-hidden="true" />
            <div>
              <h2 className="font-head text-lg font-bold text-ink">Ciclo {result.school_year} aplicado</h2>
              <ul className="mt-2 space-y-1 text-sm text-muted">
                <li>{result.promoted} alumnos promovidos de grado.</li>
                <li>{result.graduated} alumnos egresados (su acceso al portal queda desactivado; las familias conservan el suyo).</li>
                {result.thresholds_reset > 0 && <li>{result.thresholds_reset} umbrales de saldo bajo reiniciados.</li>}
              </ul>
              <p className="mt-3 text-xs text-subtle">Los cambios quedaron en Auditoría. Los grupos (A/B) no cambian; ajústelos desde Alumnos si hace falta.</p>
            </div>
          </div>
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
          <Card>
            <h2 className="mb-1 font-head text-base font-bold text-ink">Qué pasará</h2>
            <p className="mb-4 text-sm text-muted">{data.active_total} alumnos activos · {data.graduates} egresan · {data.skipped} en baja temporal/definitiva no cambian.{data.current_cycle ? ` Ciclo actual: ${data.current_cycle}.` : ''}</p>
            {data.moves.length === 0 ? <p className="text-sm text-muted">No hay alumnos activos.</p> : (
              <ul className="divide-y divide-line" aria-label="Movimientos por grado">
                {data.moves.map((m) => (
                  <li key={m.from} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <span className="inline-flex items-center gap-2 text-ink">{m.to === 'Egresado' ? <GraduationCap size={16} className="text-purple" aria-hidden="true" /> : <ArrowRight size={16} className="text-subtle" aria-hidden="true" />}{m.from} <span className="text-subtle">→</span> <strong>{m.to}</strong></span>
                    <span className="text-subtle">{m.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            {step === 'preview' ? (
              <div className="space-y-3">
                <Input label="Nuevo ciclo" value={newCycle} onChange={(e) => setCycle(e.target.value)} placeholder="2027-2028" hint="Formato AAAA-AAAA." error={errors.new_cycle} />
                <Input label="Reiniciar umbral de saldo bajo (opcional)" type="number" inputMode="decimal" value={resetThreshold} onChange={(e) => setResetThreshold(e.target.value)} placeholder="50" hint="Vacío = conservar el umbral de cada familia." error={errors.reset_threshold} />
                <Button onClick={() => { setCycle(newCycle); setStep('confirm'); }} disabled={data.active_total === 0}><CalendarRange size={16} aria-hidden="true" /> Continuar</Button>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-ink">Se aplicará el ciclo <strong>{cycle}</strong> a {data.active_total} alumnos. Esta acción no se puede deshacer en bloque.</p>
                <Input label='Escriba AVANZAR para confirmar' value={confirm} onChange={(e) => setConfirm(e.target.value.toUpperCase())} error={errors.confirm} />
                <div className="flex gap-2">
                  <Button variant="ghost" onClick={() => setStep('preview')}>Atrás</Button>
                  <Button variant="danger" onClick={() => run.mutate()} loading={run.isPending} disabled={confirm !== 'AVANZAR'}>Aplicar nuevo ciclo</Button>
                </div>
              </div>
            )}
          </Card>
        </div>
      )}
    </>
  );
}
