/**
 * Icon picker (contract C5 «Icon»): a grid of the icons with their Spanish
 * names and a search box. Arrow keys move inside the grid, Enter picks,
 * Escape closes. The stored value is the icon's key (e.g. «Users»).
 */
import { useMemo, useRef, useState, type ComponentType, type KeyboardEvent } from 'react';
import { Ban, Search } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { WhatsAppIcon } from '@/components/icons/WhatsAppIcon';
import { CMS_ICONS } from '../../icons';
import { describedBy, FieldLabel, FieldNotes, type FieldBaseProps } from './FieldShell';
import { ICON_NAMES, iconName } from './iconNames';

export interface IconChoice { value: string; Icon: ComponentType<{ size?: number | string; className?: string }> }

/** The curated set of designed sections, plus the WhatsApp logo. */
export const CMS_ICON_CHOICES: IconChoice[] = [
  ...Object.entries(CMS_ICONS).map(([value, Icon]) => ({ value, Icon })),
  { value: 'WhatsApp', Icon: ({ size = 24, className }) => <WhatsAppIcon width={size} height={size} className={className} /> },
];

export interface IconFieldProps extends FieldBaseProps {
  value: string;
  onChange: (v: string) => void;
  /** Icons offered (default: the CMS set). */
  choices?: IconChoice[];
  /** Offer «Sin ícono» (empty value). */
  allowNone?: boolean;
  /** Smaller trigger for tight rows (Navegación). */
  compact?: boolean;
}

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export function IconField({ id, label, required, hint, error, warning, onBlur, value, onChange, choices = CMS_ICON_CHOICES, allowNone, compact }: IconFieldProps) {
  const [open, setOpen] = useState(false);
  const current = choices.find((c) => c.value === value);
  const Icon = current?.Icon;
  return (
    <div>
      <FieldLabel htmlFor={id} label={label} required={required} />
      <button
        id={id}
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-describedby={describedBy(id, { hint, error, warning })}
        aria-label={`${label}: ${value ? iconName(value) : 'sin ícono'}. Cambiar`}
        className={`flex min-h-[44px] w-full items-center gap-2 rounded-xl border bg-white px-2 text-left hover:border-purple/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-purple ${error ? 'border-coral-400' : 'border-line'}`}
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-cream-2 text-ink" aria-hidden="true">
          {Icon ? <Icon size={17} /> : <Ban size={15} className="text-subtle" />}
        </span>
        <span className={`min-w-0 flex-1 truncate text-sm ${value ? 'font-medium text-ink' : 'text-subtle'}`}>{value ? iconName(value) : 'Sin ícono'}</span>
        {!compact && <span className="shrink-0 text-xs font-semibold text-purple">Cambiar</span>}
      </button>
      <FieldNotes id={id} hint={hint} error={error} warning={warning} />
      <Modal open={open} onClose={() => { setOpen(false); onBlur?.(); }} title={`Elegir ícono: ${label}`} maxWidth={640}>
        {open && <IconGrid choices={choices} value={value} allowNone={allowNone} onPick={(v) => { if (v !== value) onChange(v); setOpen(false); onBlur?.(); }} onCancel={() => { setOpen(false); onBlur?.(); }} />}
      </Modal>
    </div>
  );
}

function IconGrid({ choices, value, allowNone, onPick, onCancel }: { choices: IconChoice[]; value: string; allowNone?: boolean; onPick: (v: string) => void; onCancel: () => void }) {
  const [q, setQ] = useState('');
  const gridRef = useRef<HTMLUListElement>(null);
  const shown = useMemo(() => {
    const n = norm(q.trim());
    const list = choices.filter((c) => !n || norm(`${iconName(c.value)} ${ICON_NAMES[c.value]?.words ?? ''} ${c.value}`).includes(n));
    return allowNone && !n ? [{ value: '', Icon: Ban }, ...list] : list;
  }, [choices, q, allowNone]);
  const selectedIndex = Math.max(0, shown.findIndex((c) => c.value === value));
  const [active, setActive] = useState(selectedIndex);
  const activeIndex = Math.min(active, Math.max(0, shown.length - 1));

  const move = (e: KeyboardEvent<HTMLUListElement>) => {
    const buttons = Array.from(gridRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? []);
    if (!buttons.length) return;
    // Columns = buttons on the first row (works with any grid width).
    const top = buttons[0].offsetTop;
    const cols = Math.max(1, buttons.filter((b) => b.offsetTop === top).length);
    const delta = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols }[e.key as 'ArrowRight'] ?? null;
    const next = delta !== null ? Math.min(buttons.length - 1, Math.max(0, activeIndex + delta)) : e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : -1;
    if (next < 0) return;
    e.preventDefault();
    setActive(next);
    buttons[next]?.focus();
  };

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" aria-hidden="true" />
        <input className="input-field pl-9" placeholder="Buscar: libro, pago, familia…" aria-label="Buscar ícono" value={q} onChange={(e) => { setQ(e.target.value); setActive(0); }} />
      </div>
      {shown.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">Ningún ícono coincide con la búsqueda.</p>
      ) : (
        // A list of buttons with a roving focus: Tab enters the grid once, arrows move inside it.
        // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
        <ul ref={gridRef} className="grid max-h-[55vh] grid-cols-3 gap-2 overflow-y-auto p-0.5 sm:grid-cols-5" aria-label="Íconos" onKeyDown={move}>
          {shown.map((c, i) => {
            const selected = c.value === value;
            return (
              <li key={c.value || 'none'}>
                <button
                  type="button"
                  tabIndex={i === activeIndex ? 0 : -1}
                  aria-pressed={selected}
                  onClick={() => onPick(c.value)}
                  onFocus={() => setActive(i)}
                  className={`flex min-h-[76px] w-full flex-col items-center justify-center gap-1.5 rounded-xl border p-2 text-center ${selected ? 'border-purple bg-purple/10 text-purple' : 'border-line bg-white text-ink hover:border-purple/50 hover:bg-purple/5'} focus-visible:outline focus-visible:outline-2 focus-visible:outline-purple`}
                >
                  <c.Icon size={22} className={c.value ? undefined : 'text-subtle'} />
                  <span className="text-[11px] leading-tight">{c.value ? iconName(c.value) : 'Sin ícono'}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex justify-end"><Button type="button" variant="ghost" size="sm" onClick={onCancel}>Cancelar</Button></div>
    </div>
  );
}
