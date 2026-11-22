import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
// Icons nothing else imports, so they ship inside this lazy console chunk
// (Copy/Check are shared chunks: each would add a preload entry to the
// public entry chunk, which is at its performance budget).
import { CheckCheck as Check, ClipboardCopy as Copy } from 'lucide-react';

/**
 * Small icon button that copies one value staff paste elsewhere (the número
 * de control and Referencia 1 they search in MultiCobros). Says «Copiado»
 * with a toast and, for a moment, with a check mark; the accessible name
 * names what it copies.
 */
export function CopyButton({ value, label, className = '' }: { value: string; label: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1500);
      toast.success('Copiado');
    } catch {
      toast.error('No se pudo copiar. Seleccione el texto y cópielo a mano.');
    }
  };

  return (
    <button
      type="button"
      onClick={() => void copy()}
      aria-label={`Copiar ${label}`}
      title={`Copiar ${label}`}
      className={`inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-sm text-subtle transition hover:bg-purple/10 hover:text-purple focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40 ${className}`}
    >
      {copied
        ? <Check className="h-3.5 w-3.5 text-green-700" aria-hidden="true" />
        : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
    </button>
  );
}

export default CopyButton;
