import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  CalendarCheck, Download, GraduationCap, Megaphone, Search, Settings, X,
} from 'lucide-react';
import { bookingsApi, portalApi } from '@/services/api';
import type { Booking, StudentProfile } from '@/types';

interface Item {
  key: string;
  group: 'Acciones' | 'Alumnos' | 'Reservas';
  icon: typeof Search;
  title: string;
  detail: string;
  to: string;
}

/**
 * Palette actions: quick navigation + entry points that open the target page's
 * own flow via a URL param (the page keeps every confirmation it already has —
 * actions never skip them). Filtered accent-insensitively while typing.
 */
const ACTIONS: Item[] = [
  {
    key: 'act-comunicado', group: 'Acciones', icon: Megaphone,
    title: 'Crear comunicado', detail: 'Abre el redactor de comunicados',
    to: '/admin/comunicados?nuevo=1',
  },
  {
    key: 'act-export-cafeteria', group: 'Acciones', icon: Download,
    title: 'Exportar saldos de cafetería', detail: 'CSV de toda la escuela',
    to: '/admin/cafeteria?exportar=csv',
  },
  {
    key: 'act-visitas', group: 'Acciones', icon: CalendarCheck,
    title: 'Ir a Visitas', detail: '/admin/visitas', to: '/admin/visitas',
  },
  {
    key: 'act-ajustes', group: 'Acciones', icon: Settings,
    title: 'Ir a Ajustes', detail: '/admin/ajustes', to: '/admin/ajustes',
  },
];

const normalize = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

function useDebounced(value: string, ms = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

const asList = <T,>(data: unknown): T[] =>
  Array.isArray(data) ? (data as T[]) : ((data as { results?: T[] })?.results ?? []);

/**
 * Global admin search + actions (Ctrl/Cmd+K): an 'Acciones' group (quick navs
 * and flows opened via URL params on the target page) plus alumnos y reservas
 * from one box, grouped, keyboard-navigable. Search hits the existing
 * list endpoints (?search= / ?q=) — no new backend surface.
 */
export function CommandPalette() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    // Lets the header search box open the same palette (no duplicated search UI).
    const onOpen = () => setOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('open-command-palette', onOpen);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('open-command-palette', onOpen);
    };
  }, []);

  if (!open) return null;
  return <PalettePanel onClose={() => setOpen(false)} />;
}

/**
 * The open palette. Mounted only while visible, so every open starts with a
 * fresh query/highlight (no "reset on open" effects) and mount/unmount carry
 * the scroll lock, focus move and focus restore.
 */
