import { type ReactNode, useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** Max width of the dialog panel. */
  maxWidth?: number;
  /** Phones (<640 px): fill the screen instead of a bottom sheet, as a flex
   *  column with no bottom padding, so a long flow can pin its own action bar
   *  (`sticky bottom-0`, with the safe-area padding) to the bottom edge. */
  fullScreenOnPhone?: boolean;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

/** Open dialogs, innermost last: only the top one answers Escape and Tab, so a
 *  dialog opened from another one («Conciliar» inside the MultiCobros report)
 *  closes alone. */
const openStack: object[] = [];

/**
 * Accessible modal dialog: `role="dialog"` + `aria-modal`, focus trap,
 * Escape-to-close, backdrop click, and focus restoration on close.
 * Respects the existing `.card` styling for the panel.
 */
export function Modal({ open, onClose, title, children, maxWidth = 384, fullScreenOnPhone = false }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const previouslyFocused = useRef<HTMLElement | null>(null);
  // Call sites pass inline arrows for `onClose`; reading it through a ref keeps
  // the focus-trap effect stable across parent re-renders (otherwise focus
  // bounces back to the first focusable element on every keystroke). Written
  // from an effect (not during render), per the react-hooks/refs rule.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;

    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const token = {};
    openStack.push(token);

    // Move focus into the dialog once it mounts.
    const panel = panelRef.current;
    const first = panel?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel)?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (openStack[openStack.length - 1] !== token) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab' || !panel) return;

      // `offsetParent` alone would exclude visible position:fixed descendants,
      // so also keep anything that actually generates a box.
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) =>
          el.offsetParent !== null ||
          el.getClientRects().length > 0 ||
          el === document.activeElement
      );
      if (focusable.length === 0) {
        e.preventDefault();
        panel.focus();
        return;
      }
      const firstEl = focusable[0];
      const lastEl = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (e.shiftKey && (active === firstEl || active === panel)) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && active === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    };

    // Lock background scroll while the dialog is open.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      openStack.splice(openStack.indexOf(token), 1);
      document.body.style.overflow = prevOverflow;
      // Restore focus to whatever opened the dialog.
      previouslyFocused.current?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  return (
    // Backdrop mousedown-to-dismiss (backdrop only, not children) is a
    // supplementary pointer affordance; keyboard users close via Escape (the
    // document keydown handler above) or the close button.
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:px-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={fullScreenOnPhone
          ? 'card flex w-full flex-col space-y-4 overflow-y-auto focus:outline-none max-sm:h-[100dvh] max-sm:!max-w-none max-sm:rounded-none max-sm:border-0 max-sm:px-4 max-sm:pb-0 max-sm:pt-[max(1rem,env(safe-area-inset-top))] sm:max-h-[92dvh] sm:rounded-2xl sm:pb-0'
          : 'card w-full max-h-[92dvh] space-y-4 overflow-y-auto rounded-b-none rounded-t-2xl pb-[max(1.5rem,env(safe-area-inset-bottom))] focus:outline-none max-sm:!max-w-none sm:rounded-2xl sm:pb-6'}
        style={{ maxWidth }}
      >
        {/* Sheet grab handle (phones only): signals 'this slides down / tap outside to close'. */}
        {!fullScreenOnPhone && <div className="mx-auto -mt-1 mb-1 h-1.5 w-10 rounded-full bg-line sm:hidden" aria-hidden="true" />}
        <div className="flex items-start justify-between gap-4">
          <h3 id={titleId} className="font-semibold text-ink">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="-mr-1.5 -mt-1.5 rounded-lg p-2.5 text-subtle hover:bg-cream hover:text-ink focus:outline-none focus:ring-2 focus:ring-purple/30"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export default Modal;
