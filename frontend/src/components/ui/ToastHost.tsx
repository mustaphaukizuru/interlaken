import { useEffect } from 'react';
import toast, { Toaster, useToasterStore } from 'react-hot-toast';
import { useMediaQuery } from '@/hooks/useMediaQuery';

const MAX_VISIBLE = 3;

/**
 * App-wide toaster (BACKLOG P1-B4): bottom-center on phones, lifted above the
 * portal tab bar and the WhatsApp float; top-right on desktop. At most three
 * toasts are visible at once (oldest dismissed first).
 */
export function ToastHost() {
  const isMobile = !useMediaQuery('(min-width: 768px)');
  const { toasts } = useToasterStore();

  useEffect(() => {
    toasts
      .filter((t) => t.visible)
      .filter((_, i) => i >= MAX_VISIBLE)
      .forEach((t) => toast.dismiss(t.id));
  }, [toasts]);

  return (
    <Toaster
      position={isMobile ? 'bottom-center' : 'top-right'}
      containerStyle={isMobile
        ? { bottom: 'calc(84px + env(safe-area-inset-bottom))', left: 12, right: 12 }
        : { top: 16, right: 16 }}
      toastOptions={{
        style: { maxWidth: isMobile ? '100%' : 380 },
        // Errors linger longer and are announced immediately by screen readers.
        error: {
          duration: 6000,
          ariaProps: { role: 'alert', 'aria-live': 'assertive' },
        },
      }}
    />
  );
}

export default ToastHost;
