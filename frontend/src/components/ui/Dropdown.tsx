import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/** Gap kept between an open panel and the screen edges (px). */
const EDGE = 12;

interface DropdownProps {
  /** Renders the trigger button; receives current open state + a toggle handler. */
  trigger: (args: { open: boolean; toggle: () => void }) => ReactNode;
  /** Panel body; receives a close handler for menu items to call on select. */
  children: (args: { close: () => void }) => ReactNode;
  /** Which edge of the panel aligns to the trigger. Default 'right'. */
  align?: 'left' | 'right';
  /** Preferred panel width (px); capped to the viewport so it never overflows on phones. */
  width?: number;
}

/**
 * Lightweight headless popover for header menus (notifications, account).
 * Handles outside-click, Escape, and viewport-safe width — no external dep.
 * Plain popover semantics: the trigger carries `aria-expanded` +
 * `aria-haspopup="true"` (set by the caller); the panel itself has no ARIA
 * role. Escape and outside-click both close and return focus to the trigger.
 */
export function Dropdown({ trigger, children, align = 'right', width = 320 }: DropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Keep the panel on screen: anchored to its trigger, but shifted sideways
  // when that edge would cross the viewport (a «+» button that sits left of
  // the bell on a 375 px phone pushed a 280 px menu 17 px off-screen). Uses the
  // `translate` property so the open animation's `transform` is untouched.
  useLayoutEffect(() => {
    const el = panelRef.current;
    if (!open || !el) return;
    const place = () => {
      el.style.translate = '';
      const r = el.getBoundingClientRect();
      const vw = document.documentElement.clientWidth;
      const shift = r.left < EDGE ? EDGE - r.left : r.right > vw - EDGE ? vw - EDGE - r.right : 0;
      if (shift) el.style.translate = `${Math.round(shift)}px 0`;
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    // The trigger is the first button inside the wrapper (the panel renders after it).
    const focusTrigger = () => ref.current?.querySelector<HTMLElement>('button')?.focus();
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        focusTrigger();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        focusTrigger();
      }
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      {trigger({ open, toggle: () => setOpen((v) => !v) })}
      {open && (
        <div
          ref={panelRef}
          style={{ width: `min(${width}px, calc(100vw - ${EDGE * 2}px))` }}
          className={`absolute top-[calc(100%+10px)] z-dropdown origin-top animate-[dropdown-in_0.16s_ease-out] overflow-hidden rounded-md bg-white shadow-raised ${ align === 'right' ? 'right-0' : 'left-0'
          }`}
        >
          {children({ close: () => setOpen(false) })}
        </div>
      )}
    </div>
  );
}

export default Dropdown;
