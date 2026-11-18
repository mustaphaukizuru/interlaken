import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';
import { useSelectedChildStore } from '@/store/selectedChildStore';

export type SwitcherChild = {
  id: number;
  name: string;
  grade?: string;
  group?: string;
};

interface ChildSwitcherProps {
  students: SwitcherChild[];
  /** When true, include a "Todos" chip (useful on list pages). */
  allowAll?: boolean;
  /** The page's effective child, when the page owns the default (e.g. a
   *  ?alumno= link): the chips show it and the switcher never picks one itself. */
  selected?: number | null;
  className?: string;
}

/** Up to this many children a family sees chips; more (an admin viewing the
 *  whole school) get a searchable picker instead of a wall of names. */
export const CHIP_LIMIT = 6;

const metaOf = (c: SwitcherChild) => [c.grade, c.group].filter(Boolean).join(' · ');
/** Lowercase, accents off: «Sofía» is found by «sofia». */
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * Pick among linked children. Persists selection so Cafetería can filter to
 * the same alumno. A family (a few children) gets a compact chip row; above
 * CHIP_LIMIT the same choice is a searchable listbox.
 */
export function ChildSwitcher({ students, allowAll = false, selected, className = '' }: ChildSwitcherProps) {
  const storedId = useSelectedChildStore((s) => s.childId);
  const setChildId = useSelectedChildStore((s) => s.setChildId);
  const controlled = selected !== undefined;
  const childId = controlled ? selected : storedId;

  // Drop a stale id (unlinked child) and default to first when "Todos" is off.
  useEffect(() => {
    if (controlled || !students.length) return;
    const valid = childId != null && students.some((c) => c.id === childId);
    if (valid) return;
    if (allowAll) {
      if (childId != null) setChildId(null);
      return;
    }
    setChildId(students[0].id);
  }, [students, childId, allowAll, controlled, setChildId]);

  if (students.length < 2) return null;

  if (students.length > CHIP_LIMIT) {
    return <ChildPicker students={students} allowAll={allowAll} childId={childId ?? null} onPick={setChildId} className={className} />;
  }

  const chip = (active: boolean) =>
    `min-h-[44px] rounded-xl border px-3.5 py-2 text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40 ${
      active
        ? 'border-purple/40 bg-purple text-white shadow-[0_6px_14px_-8px_rgba(64,26,142,0.55)]'
        : 'border-line bg-white text-ink hover:border-purple/25 hover:bg-cream'
    }`;

  return (
    <div
      className={`flex flex-wrap items-center gap-2 ${className}`}
      role="group"
      aria-label="Seleccionar alumno"
    >
      {allowAll && (
        <button type="button" className={chip(childId == null)} onClick={() => setChildId(null)}>
          Todos
        </button>
      )}
      {students.map((c) => {
        const active = childId === c.id;
        const meta = metaOf(c);
        return (
          <button
            key={c.id}
            type="button"
            className={chip(active)}
            onClick={() => setChildId(c.id)}
            aria-pressed={active}
          >
            {c.name}
            {meta ? <span className={`ml-1.5 font-medium ${active ? 'text-white/70' : 'text-subtle'}`}>{meta}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

interface Option { id: number | null; name: string; meta: string; haystack: string }

/**
 * A button showing the current alumno; it opens a search box over a listbox
 * (ARIA combobox + listbox): type to filter by name, grade or group, arrows
 * to move, Enter to choose, Escape to close. Focus returns to the button.
 */
function ChildPicker({ students, allowAll, childId, onPick, className }: {
  students: SwitcherChild[];
  allowAll: boolean;
  childId: number | null;
  onPick: (id: number | null) => void;
  className: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const uid = useId();
  const listId = `${uid}-list`;
  const optId = (i: number) => `${uid}-opt-${i}`;

  const options = useMemo<Option[]>(() => [
    ...(allowAll ? [{ id: null, name: 'Todos los alumnos', meta: '', haystack: '' }] : []),
    ...students.map((c) => ({ id: c.id, name: c.name, meta: metaOf(c), haystack: fold(`${c.name} ${c.grade ?? ''} ${c.group ?? ''}`) })),
  ], [students, allowAll]);

  const filtered = useMemo(() => {
    const words = fold(query).split(/\s+/).filter(Boolean);
    if (!words.length) return options;
    return options.filter((o) => o.id !== null && words.every((w) => o.haystack.includes(w)));
  }, [options, query]);

  const current = options.find((o) => o.id === childId) ?? (allowAll ? options[0] : undefined);

  const openPicker = () => {
    setQuery('');
    setActive(Math.max(0, options.findIndex((o) => o.id === childId)));
    setOpen(true);
  };
  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
  };
  const pick = (o: Option | undefined) => {
    if (!o) return;
    onPick(o.id);
    close();
  };

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Keep the keyboard-active option in view (jsdom has no scrollIntoView).
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView?.({ block: 'nearest' });
  }, [active, open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  const onInputKey = (e: KeyboardEvent<HTMLInputElement>) => {
    const last = filtered.length - 1;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, last)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Home') { e.preventDefault(); setActive(0); }
    else if (e.key === 'End') { e.preventDefault(); setActive(Math.max(last, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); pick(filtered[active]); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'Tab') close(false);
  };

  const onButtonKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); openPicker(); }
  };

  return (
    <div ref={wrapRef} className={`relative w-full max-w-md ${className}`.trim()}>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? close() : openPicker())}
        onKeyDown={onButtonKey}
        className="flex min-h-[48px] w-full items-center gap-3 rounded-xl border border-line bg-white px-3.5 py-2 text-left shadow-card transition-colors hover:border-purple/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40"
      >
        <span className="min-w-0 flex-1">
          <span className="sr-only">Alumno: </span>
          <span className="block truncate text-[14px] font-semibold text-ink">{current?.name ?? 'Elegir alumno'}</span>
          <span className="block truncate text-xs text-subtle">
            {current?.meta ? `${current.meta} · ` : ''}{students.length.toLocaleString('es-MX')} alumnos
          </span>
        </span>
        <ChevronDown size={18} className={`shrink-0 text-muted transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-[calc(100%+8px)] z-40 overflow-hidden rounded-2xl border border-line bg-white shadow-[0_20px_54px_-18px_rgba(16,12,40,0.32)]">
          <div className="relative border-b border-line p-2">
            <Search size={16} className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-subtle" aria-hidden="true" />
            <label htmlFor={`${uid}-q`} className="sr-only">Buscar alumno por nombre, grado o grupo</label>
            <input
              id={`${uid}-q`}
              ref={inputRef}
              type="text"
              role="combobox"
              aria-expanded="true"
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={filtered[active] ? optId(active) : undefined}
              autoComplete="off"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setActive(0); }}
              onKeyDown={onInputKey}
              placeholder="Buscar por nombre, grado o grupo"
              className="input-field min-h-[44px] w-full pl-9 text-sm"
            />
          </div>
          <ul ref={listRef} id={listId} role="listbox" aria-label="Alumnos" className="max-h-[min(360px,50vh)] overflow-y-auto overscroll-contain py-1">
            {filtered.map((o, i) => {
              const isSelected = o.id === childId;
              return (
                // Options are chosen with the pointer here and with the
                // keyboard through the combobox input (aria-activedescendant).
                // eslint-disable-next-line jsx-a11y/click-events-have-key-events
                <li
                  key={o.id ?? 'all'}
                  id={optId(i)}
                  data-index={i}
                  role="option"
                  aria-selected={isSelected}
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={() => pick(o)}
                  onMouseMove={() => active !== i && setActive(i)}
                  className={`mx-1 flex min-h-[44px] cursor-pointer items-center gap-3 rounded-lg px-3 py-2 ${i === active ? 'bg-cream' : ''}`}
                >
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate text-sm ${isSelected ? 'font-semibold text-purple' : 'font-medium text-ink'}`}>{o.name}</span>
                    {o.meta && <span className="block truncate text-xs text-subtle">{o.meta}</span>}
                  </span>
                  {isSelected && <Check size={16} className="shrink-0 text-purple" aria-hidden="true" />}
                </li>
              );
            })}
          </ul>
          {filtered.length === 0 && (
            <p role="status" className="px-4 py-6 text-center text-sm text-muted">Ningún alumno coincide con «{query}».</p>
          )}
          <p className="border-t border-line px-4 py-2 text-[11px] text-subtle" aria-live="polite">
            {query ? `${filtered.length} de ${students.length} alumnos` : `${students.length} alumnos`}
          </p>
        </div>
      )}
    </div>
  );
}

export default ChildSwitcher;
