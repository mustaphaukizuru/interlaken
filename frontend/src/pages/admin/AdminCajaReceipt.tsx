import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Printer } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { ErrorState } from '@/components/ui/ErrorState';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import Logo from '@/components/ui/Logo';
import { cajaApi } from '@/services/caja';

/**
 * /admin/caja/recibo/:topupId: the printable receipt of a front-desk top-up
 * (the family also gets it by email). Only the receipt prints: the console
 * chrome and these buttons carry `data-print="hide"`.
 */
export default function AdminCajaReceipt() {
  const { topupId } = useParams();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['caja', 'receipt', topupId],
    queryFn: async () => (await cajaApi.get(topupId ?? '')).data,
    enabled: !!topupId,
  });
  return (
    <div className="mx-auto max-w-md">
      <div className="mb-4 flex items-center justify-between" data-print="hide">
        <Link to="/admin/caja" className="inline-flex items-center gap-1 text-sm font-semibold text-muted hover:text-ink">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Caja
        </Link>
        {data && (
          <Button onClick={() => window.print()} className="min-h-[44px]">
            <Printer size={16} aria-hidden="true" /> Imprimir
          </Button>
        )}
      </div>
      {isLoading ? <LoadingSpinner /> : isError || !data ? <ErrorState onRetry={() => refetch()} /> : (
        <article className="card rounded-md bg-white p-6" aria-label={`Recibo ${data.topup.folio}`}>
          <div className="mb-4 flex items-center justify-between gap-3">
            <Logo className="h-10 w-auto" />
            <span className="font-head text-sm font-bold text-ink">{data.topup.folio}</span>
          </div>
          <h1 className="font-head text-lg font-bold text-ink">Recibo de recarga de cafetería</h1>
          {data.topup.voided_at && (
            <p className="mt-2 rounded-md bg-danger-bg p-2 text-sm font-semibold text-danger">
              Anulada{data.topup.void_reason ? `: ${data.topup.void_reason}` : ''}
            </p>
          )}
          <dl className="mt-4 divide-y divide-line text-sm">
            {data.details.map(([label, value]) => (
              <div key={label} className="flex justify-between gap-4 py-2">
                <dt className="text-muted">{label}</dt>
                <dd className="text-right font-medium text-ink">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-xs text-subtle">Colegio Interlaken · Cafetería. Conserve este recibo.</p>
        </article>
      )}
    </div>
  );
}
