import { WifiOff } from 'lucide-react';
import { useOnline } from '@/hooks/useOnline';

/** Shown at the top of the portal while offline: cached data (the credencial) still works and says how old it is (P4-9). */
export function OfflineBanner() {
  const online = useOnline();
  if (online) return null;
  return (
    <div role="status" className="flex items-center justify-center gap-2 bg-ink px-4 py-1.5 text-center text-xs text-white print:hidden">
      <WifiOff size={16} aria-hidden="true" /> Sin conexión. Se muestra la última información guardada.
    </div>
  );
}

export default OfflineBanner;
