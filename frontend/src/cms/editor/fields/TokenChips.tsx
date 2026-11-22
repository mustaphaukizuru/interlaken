/**
 * Insertable data chips (contract C5 «Tokens»): {{ciclo}}, {{anios}}, {{anio}}
 * and the school's contact data, each showing the value it prints today.
 * The stored text keeps the token, so it updates itself every year.
 */
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { Plus } from 'lucide-react';
import toast from 'react-hot-toast';
import { useSiteSettings } from '@/hooks/useSiteSettings';
import { applyTokens } from '../../runtime';

export type TokenName = 'ciclo' | 'anios' | 'anio' | 'fundacion' | 'telefono' | 'correo' | 'direccion' | 'horario' | 'whatsapp';

export const TOKEN_LABELS: Record<TokenName, string> = {
  ciclo: 'Ciclo escolar',
  anios: 'Años del colegio',
  anio: 'Año en curso',
  fundacion: 'Año de fundación',
  telefono: 'Teléfono',
  correo: 'Correo',
  direccion: 'Dirección',
  horario: 'Horario',
  whatsapp: 'WhatsApp',
};

/** Shown first: the three that change by themselves each year. */
export const MAIN_TOKENS: TokenName[] = ['ciclo', 'anios', 'anio'];
export const MORE_TOKENS: TokenName[] = ['telefono', 'correo', 'direccion', 'horario', 'whatsapp', 'fundacion'];

/** Today's value of every token (the site settings fill the contact data). */
export function useTokenValues(): (name: TokenName) => string {
  const s = useSiteSettings();
  return (name) => applyTokens(`{{${name}}}`, s);
}

/** Text with its tokens replaced, as the site will print it. */
export function useResolvedText(): (text: string) => string {
  const s = useSiteSettings();
  return (text) => applyTokens(text, s);
}

/**
 * Writes `text` at the caret of an input or textarea (or at the end) and puts
 * the caret after it. The control keeps its last selection while a chip has
 * focus, so this works by mouse and by keyboard.
 */
export function insertAtCaret(el: HTMLInputElement | HTMLTextAreaElement | null, value: string, text: string, onChange: (v: string) => void): string {
  const start = el?.selectionStart ?? value.length;
  const end = el?.selectionEnd ?? start;
  const next = value.slice(0, start) + text + value.slice(end);
  onChange(next);
  const caret = start + text.length;
  setTimeout(() => {
    if (!el) return;
    el.focus();
    try { el.setSelectionRange(caret, caret); } catch { /* inputs like type=url have no selection API */ }
  }, 0);
  return next;
}

/** Where `before` and `after` start to differ: the place a chip wrote its token. */
function insertedAt(before: string, after: string): number {
  let i = 0;
  while (i < before.length && i < after.length && before[i] === after[i]) i += 1;
  return i;
}

/** `text` without the occurrence of `token` nearest to `at`, or null when the token is gone. */
export function withoutToken(text: string, token: string, at: number): string | null {
  let best = -1;
  for (let i = text.indexOf(token); i >= 0; i = text.indexOf(token, i + 1)) {
    if (best < 0 || Math.abs(i - at) < Math.abs(best - at)) best = i;
  }
  if (best < 0) return null;
  const before = text.slice(0, best);
  const after = text.slice(best + token.length);
  // «Ciclo {{ciclo}} abierto» → «Ciclo abierto», not two spaces.
  return before.endsWith(' ') && after.startsWith(' ') ? before + after.slice(1) : before + after;
}

/**
 * Pop-up after a chip inserts a token: «Se insertó {{anio}} (hoy: 2026) · Deshacer».
 * Chips sit right under the field, so a stray click inserts a code nobody
 * meant (the «costos» page, 2026-11-21); «Deshacer» takes that token out of
 * the field's current text, even if the person kept typing.
 */
