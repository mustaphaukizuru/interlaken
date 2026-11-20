import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { ChevronDown, MoreHorizontal, type LucideIcon } from 'lucide-react';

export interface MenuItem {
  key: string;
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
  /** Small text under the label. */
  hint?: string;
}

interface Props {
  items: MenuItem[];
  label?: string;
  /** A 44 px «⋯» button named `label` (per-row menus) instead of the text button. */
  iconOnly?: boolean;
  /** Open upwards (bottom bar on phones). */
  placement?: 'down' | 'up';
  className?: string;
}

/**
 * «Más»: an accessible menu button (role=menu, arrow keys, Home/End, Escape
 * and Tab close and return focus to the button). Items are 44 px tall.
 */
export function MoreMenu({ items, label = 'Más', iconOnly = false, placement = 'down', className = '' }: Props) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const enabled = items.filter((i) => !i.disabled);

  const focusItem = (index: number) => {
    const nodes = wrap.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])');
    if (!nodes || nodes.length === 0) return;
    nodes[(index + nodes.length) % nodes.length]?.focus();
  };
  const close = (returnFocus = true) => {
    setOpen(false);
    if (returnFocus) button.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    wrap.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not([disabled])')?.focus();
    const onDown = (e: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const nodes = Array.from(wrap.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])') ?? []);
    const at = nodes.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); focusItem(at + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); focusItem(at - 1); }
    else if (e.key === 'Home') { e.preventDefault(); focusItem(0); }
    else if (e.key === 'End') { e.preventDefault(); focusItem(nodes.length - 1); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'Tab') close(false);
  };

  return (
    <div ref={wrap} className={`relative ${className}`.trim()}>
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setOpen(true); } }}
        disabled={enabled.length === 0}
        aria-label={iconOnly ? label : undefined}
        title={iconOnly ? label : undefined}
        className={iconOnly
          ? 'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-subtle hover:bg-cream hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40 disabled:opacity-40'
          : 'inline-flex min-h-[44px] items-center justify-center gap-1 whitespace-nowrap rounded-full border-2 border-line bg-white px-4 text-sm font-semibold text-ink transition hover:border-purple hover:text-purple focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40 disabled:opacity-50'}
      >
        {iconOnly ? <MoreHorizontal size={18} aria-hidden="true" /> : (
          <>
            {label}
            <ChevronDown size={16} aria-hidden="true" className={`transition-transform ${open ? 'rotate-180' : ''}`} />
          </>
        )}
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label={label}
          tabIndex={-1}
          onKeyDown={onMenuKey}
          style={{ width: 'min(290px, calc(100vw - 24px))' }}
          className={`absolute right-0 z-50 overflow-hidden rounded-2xl border border-line bg-white p-1.5 shadow-[0_20px_54px_-18px_rgba(16,12,40,0.32)] ${placement === 'up' ? 'bottom-[calc(100%+8px)]' : 'top-[calc(100%+8px)]'}`}
        >
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              // Focus goes back to «Más» first, so a dialog opened by the item returns it there.
              onClick={() => { close(); item.onSelect(); }}
              className={`flex min-h-[44px] w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-purple/40 disabled:opacity-40 ${item.danger ? 'text-coral-700 hover:bg-coral-50' : 'text-ink hover:bg-cream'}`}
            >
              <item.icon size={17} aria-hidden="true" className={`shrink-0 ${item.danger ? '' : 'text-subtle'}`} />
              <span className="min-w-0">
                <span className="block">{item.label}</span>
                {item.hint && <span className="block text-xs font-normal text-subtle">{item.hint}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
