/**
 * Live preview of «Costos y precios»: the real public components (the price
 * tables of /admisiones/costos and the Admisiones estimator) fed with the
 * figures being edited, through a query client of their own. Loaded on demand
 * by the console only; links inside it do nothing.
 */
import { useEffect, useState, type MouseEvent } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { PricingSections, type PricingCopy } from '@/components/public/PricingSections';
import { CostEstimator } from '@/components/admissions/CostEstimator';
import type { EstimatorCopy } from '@/components/admissions/estimatorCopy';

export interface PreviewBundle {
  enrollment_fees: unknown[]; tuition: unknown[]; fixed_concepts: unknown[];
  extracurriculars: unknown[]; daycare: unknown[]; policies: unknown[];
}

const inert = (e: MouseEvent) => { if ((e.target as HTMLElement).closest('a')) e.preventDefault(); };

export default function PricingPreview({ bundle, view, copy, estimatorCopy }: {
  bundle: PreviewBundle; view: 'tables' | 'estimator'; copy?: Partial<PricingCopy>; estimatorCopy?: Partial<EstimatorCopy>;
}) {
  const outer = useQueryClient();
  const [client] = useState(() => {
    const c = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false, refetchOnWindowFocus: false } } });
    c.setQueryData(['pricing-bundle'], bundle);
    const settings = outer.getQueryData(['site-settings']);
    if (settings) c.setQueryData(['site-settings'], settings);
    return c;
  });
  useEffect(() => { client.setQueryData(['pricing-bundle'], bundle); }, [client, bundle]);
  return (
    <QueryClientProvider client={client}>
      <div onClickCapture={inert}>
        {view === 'tables' ? (
          <PricingSections copy={copy} />
        ) : (
          <div className="bg-cream p-4 sm:p-6"><div className="mx-auto max-w-xl"><CostEstimator copy={estimatorCopy} /></div></div>
        )}
      </div>
    </QueryClientProvider>
  );
}