export function useTokenUndo(value: string, onChange: (v: string) => void) {
  const latest = useRef({ value, onChange });
  useEffect(() => { latest.current = { value, onChange }; });
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const settings = useSiteSettings();
  return useCallback((token: string, before: string, after: string) => {
    const at = insertedAt(before, after);
    const today = applyTokens(token, settings);
    const undo = (id: string) => {
      toast.dismiss(id);
      if (!mounted.current) {
        toast.error('Ese campo ya no está abierto: use «Deshacer» del editor.');
        return;
      }
      const next = withoutToken(latest.current.value, token, at);
      if (next !== null) latest.current.onChange(next);
    };
    toast.success((t) => (
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span>Se insertó <code className="rounded-sm bg-cream px-1 font-mono text-xs">{token}</code>{today && today !== token ? ` (hoy: ${today})` : ''}.</span>
        <button type="button" onClick={() => undo(t.id)} className="min-h-[44px] rounded-sm px-2 font-semibold text-purple underline-offset-2 hover:underline sm:min-h-[32px]">
          Deshacer
        </button>
      </span>
    ), { id: 'cms-token-insert', duration: 6000 });
  }, [settings]);
}

interface Props {
  /** The control the chips write into. */
  target?: RefObject<HTMLInputElement | HTMLTextAreaElement | null>;
  value?: string;
  onChange?: (v: string) => void;
  /** Instead of target/value/onChange: insert the token text yourself (e.g. a visual text editor). */
  onInsert?: (text: string) => void;
  tokens?: TokenName[];
  /** Offer the contact data behind «Más datos». */
  more?: boolean;
  /** After target/value/onChange wrote a token (the «Deshacer» pop-up: useTokenUndo). */
  onInserted?: (token: string, before: string, after: string) => void;
}

export function TokenChips({ target, value = '', onChange, onInsert, tokens = MAIN_TOKENS, more = true, onInserted }: Props) {
  const valueOf = useTokenValues();
  const [showMore, setShowMore] = useState(false);
  const [active, setActive] = useState(0);
  const list = showMore ? [...tokens, ...MORE_TOKENS.filter((t) => !tokens.includes(t))] : tokens;
  const count = list.length + (more && !showMore ? 1 : 0);
  const current = Math.min(active, count - 1);
  // One tab stop for the whole row; the arrows move between chips (a toolbar).
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    const to = step ? (current + step + count) % count : e.key === 'Home' ? 0 : e.key === 'End' ? count - 1 : -1;
    if (to < 0) return;
    e.preventDefault();
    setActive(to);
    e.currentTarget.querySelectorAll<HTMLButtonElement>('button')[to]?.focus();
  };
  const chip = 'inline-flex min-h-[44px] items-center gap-1 rounded-sm border px-2.5 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-purple sm:min-h-[30px]';
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5" role="toolbar" aria-label="Insertar un dato que se actualiza solo" onKeyDown={onKey}>
      <span className="text-[11px] font-semibold uppercase tracking-wide text-subtle" aria-hidden="true">Insertar dato:</span>
      {list.map((t, i) => (
        <button
          key={t}
          type="button"
          tabIndex={i === current ? 0 : -1}
          onFocus={() => setActive(i)}
          // Keep the caret in the text while clicking (keyboard users keep the selection anyway).
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            const token = `{{${t}}}`;
            if (onInsert) { onInsert(token); return; }
            if (!onChange) return;
            const next = insertAtCaret(target?.current ?? null, value, token, onChange);
            onInserted?.(token, value, next);
          }}
          className={`${chip} border-line bg-white text-ink hover:border-purple/50 hover:bg-purple/5`}
          aria-label={`Insertar ${TOKEN_LABELS[t]} (hoy: ${valueOf(t) || 'sin dato'})`}
        >
          <span className="font-semibold">{TOKEN_LABELS[t]}</span>
          <span className="max-w-[12rem] truncate text-subtle">{valueOf(t) || 'sin dato'}</span>
        </button>
      ))}
      {more && !showMore && (
        <button
          type="button"
          tabIndex={current === list.length ? 0 : -1}
          onFocus={() => setActive(list.length)}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setShowMore(true)}
          className={`${chip} border-transparent font-semibold text-purple hover:underline`}
        >
          <Plus size={12} aria-hidden="true" /> Más datos
        </button>
      )}
    </div>
  );
}
