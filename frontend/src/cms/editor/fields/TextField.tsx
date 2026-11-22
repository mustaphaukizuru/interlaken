/** Text or multi-line text with insertable data chips while focused, and a «Se verá así» line when it holds data. */
import { useRef, useState, type FocusEvent } from 'react';
import { describedBy, FieldLabel, FieldNotes, invalidClass, type FieldBaseProps } from './FieldShell';
import { MAIN_TOKENS, TokenChips, useResolvedText, useTokenUndo, type TokenName } from './TokenChips';

export interface TextFieldProps extends FieldBaseProps {
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
  rows?: number;
  placeholder?: string;
  type?: 'text' | 'url' | 'email';
  /** Chips shown while the field has focus; false = none. */
  tokens?: TokenName[] | false;
  /** Offer the contact data too («Más datos»). Default true. */
  moreTokens?: boolean;
  /** Single line: Enter calls this instead of submitting a surrounding form. */
  onEnter?: () => void;
}

/** Leaves the wrapper (not just moves to a chip inside it). */
export const leftWrapper = (e: FocusEvent<HTMLElement>) => !e.currentTarget.contains(e.relatedTarget as Node | null);

export function TextField({ id, label, required, hint, error, warning, onBlur, value, onChange, multiline, rows = 4, placeholder, type = 'text', tokens = MAIN_TOKENS, moreTokens = true, onEnter }: TextFieldProps) {
  const ref = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const [focused, setFocused] = useState(false);
  const resolve = useResolvedText();
  const tokenUndo = useTokenUndo(value, onChange);
  const common = {
    id,
    value,
    placeholder,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': describedBy(id, { hint, error, warning }),
    'aria-required': required || undefined,
  };
  const preview = value.includes('{{') ? resolve(value) : '';
  return (
    <div
      onFocus={() => setFocused(true)}
      onBlur={(e) => { if (leftWrapper(e)) { setFocused(false); onBlur?.(); } }}
    >
      <FieldLabel htmlFor={id} label={label} required={required} />
      {multiline ? (
        <textarea
          {...common}
          ref={(el) => { ref.current = el; }}
          rows={rows}
          className={`input-field min-h-[88px] text-sm ${invalidClass(error)}`}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          {...common}
          ref={(el) => { ref.current = el; }}
          type={type}
          className={`input-field ${invalidClass(error)}`}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onEnter ? (e) => { if (e.key === 'Enter') { e.preventDefault(); onEnter(); } } : undefined}
        />
      )}
      {focused && tokens && tokens.length > 0 && <TokenChips target={ref} value={value} onChange={onChange} tokens={tokens} more={moreTokens} onInserted={tokenUndo} />}
      {preview && preview !== value && (
        <p className="mt-1.5 text-xs text-subtle">Se verá así: <span className="text-ink">{preview}</span></p>
      )}
      <FieldNotes id={id} hint={hint} error={error} warning={warning} />
    </div>
  );
}
