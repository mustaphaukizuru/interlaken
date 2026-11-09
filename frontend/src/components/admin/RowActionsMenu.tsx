import { Fragment, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { MoreHorizontal, type LucideIcon } from 'lucide-react';

export interface RowMenuItem {
  key: string;
  label: string;
  icon?: LucideIcon;
  onSelect: () => void;
  /** Destructive: coral text, and a divider above it so it never sits next to a safe action. */
  danger?: boolean;
}

const WIDTH = 224;
const GAP = 6;

/**
 * The "⋯" menu for a row's less frequent actions (archive, delete, activity).
 *
 * Rendered in a portal and placed against its trigger, so a table that
 * scrolls sideways never clips it; it opens upward when there is no room
 * below and follows its row while the page scrolls. Keyboard: Enter or Space
 * opens it on the first item, the arrows, Home and End move, Esc closes and
 * gives focus back to the trigger.
 */
export function RowActionsMenu({ label, items }: { label: string; items: RowMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  // Pin the menu to its trigger. Runs on open and on every scroll, so the menu
  // follows its row (the page scrolls smoothly, and a click near the edge
  // keeps scrolling after the menu opens); it closes only once the row leaves
  // the screen.
  const place = () => {
    const r = trigger.current?.getBoundingClientRect();
    if (!r) return;
    if (r.bottom < 0 || r.top > window.innerHeight) {
      setOpen(false);
      return;
    }
    const height = menu.current?.offsetHeight ?? 0;
    const left = Math.max(8, Math.min(r.right - WIDTH, window.innerWidth - WIDTH - 8));
    const fitsBelow = r.bottom + GAP + height <= window.innerHeight - 8;
    setPos({ top: fitsBelow ? r.bottom + GAP : Math.max(8, r.top - GAP - height), left });
  };

  useLayoutEffect(() => {
    if (open) place();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onPointer = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!menu.current?.contains(t) && !trigger.current?.contains(t)) close();
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        close();
        trigger.current?.focus();
      }
    };
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', close);
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    // preventScroll: the menu may still be measuring off-screen at this point.
    menu.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus({ preventScroll: true });
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', close);
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End'];
    if (!keys.includes(e.key)) return;
    e.preventDefault();
    const entries = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
    const i = entries.indexOf(document.activeElement as HTMLButtonElement);
    const last = entries.length - 1;
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? last
      : e.key === 'ArrowDown' ? (i + 1) % entries.length : (i - 1 + entries.length) % entries.length;
    entries[next]?.focus();
  };

  if (items.length === 0) return null;
  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title="Más acciones"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-subtle transition-colors hover:bg-cream-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40 lg:min-h-[36px] lg:min-w-[36px]"
      >
        <MoreHorizontal size={18} aria-hidden="true" />
      </button>
      {open && createPortal(
        <div
          ref={menu}
          role="menu"
          aria-label={label}
          tabIndex={-1}
          onKeyDown={onMenuKey}
          style={{ position: 'fixed', top: pos?.top ?? -9999, left: pos?.left ?? -9999, width: WIDTH }}
          className="z-[60] rounded-xl border border-line bg-white p-1.5 shadow-[0_12px_32px_-12px_rgba(16,12,40,0.35)] motion-safe:animate-[dropdown-in_0.16s_ease-out]"
        >
          {items.map((it) => {
            const Icon = it.icon;
            return (
              <Fragment key={it.key}>
                {it.danger && <div role="separator" className="my-1 h-px bg-line" />}
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => { setOpen(false); it.onSelect(); }}
                  className={`flex min-h-[44px] w-full items-center gap-2.5 rounded-lg px-3 text-left text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40 ${
                    it.danger ? 'text-coral-700 hover:bg-coral-50' : 'text-ink hover:bg-cream-2'
                  }`}
                >
                  {Icon && <Icon size={16} aria-hidden="true" />}
                  {it.label}
                </button>
              </Fragment>
            );
          })}
        </div>,
        document.body,
      )}
    </>
  );
}

export default RowActionsMenu;
