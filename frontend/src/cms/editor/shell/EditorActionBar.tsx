import { useEffect, useState, type ReactNode, type Ref } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ExternalLink, Eye, Pencil, Redo2, Undo2 } from 'lucide-react';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { MoreMenu, type MenuItem } from './MoreMenu';
import { ReviewChip, StatusChip } from './StatusChip';
import { SaveIndicator } from './SaveIndicator';
import type { PageState } from './status';
import type { SaveStatus } from './useDraftSaver';

export interface SaveInfo {
  status: SaveStatus;
  lastSavedAt: number | null;
  serverSavedAt?: string | null;
  onRetry: () => void;
}

export interface HistoryInfo {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}

export type EditorPane = 'edit' | 'preview';

interface Props {
  backTo: string;
  title: string;
  /** Public address, shown under the title. */
  path: string;
  /** Link to the live page when it is published. */
  liveHref?: string | null;
  state: PageState;
  save: SaveInfo;
  history: HistoryInfo;
  /** Primary actions (Revisar, Vista previa, Publicar or Solicitar aprobación), desktop only. */
  actions: ReactNode;
  more: MenuItem[];
  /** Phones and tablets: «Editar | Vista previa». */
  pane?: { value: EditorPane; onChange: (p: EditorPane) => void };
  desktop: boolean;
  /** Conflict and save-error notices: they stay in view with the bar. */
  alerts?: ReactNode;
  /** The sticky element itself (the editor measures it to place its own sticky column). */
  barRef?: Ref<HTMLDivElement>;
}

const iconBtn = 'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-sm text-subtle hover:bg-white hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40 disabled:opacity-30 disabled:hover:bg-transparent';

/**
 * The editor's top bar: always in view (sticky inside the console's scroll
 * area), with the page state, the autosave state, undo/redo, the primary
 * actions on one row from 1024 px and the rest in «Más».
 */
export function EditorActionBar({ backTo, title, path, liveHref, state, save, history, actions, more, pane, desktop, alerts, barRef }: Props) {
  return (
    <div
      ref={barRef}
      data-editor-bar
      className="sticky top-0 z-sticky -mx-[clamp(16px,4vw,32px)] mb-4 border-b border-line bg-cream px-[clamp(16px,4vw,32px)] py-2"
    >
      {/* One row from 1280 px; below that the actions take a second row together, so «Publicar» never wraps alone. */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
        <div className="flex min-w-0 flex-1 basis-full items-center gap-2 xl:basis-0">
          <Link to={backTo} className={iconBtn} aria-label="Volver a Contenido" title="Volver a Contenido">
            <ChevronLeft size={20} aria-hidden="true" />
          </Link>
          <div className="min-w-0 flex-1">
            <h1 className="truncate font-head text-base font-bold text-ink sm:text-lg" title={title}>{title}</h1>
            <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
              <StatusChip state={state} />
              {state.review && <ReviewChip />}
              {desktop && (liveHref
                ? <a href={liveHref} target="_blank" rel="noopener noreferrer" className="inline-flex min-w-0 items-center gap-1 font-mono text-xs text-subtle hover:text-purple"><span className="truncate">{path}</span><ExternalLink size={12} aria-hidden="true" /><span className="sr-only">(abre en otra pestaña)</span></a>
                : <span className="truncate font-mono text-xs text-subtle">{path}</span>)}
              <SaveIndicator {...save} compact={!desktop} />
            </div>
          </div>
          <div className="flex shrink-0 items-center" role="group" aria-label="Historial de cambios">
            <button type="button" className={iconBtn} aria-label="Deshacer (Ctrl+Z)" title="Deshacer (Ctrl+Z)" disabled={!history.canUndo} onClick={history.onUndo}><Undo2 size={18} /></button>
            <button type="button" className={iconBtn} aria-label="Rehacer (Ctrl+Shift+Z)" title="Rehacer (Ctrl+Shift+Z)" disabled={!history.canRedo} onClick={history.onRedo}><Redo2 size={18} /></button>
          </div>
        </div>
        {desktop && (
          <div className="ml-auto flex shrink-0 flex-nowrap items-center gap-2" role="group" aria-label="Acciones de la página">
            {actions}
            <MoreMenu items={more} />
          </div>
        )}
      </div>
      {pane && !desktop && (
        <div role="tablist" aria-label="Modo del editor" className="mt-2 grid grid-cols-2 gap-1 rounded-md bg-white p-1 ring-1 ring-line">
          {([['edit', 'Editar', Pencil], ['preview', 'Vista previa', Eye]] as const).map(([value, label, Icon]) => (
            <button
              key={value}
              type="button"
              role="tab"
              id={`editor-tab-${value}`}
              aria-selected={pane.value === value}
              aria-controls={`editor-pane-${value}`}
              tabIndex={pane.value === value ? 0 : -1}
              onClick={() => pane.onChange(value)}
              onKeyDown={(e) => {
                if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
                e.preventDefault();
                const next = value === 'edit' ? 'preview' : 'edit';
                pane.onChange(next);
                document.getElementById(`editor-tab-${next}`)?.focus();
              }}
              className={`inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-sm text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40 ${pane.value === value ? 'bg-purple text-white shadow-sm' : 'text-muted hover:text-ink'}`}
            >
              <Icon size={15} aria-hidden="true" /> {label}
            </button>
          ))}
        </div>
      )}
      {alerts && <div className="mt-2 space-y-2">{alerts}</div>}
    </div>
  );
}

/** True while the on-screen keyboard shrinks the visual viewport (same rule as MobileTabBar). */
function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const check = () => setOpen(vv.height < window.innerHeight * 0.75);
    vv.addEventListener('resize', check);
    return () => vv.removeEventListener('resize', check);
  }, []);
  return open;
}

