/**
 * «Descargar mi ficha (PDF)» on the confirmation screen: the family's own copy
 * of the ficha they just sent (GET register/<pk>/ficha/export/?fmt=pdf with
 * their X-Session-Token; Fase 3). The download code (fichaExports) loads only
 * when the button is pressed, so /pre-registro does not grow.
 */
import { useState, type ReactNode } from 'react';
import { Download, Loader2 } from 'lucide-react';

export interface FichaPdfContext {
  registrationId: number;
  sessionToken: string;
  childName: string;
}

function FichaPdfButton({ registrationId, sessionToken }: FichaPdfContext) {
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState('');

  const download = async () => {
    setState('busy');
    setMessage('');
    const exports = await import('@/hooks/queries/fichaExports');
    try {
      await exports.downloadMyFicha(registrationId, sessionToken);
      setState('done');
      setMessage('Listo: su ficha se descargó en PDF.');
    } catch (err) {
      setState('error');
      setMessage(await exports.fichaErrorMessage(err, 'No se pudo descargar la ficha. Intente de nuevo o pídala a admisiones.'));
    }
  };

  return (
    <div className="flex flex-col items-center gap-2 text-center">
      <button
        type="button"
        onClick={() => { void download(); }}
        disabled={state === 'busy'}
        className="btn-outline inline-flex min-h-[44px] items-center gap-2"
      >
        {state === 'busy'
          ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          : <Download className="h-4 w-4" aria-hidden="true" />}
        {state === 'busy' ? 'Preparando su ficha…' : 'Descargar mi ficha (PDF)'}
      </button>
      <p
        role={state === 'error' ? 'alert' : 'status'}
        aria-live="polite"
        className={`min-h-[1.25rem] text-sm ${state === 'error' ? 'text-coral-dark' : 'text-muted'}`}
      >
        {message}
      </p>
    </div>
  );
}

export function fichaPdfSlot(ctx: FichaPdfContext): ReactNode {
  return <FichaPdfButton {...ctx} />;
}
