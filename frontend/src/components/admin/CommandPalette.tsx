import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CalendarCheck, GraduationCap, Receipt, Search, X } from 'lucide-react';
import { bookingsApi, financeApi, portalApi } from '@/services/api';
import type { Booking, Invoice, StudentProfile } from '@/types';

interface Item {
  key: string;
  group: 'Alumnos' | 'Reservas' | 'Facturas';
  icon: typeof Search;
  title: string;
  detail: string;
  to: string;
}

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
 * Global admin search (Ctrl/Cmd+K): alumnos, reservas y facturas from one
 * box, grouped, keyboard-navigable. Search hits the existing list endpoints
 * (?search= / ?q=) — no new backend surface.
 */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const navigate = useNavigate();
  const q = useDebounced(query.trim());
  const enabled = open && q.length >= 2;

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

  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
      window.setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  // Lock background scroll while the palette is open.
  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  // Restore focus to whatever opened the palette (Ctrl+K target or the header
  // search button) once it closes — Escape, backdrop and X all pass through here.
  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    return () => {
      previouslyFocused.current?.focus?.();
    };
  }, [open]);

  // Trap Tab within the palette while open (simplified Modal trap).
  useEffect(() => {
    if (!open) return;
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
  }, [open]);

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
  const invoices = useQuery({
    queryKey: ['palette-invoices', q],
    queryFn: async () => asList<Invoice>((await financeApi.getAdminInvoices({ q })).data),
    enabled,
    staleTime: 30_000,
  });

  const items = useMemo<Item[]>(() => {
    if (!enabled) return [];
    return [
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
      ...(invoices.data ?? []).slice(0, 5).map((f): Item => ({
        key: `f-${f.id}`,
        group: 'Facturas',
        icon: Receipt,
        title: f.student_name,
        detail: `${f.period_label || f.period} · ${f.status}`,
        to: '/admin/finanzas',
      })),
    ];
  }, [enabled, students.data, bookings.data, invoices.data]);

  const searching = enabled && (students.isFetching || bookings.isFetching || invoices.isFetching);

  useEffect(() => setActive(0), [items.length, q]);

  if (!open) return null;

  const go = (item: Item) => {
    setOpen(false);
    navigate(item.to);
  };

  const onInputKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, items.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter' && items[active]) {
      e.preventDefault();
      go(items[active]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
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
      onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
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
            placeholder="Buscar alumnos, reservas, facturas…"
            aria-label="Buscar alumnos, reservas o facturas"
            role="combobox"
            aria-expanded={items.length > 0}
            aria-controls="cmdk-list"
            aria-autocomplete="list"
            aria-activedescendant={items[active] ? `cmdk-opt-${items[active].key}` : undefined}
            className="h-12 w-full bg-transparent text-[15px] text-ink outline-none placeholder:text-subtle"
          />
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Cerrar búsqueda"
            className="rounded p-2.5 min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 inline-flex items-center justify-center text-muted hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-green"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        {/* role="listbox" only when there are options — an empty listbox fails
            aria-required-children; status messages render in a plain div. */}
        <div
          id="cmdk-list"
          className="max-h-[50vh] overflow-y-auto p-2"
          role={items.length ? 'listbox' : undefined}
          aria-label={items.length ? 'Resultados' : undefined}
        >
          {q.length < 2 ? (
            <p className="px-3 py-6 text-center text-sm text-muted">
              Escriba al menos 2 caracteres. Consejo: <kbd className="rounded border border-ink/15 px-1">Ctrl</kbd>+<kbd className="rounded border border-ink/15 px-1">K</kbd> abre esta búsqueda.
            </p>
          ) : searching && !items.length ? (
            <p className="px-3 py-6 text-center text-sm text-muted">Buscando…</p>
          ) : !items.length ? (
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