function PalettePanel({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const navigate = useNavigate();
  const q = useDebounced(query.trim());
  const enabled = q.length >= 2;

  // Move focus into the box shortly after the palette appears.
  useEffect(() => {
    const t = window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => window.clearTimeout(t);
  }, []);

  // Lock background scroll while the palette is open.
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  // Restore focus to whatever opened the palette (Ctrl+K target or the header
  // search button) once it closes — Escape, backdrop and X all pass through here.
  useEffect(() => {
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    return () => {
      previouslyFocused.current?.focus?.();
    };
  }, []);

  // Trap Tab within the palette while open (simplified Modal trap).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = Array.from(
        panel.querySelectorAll<HTMLElement>('button, input, [tabindex]:not([tabindex="-1"])')
      ).filter((el) => el.getClientRects().length > 0);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeEl = document.activeElement;
      if (e.shiftKey && activeEl === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && activeEl === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  const students = useQuery({
    queryKey: ['palette-students', q],
    queryFn: async () => asList<StudentProfile>((await portalApi.getStudents({ search: q })).data),
    enabled,
    staleTime: 30_000,
  });
  const bookings = useQuery({
    queryKey: ['palette-bookings', q],
    queryFn: async () => asList<Booking>((await bookingsApi.getAdminBookings({ q })).data),
    enabled,
    staleTime: 30_000,
  });

  const items = useMemo<Item[]>(() => {
    // Actions are always available: all of them on an empty box, narrowed
    // (accent-insensitively) while typing.
    const nq = normalize(q);
    const actions = nq
      ? ACTIONS.filter((a) => normalize(`${a.title} ${a.detail}`).includes(nq))
      : ACTIONS;
    if (!enabled) return actions;
    return [
      ...actions,
      ...(students.data ?? []).slice(0, 5).map((s): Item => ({
        key: `s-${s.id}`,
        group: 'Alumnos',
        icon: GraduationCap,
        title: `${s.user?.first_name ?? ''} ${s.user?.last_name ?? ''}`.trim() || s.student_id,
        detail: `${s.student_id} · ${s.grade}${s.group ? ` ${s.group}` : ''}`,
        to: `/admin/cafeteria/${s.id}`,
      })),
      ...(bookings.data ?? []).slice(0, 5).map((b): Item => ({
        key: `b-${b.id}`,
        group: 'Reservas',
        icon: CalendarCheck,
        title: b.parent_name,
        detail: `${b.slot_date} · ${b.child_name || b.parent_email}`,
        to: '/admin/visitas',
      })),
    ];
  }, [enabled, q, students.data, bookings.data]);

  const searching = enabled && (students.isFetching || bookings.isFetching);

  // The keyboard highlight is keyed to the (query, result set) it was chosen
  // in; when either changes it derives back to the first item during render —
  // replacing the old `setActive(0)` reset effect.
  const [activeSel, setActiveSel] = useState<{ q: string; len: number; index: number } | null>(null);
  const active =
    activeSel && activeSel.q === q && activeSel.len === items.length ? activeSel.index : 0;
  const setActive = (index: number) => setActiveSel({ q, len: items.length, index });

  const go = (item: Item) => {
    onClose();
    navigate(item.to);
  };

  const onInputKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive(Math.min(active + 1, items.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(Math.max(active - 1, 0));
    } else if (e.key === 'Enter' && items[active]) {
      e.preventDefault();
      go(items[active]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  let lastGroup = '';
  return (
    // Backdrop click-to-dismiss (backdrop only, not children) is a supplementary
    // pointer affordance; keyboard users close via Escape (onInputKey) or the
    // close button.
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center bg-ink/40 p-4 pt-[8vh] sm:pt-[12vh]"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={panelRef}
        className="w-full max-w-lg overflow-hidden rounded-xl2 bg-white shadow-card"
        role="dialog"
        aria-modal="true"
        aria-label="Búsqueda global"
      >
        <div className="flex items-center gap-2 border-b border-ink/10 px-4">
          <Search size={17} className="shrink-0 text-muted" aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onInputKey}
            placeholder="Buscar alumnos o reservas…"
            aria-label="Buscar alumnos o reservas"
            role="combobox"
            aria-expanded={items.length > 0}
            aria-controls="cmdk-list"
            aria-autocomplete="list"
            aria-activedescendant={items[active] ? `cmdk-opt-${items[active].key}` : undefined}
            className="h-12 w-full bg-transparent text-[15px] text-ink outline-none placeholder:text-subtle"
          />
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar búsqueda"
            className="rounded p-2.5 min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 inline-flex items-center justify-center text-muted hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-green"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        {/* Hint lives OUTSIDE the listbox: a listbox may only contain options
            (aria-required-children), and with palette actions the listbox is
            non-empty even before typing. */}
        {q.length < 2 && (
          <p className="px-3 pb-0 pt-4 text-center text-sm text-muted">
            Escriba al menos 2 caracteres. Consejo: <kbd className="rounded border border-ink/15 px-1">Ctrl</kbd>+<kbd className="rounded border border-ink/15 px-1">K</kbd> abre esta búsqueda.
          </p>
        )}
        {/* role="listbox" only when there are options — an empty listbox fails
            aria-required-children; status messages render in a plain div. */}
        <div
          id="cmdk-list"
          className="max-h-[50vh] overflow-y-auto p-2"
          role={items.length ? 'listbox' : undefined}
          aria-label={items.length ? 'Resultados' : undefined}
        >
          {q.length >= 2 && searching && !items.length ? (
            <p className="px-3 py-6 text-center text-sm text-muted">Buscando…</p>
          ) : q.length >= 2 && !items.length ? (
            <p className="px-3 py-6 text-center text-sm text-muted">Sin resultados para “{q}”.</p>
          ) : (
            items.map((item, i) => {
              const header = item.group !== lastGroup ? item.group : null;
              lastGroup = item.group;
              const Icon = item.icon;
              return (
                <div key={item.key} role="group">
                  {header && (
                    <p className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-subtle">
                      {header}
                    </p>
                  )}
                  <button
                    type="button"
                    id={`cmdk-opt-${item.key}`}
                    role="option"
                    aria-selected={i === active}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => go(item)}
                    className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left ${
                      i === active ? 'bg-green/10 text-ink' : 'text-ink/90 hover:bg-ink/5'
                    }`}
                  >
                    <Icon size={16} className="shrink-0 text-green-dark" aria-hidden="true" />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{item.title}</span>
                      <span className="block truncate text-xs text-muted">{item.detail}</span>
                    </span>
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
