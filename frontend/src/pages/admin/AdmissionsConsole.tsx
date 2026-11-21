import { lazy, Suspense } from 'react';

/**
 * The Admisiones console (list, pipeline board, Expediente) behind ONE lazy
 * route entry in App.tsx.
 *
 * Why (perf budget, scripts/check-budgets.mjs): every lazy() route in App.tsx
 * leaves its import stub and the list of chunks it preloads in the entry
 * chunk that every PUBLIC visitor downloads. The three admission pages share
 * the Expediente modules (lib/caseStages, hooks/queries/cases, the case
 * cards), so as three separate entries they added a dozen shared-chunk names
 * to that list. Behind this module their preload lists live in its own
 * small chunk and the public entry only knows about this one.
 */
const AdminAdmissions = lazy(() => import('./AdminAdmissions'));
const AdminPipeline = lazy(() => import('./AdminPipeline'));
const AdminCase = lazy(() => import('./AdminCase'));

const PAGES = { list: AdminAdmissions, pipeline: AdminPipeline, case: AdminCase };

/** Content-area spinner while the page chunk loads (the console chrome stays). */
function PageLoading() {
  return (
    <div role="status" aria-live="polite" className="flex min-h-[40vh] items-center justify-center">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-brand-100 border-t-brand-600" />
      <span className="sr-only">Cargando…</span>
    </div>
  );
}

export default function AdmissionsConsole({ page }: { page: keyof typeof PAGES }) {
  const Page = PAGES[page];
  return (
    <Suspense fallback={<PageLoading />}>
      <Page />
    </Suspense>
  );
}
