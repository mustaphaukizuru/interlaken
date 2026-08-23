import { WifiOff } from 'lucide-react';
import { useOnline } from '@/hooks/useOnline';

/** Shown at the top of the portal while offline: cached credencial/comunicados still work (P4-9). */
export function OfflineBanner() {
  const online = useOnline();
  if (online) return null;
  return (
    <div role="status" className="flex items-center justify-center gap-2 bg-ink px-4 py-1.5 text-center text-xs text-white">
      <WifiOff size={14} aria-hidden="true" /> Sin conexión: mostramos la última información guardada. La credencial y los comunicados recientes siguen disponibles.
    </div>
  );
}

export default OfflineBanner;