/** Height of the console's fixed bottom tab bar (admin routes on phones), 0 when absent. */
function useBottomNavHeight(): number {
  const [h, setH] = useState(0);
  useEffect(() => {
    let raf = 0;
    const measure = () => {
      const nav = document.querySelector<HTMLElement>('nav[aria-label="Navegación principal"]');
      const r = nav?.getBoundingClientRect();
      // +16: the active tab's bump and dot rise above the bar's top edge.
      setH(nav && r && r.height > 0 && getComputedStyle(nav).position === 'fixed' ? Math.max(0, Math.round(window.innerHeight - r.top) + 16) : 0);
    };
    const later = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => setTimeout(measure, 60)); };
    measure();
    window.addEventListener('resize', later);
    window.visualViewport?.addEventListener('resize', later);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', later);
      window.visualViewport?.removeEventListener('resize', later);
    };
  }, []);
  return h;
}

/**
 * Phones and tablets: the actions sit in a bar at the bottom of the screen,
 * above the console's tab bar, with the safe-area padding of notched phones.
 * Hidden while the keyboard is open so the field being typed stays in view.
 */
export function EditorBottomBar({ actions, more }: { actions: ReactNode; more: MenuItem[] }) {
  const keyboardOpen = useKeyboardOpen();
  const navHeight = useBottomNavHeight();
  // Narrow phones: «Más» becomes a 44 px «⋯» so the main button keeps its words.
  const roomy = useMediaQuery('(min-width: 480px)');
  if (keyboardOpen) return null;
  return (
    <>
      {/* Keeps the end of the page clear of the bar. */}
      <div aria-hidden="true" className="h-20" />
      <div
        role="region"
        aria-label="Acciones de la página"
        className="fixed inset-x-0 z-sticky border-t border-line bg-white/95 px-3 pt-2 shadow-[0_-6px_24px_-12px_rgba(64,26,142,0.25)] backdrop-blur-lg"
        style={{ bottom: navHeight, paddingBottom: navHeight ? 8 : 'max(8px, env(safe-area-inset-bottom))' }}
      >
        <div className="mx-auto flex max-w-3xl items-center gap-2 [&>*]:min-w-0">
          {actions}
          <MoreMenu items={more} placement="up" iconOnly={!roomy} label={roomy ? 'Más' : 'Más acciones'} />
        </div>
      </div>
    </>
  );
}
