import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

const FOCUSABLE = 'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * Phone sheet for the header menus (child switcher, avisos). Portalled to
 * <body> so it never sits inside the header's stacking context (under the tab
 * bar); 44 px targets, safe-area padding, scroll lock, Escape, a focus trap,
 * and focus back on the trigger when it closes.
 */
export function BottomSheet({ open, onClose, title, headerExtra, footer, children }: {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Next to the title (e.g. «Marcar todo como leído»). */
  headerExtra?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    (panel?.querySelector<HTMLElement>(FOCUSABLE) ?? panel)?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onCloseRef.current(); return; }
      if (e.key !== 'Tab' || !panel) return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener('keydown', onKey);
      opener?.focus?.();
    };
  }, [open]);

  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-modal print:hidden">
      <button type="button" aria-label="Cerrar" tabIndex={-1} onClick={onClose} className="absolute inset-0 cursor-default bg-ink/40" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="absolute inset-x-0 bottom-0 flex max-h-[88dvh] flex-col rounded-t-md bg-white pb-[env(safe-area-inset-bottom)] shadow-raised focus:outline-none motion-safe:animate-[route-enter_0.2s_ease-out]"
      >
        <div className="mx-auto mt-2 h-1.5 w-10 rounded-full bg-line" aria-hidden="true" />
        <div className="flex min-h-[56px] items-center justify-between gap-2 border-b border-line pl-4 pr-1.5">
          <h2 id={titleId} className="font-head text-base font-bold text-ink">{title}</h2>
          <div className="flex items-center gap-1">
            {headerExtra}
            <button
              type="button"
              onClick={onClose}
              aria-label="Cerrar"
              className="flex h-11 w-11 items-center justify-center rounded-sm text-muted transition-colors hover:bg-cream hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40"
            >
              <X size={20} aria-hidden="true" />
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
        {footer}
      </div>
    </div>,
    document.body,
  );
}

export default BottomSheet;
