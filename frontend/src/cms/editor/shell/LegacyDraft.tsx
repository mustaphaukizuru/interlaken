import { AlertTriangle, LayoutTemplate, Upload } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';

/**
 * Contract C1: the draft is one of the old generic seeds (seed_cms). Publishing
 * it would replace the page's design with plain blocks, so the editor warns on
 * open and asks before publishing.
 */
export function LegacyDraftBanner({ onLoadDesign, canLoad }: { onLoadDesign: () => void; canLoad: boolean }) {
  return (
    <div role="status" className="flex flex-col gap-3 rounded-xl border border-amber/40 bg-amber/10 p-3 text-sm md:flex-row md:items-center md:justify-between">
      <div className="flex items-start gap-2">
        <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber" aria-hidden="true" />
        <div>
          <p className="font-semibold text-ink">Borrador antiguo</p>
          <p className="text-ink">Este borrador se creó con bloques sencillos, antes del diseño actual, y no se parece a la página del sitio.{canLoad ? ' Cargue el diseño actual para editar la página tal como se ve hoy.' : ''}</p>
        </div>
      </div>
      {canLoad && (
        <Button size="md" onClick={onLoadDesign} className="shrink-0"><LayoutTemplate size={16} aria-hidden="true" /> Cargar el diseño actual</Button>
      )}
    </div>
  );
}

interface DialogProps {
  open: boolean;
  onClose: () => void;
  pageTitle: string;
  /** False for pages without a design template (nothing to load). */
  canLoad: boolean;
  onLoadDesign: () => void;
  onPublishAnyway: () => void;
  publishing?: boolean;
}

export function LegacyDraftDialog({ open, onClose, pageTitle, canLoad, onLoadDesign, onPublishAnyway, publishing }: DialogProps) {
  return (
    <Modal open={open} onClose={onClose} title="Este borrador usa el formato antiguo" maxWidth={540}>
      <div className="space-y-4 text-sm">
        <p className="text-ink">
          El borrador de «{pageTitle}» se creó antes del diseño actual, con bloques sencillos. Si lo publica,
          <strong> la página del sitio perderá su diseño</strong> (fotos, colores y secciones) y se verá con esos bloques.
        </p>
        {canLoad && (
          <p className="rounded-xl bg-green-50 px-3 py-2 text-green-700">
            <strong>Recomendado:</strong> cargue el diseño actual, haga ahí sus cambios y publique después. El sitio no cambia hasta entonces.
          </p>
        )}
        <div className="flex flex-col gap-2 border-t border-line pt-4 sm:flex-row-reverse sm:flex-wrap sm:justify-start">
          {canLoad && (
            <Button onClick={onLoadDesign}><LayoutTemplate size={16} aria-hidden="true" /> Cargar el diseño actual</Button>
          )}
          <Button variant="ghost" className="!text-coral-700 hover:!bg-coral-50" onClick={onPublishAnyway} loading={publishing}>
            <Upload size={16} aria-hidden="true" /> Publicar de todos modos
          </Button>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
        </div>
      </div>
    </Modal>
  );
}
