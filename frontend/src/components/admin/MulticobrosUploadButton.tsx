import { lazy, Suspense, useState } from 'react';
import { FileUp } from 'lucide-react';
import { Button } from '@/components/ui/Button';

// Its own chunk: downloaded on the first click, never by the console's other tabs.
const MulticobrosUploadDialog = lazy(() => import('./MulticobrosUploadDialog'));

/** «Subir reporte de MultiCobros»: verify the day's card approvals from one export. */
export function MulticobrosUploadButton({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="secondary" className={className} onClick={() => setOpen(true)}>
        <FileUp className="h-3.5 w-3.5" aria-hidden="true" /> Subir reporte de MultiCobros
      </Button>
      {open && (
        <Suspense fallback={null}>
          <MulticobrosUploadDialog open onClose={() => setOpen(false)} />
        </Suspense>
      )}
    </>
  );
}
