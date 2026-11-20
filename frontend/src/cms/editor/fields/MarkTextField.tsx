/**
 * Text with inline marks (contract C5 «Rich text», second half): the toolbar
 * writes the same syntax the section already renders, `**negritas**` and
 * `[texto](/ruta)`, so nobody has to know it, and a mini preview shows the
 * result as you type. The stored text is unchanged in format.
 */
import { Fragment, useRef, useState, type ReactNode } from 'react';
import { Bold, Link2 } from 'lucide-react';
import { describedBy, FieldLabel, FieldNotes, invalidClass, type FieldBaseProps } from './FieldShell';
import { LinkPickerDialog } from './LinkField';
import { describeHref } from './links';
import { leftWrapper } from './TextField';
import { TokenChips, useResolvedText } from './TokenChips';

export interface MarkTextFieldProps extends FieldBaseProps {
  value: string;
  onChange: (v: string) => void;
  /** Marks this text supports (the section's renderer decides). */
  marks: ('bold' | 'link')[];
  rows?: number;
}

/** Wraps the selection (or a placeholder word, selected) in `before`/`after`. */
function wrapSelection(el: HTMLTextAreaElement | null, value: string, before: string, after: string, placeholder: string, onChange: (v: string) => void) {
  const start = el?.selectionStart ?? value.length;
  const end = el?.selectionEnd ?? start;
  const inner = value.slice(start, end) || placeholder;
  onChange(value.slice(0, start) + before + inner + after + value.slice(end));
  setTimeout(() => {
    if (!el) return;
    el.focus();
    el.setSelectionRange(start + before.length, start + before.length + inner.length);
  }, 0);
}

/** One paragraph with its marks, as the site shows it (links are not followed in the preview). */
export function MarkPreview({ text, marks }: { text: string; marks: ('bold' | 'link')[] }) {
  const parts: ReactNode[] = [];
  const alternatives = [
    ...(marks.includes('bold') ? ['\\*\\*(?<b>.+?)\\*\\*'] : []),
    ...(marks.includes('link') ? ['\\[(?<t>[^\\]]+)\\]\\((?<h>[^)\\s]+)\\)'] : []),
  ];
  let last = 0;
  for (const m of alternatives.length ? text.matchAll(new RegExp(alternatives.join('|'), 'g')) : []) {
    const at = m.index ?? 0;
    const g = m.groups ?? {};
    if (at > last) parts.push(text.slice(last, at));
    if (g.b !== undefined) parts.push(<strong key={at} className="font-semibold text-ink">{g.b}</strong>);
    else parts.push(<span key={at} className="font-medium text-green-dark underline" title={describeHref(g.h).title}>{g.t}</span>);
    last = at + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts.map((p, i) => <Fragment key={i}>{p}</Fragment>)}</>;
}

export function MarkTextField({ id, label, required, hint, error, warning, onBlur, value, onChange, marks, rows = 6 }: MarkTextFieldProps) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const [focused, setFocused] = useState(false);
  const [linking, setLinking] = useState(false);
  const resolve = useResolvedText();
  const paragraphs = resolve(value).split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
  const insertLink = (href: string) => {
    setLinking(false);
    if (!href) return;
    const el = ref.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? start;
    const text = value.slice(start, end).replace(/[[\]]/g, '') || describeHref(href).title.replace(/^(Sitio web|Correo|Llamar al|WhatsApp): ?/, '');
    const md = `[${text}](${href})`;
    onChange(value.slice(0, start) + md + value.slice(end));
    setTimeout(() => { el?.focus(); el?.setSelectionRange(start + 1, start + 1 + text.length); }, 0);
  };
  return (
    <div onFocus={() => setFocused(true)} onBlur={(e) => { if (leftWrapper(e) && !linking) { setFocused(false); onBlur?.(); } }}>
      <FieldLabel htmlFor={id} label={label} required={required} />
      <div className={`overflow-hidden rounded-xl border bg-white ${error ? 'border-coral-400' : 'border-line'}`}>
        <div role="toolbar" aria-label={`Formato de ${label}`} aria-controls={id} className="flex flex-wrap items-center gap-0.5 border-b border-line bg-cream-2/70 p-1">
          {marks.includes('bold') && (
            <button type="button" title="Negritas" aria-label="Negritas" onMouseDown={(e) => e.preventDefault()} onClick={() => wrapSelection(ref.current, value, '**', '**', 'texto en negritas', onChange)} className="flex h-11 w-11 items-center justify-center rounded-lg text-ink hover:bg-white sm:h-9 sm:w-9">
              <Bold size={16} aria-hidden="true" />
            </button>
          )}
          {marks.includes('link') && (
            <button type="button" title="Enlace" aria-label="Enlace" onMouseDown={(e) => e.preventDefault()} onClick={() => setLinking(true)} className="flex h-11 w-11 items-center justify-center rounded-lg text-ink hover:bg-white sm:h-9 sm:w-9">
              <Link2 size={16} aria-hidden="true" />
            </button>
          )}
          <span className="ml-1 text-[11px] text-subtle">Seleccione texto y elija un formato.</span>
        </div>
        <textarea
          id={id}
          ref={ref}
          rows={rows}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(id, { hint, error, warning })}
          aria-required={required || undefined}
          className={`block min-h-[120px] w-full resize-y border-0 px-3 py-2 text-sm text-ink focus:outline-none focus:ring-0 ${invalidClass(error)}`}
        />
      </div>
      {focused && <TokenChips target={ref} value={value} onChange={onChange} />}
      {paragraphs.length > 0 && (
        <div className="mt-2 rounded-lg border border-dashed border-line bg-cream-2/50 px-3 py-2" aria-label={`Vista previa de ${label}`} role="group">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-subtle">Así se verá</p>
          <div className="max-h-48 space-y-2 overflow-y-auto text-sm leading-relaxed text-ink/80">
            {paragraphs.map((p, i) => <p key={i}><MarkPreview text={p} marks={marks} /></p>)}
          </div>
        </div>
      )}
      <FieldNotes id={id} hint={hint} error={error} warning={warning} />
      <LinkPickerDialog open={linking} value="" onClose={() => { setLinking(false); ref.current?.focus(); }} onPick={insertLink} />
    </div>
  );
}
