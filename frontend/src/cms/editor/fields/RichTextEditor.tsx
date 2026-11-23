/**
 * Visual text editor for the generic «Texto» block (contract C5 «Rich text»):
 * bold, italic, subtitle, bulleted and numbered lists, links (with the site's
 * link picker) and data chips. No dependency: a contentEditable area driven by
 * the browser's editing commands, its HTML normalised to what the site's
 * sanitizer keeps (richHtml.ts), so existing texts render exactly as before.
 */
import { useEffect, useRef, useState } from 'react';
import { Bold, Heading2, Italic, Link2, List, ListOrdered, Unlink, type LucideIcon } from 'lucide-react';
import { describedBy, FieldLabel, FieldNotes, type FieldBaseProps } from './FieldShell';
import { LinkPickerDialog } from './LinkField';
import { describeHref } from './links';
import { normalizeRichHtml } from './richHtml';
import { TokenChips, useTokenUndo } from './TokenChips';

export interface RichTextEditorProps extends FieldBaseProps {
  value: string;
  onChange: (html: string) => void;
}

type Cmd = 'bold' | 'italic' | 'insertUnorderedList' | 'insertOrderedList';
const exec = (cmd: string, arg?: string) => {
  try { return typeof document.execCommand === 'function' && document.execCommand(cmd, false, arg); } catch { return false; }
};
const queryState = (cmd: string) => { try { return document.queryCommandState?.(cmd) ?? false; } catch { return false; } };
const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function RichTextEditor({ id, label, required, hint, error, warning, onBlur, value, onChange }: RichTextEditorProps) {
  const ref = useRef<HTMLDivElement>(null);
  const emitted = useRef<string | null>(null);
  const range = useRef<Range | null>(null);
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState<Record<string, boolean>>({});
  const [linking, setLinking] = useState<{ href: string } | null>(null);
  const labelId = `${id}-label`;
  const tokenUndo = useTokenUndo(value, onChange);

  // External value (load, undo, reset) replaces the content; our own edits do not (the caret stays put).
  useEffect(() => {
    const el = ref.current;
    if (!el || value === emitted.current) return;
    el.innerHTML = value || '<p><br></p>';
    emitted.current = value;
  }, [value]);

  const emit = () => {
    const el = ref.current;
    if (!el) return;
    const html = normalizeRichHtml(el.innerHTML);
    emitted.current = html;
    if (html !== value) onChange(html);
  };

  const inEditor = (node: Node | null) => !!node && !!ref.current?.contains(node);
  const saveRange = () => {
    const sel = window.getSelection?.();
    if (sel && sel.rangeCount && inEditor(sel.anchorNode)) range.current = sel.getRangeAt(0).cloneRange();
  };
  const restoreRange = () => {
    const sel = window.getSelection?.();
    ref.current?.focus();
    if (sel && range.current) { sel.removeAllRanges(); sel.addRange(range.current); }
  };
  const currentLink = (): HTMLAnchorElement | null => {
    let n: Node | null = range.current?.startContainer ?? null;
    while (n && n !== ref.current) { if (n instanceof HTMLAnchorElement) return n; n = n.parentNode; }
    return null;
  };
  const refreshActive = () => {
    const block = (() => { try { return String(document.queryCommandValue?.('formatBlock') ?? '').toLowerCase(); } catch { return ''; } })();
    setActive({ bold: queryState('bold'), italic: queryState('italic'), insertUnorderedList: queryState('insertUnorderedList'), insertOrderedList: queryState('insertOrderedList'), h2: block === 'h2', link: !!currentLink() });
  };
  useEffect(() => {
    const onSel = () => { if (inEditor(window.getSelection?.()?.anchorNode ?? null)) { saveRange(); refreshActive(); } };
    document.addEventListener('selectionchange', onSel);
    return () => document.removeEventListener('selectionchange', onSel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = (cmd: Cmd | 'h2') => {
    restoreRange();
    if (cmd === 'h2') exec('formatBlock', active.h2 ? 'p' : 'h2');
    else exec(cmd);
    emit();
    refreshActive();
  };

  const applyLink = (href: string) => {
    setLinking(null);
    restoreRange();
    const existing = currentLink();
    if (!href) {
      if (existing) existing.replaceWith(...Array.from(existing.childNodes));
      else exec('unlink');
    } else if (existing) {
      existing.setAttribute('href', href);
    } else if (range.current && !range.current.collapsed) {
      exec('createLink', href);
    } else {
      const text = describeHref(href).title.replace(/^(Sitio web|Correo|Llamar al|WhatsApp): ?/, '') || href;
      exec('insertHTML', `<a href="${escapeHtml(href)}">${escapeHtml(text)}</a>`);
    }
    emit();
  };

  const tools: { key: Cmd | 'h2' | 'link'; label: string; Icon: LucideIcon }[] = [
    { key: 'bold', label: 'Negritas', Icon: Bold },
    { key: 'italic', label: 'Cursiva', Icon: Italic },
    { key: 'h2', label: 'Subtítulo', Icon: Heading2 },
    { key: 'insertUnorderedList', label: 'Lista con viñetas', Icon: List },
    { key: 'insertOrderedList', label: 'Lista numerada', Icon: ListOrdered },
    { key: 'link', label: 'Enlace', Icon: Link2 },
  ];

  return (
    <div
      onFocus={() => setFocused(true)}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null) && !linking) { setFocused(false); onBlur?.(); } }}
    >
      <FieldLabel id={labelId} htmlFor={id} label={label} required={required} />
      <div className={`overflow-hidden rounded-md border bg-white ${error ? 'border-coral-400' : 'border-line'} focus-within:border-purple/60 focus-within:ring-2 focus-within:ring-purple/15`}>
        <div role="toolbar" aria-label={`Formato de ${label}`} aria-controls={id} className="flex flex-wrap gap-0.5 border-b border-line bg-cream-2/70 p-1">
          {tools.map(({ key, label: tl, Icon }) => (
            <button
              key={key}
              type="button"
              title={tl}
              aria-label={tl}
              aria-pressed={!!active[key]}
              // Keep the selection in the text while clicking a tool.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => (key === 'link' ? (saveRange(), setLinking({ href: currentLink()?.getAttribute('href') ?? '' })) : run(key))}
              className={`flex h-11 w-11 items-center justify-center rounded-sm sm:h-9 sm:w-9 ${active[key] ? 'bg-purple/15 text-purple' : 'text-ink hover:bg-white'}`}
            >
              {key === 'link' && active.link ? <Unlink size={16} aria-hidden="true" /> : <Icon size={16} aria-hidden="true" />}
            </button>
          ))}
        </div>
        <div
          ref={ref}
          id={id}
          role="textbox"
          aria-multiline="true"
          aria-labelledby={labelId}
          aria-describedby={describedBy(id, { hint, error, warning })}
          aria-invalid={error ? true : undefined}
          aria-required={required || undefined}
          contentEditable
          suppressContentEditableWarning
          tabIndex={0}
          className="cms-rich min-h-[160px] px-3 py-2 text-[15px] text-ink focus:outline-none"
          onInput={emit}
          onKeyUp={saveRange}
          onMouseUp={saveRange}
          onPaste={(e) => {
            // Pasted text arrives without the source's fonts and colours.
            e.preventDefault();
            exec('insertText', e.clipboardData.getData('text/plain'));
            emit();
          }}
        />
      </div>
      {focused && <TokenChips onInsert={(t) => { const before = value; restoreRange(); exec('insertText', t); emit(); tokenUndo(t, before, emitted.current ?? before); }} />}
      <FieldNotes id={id} hint={hint} error={error} warning={warning} />
      <LinkPickerDialog open={!!linking} value={linking?.href ?? ''} onClose={() => { setLinking(null); restoreRange(); }} onPick={applyLink} />
    </div>
  );
}
