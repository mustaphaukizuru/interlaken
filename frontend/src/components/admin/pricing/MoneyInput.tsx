import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, useState, type InputHTMLAttributes } from 'react';
import { parseMoney } from './model';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> & {
  value: string;
  onChange: (value: string) => void;
};

const pretty = (v: string) => {
  const parsed = parseMoney(v).value;
  return parsed === null ? v : Number(parsed).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

/**
 * An amount in pesos: shows «$ 6,450.00» and edits the plain number («6450.00»,
 * selected, so typing replaces it as in a spreadsheet); leaving the cell writes
 * it with two decimals. A value that is not an amount stays as typed so its
 * error can be read next to it.
 */
export const MoneyInput = forwardRef<HTMLInputElement, Props>(({ value, onChange, className = '', onFocus, onBlur, ...rest }, ref) => {
  const input = useRef<HTMLInputElement>(null);
  useImperativeHandle(ref, () => input.current as HTMLInputElement);
  const [editing, setEditing] = useState(false);
  // The plain number replaces the formatted one on focus; select it in the same frame.
  useLayoutEffect(() => {
    if (editing && document.activeElement === input.current) input.current?.select();
  }, [editing]);
  return (
    <span className="relative block">
      <span className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-sm text-subtle" aria-hidden="true">$</span>
      <input
        ref={input}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        className={`pl-6 text-right tabular-nums ${className}`}
        value={editing ? value : pretty(value)}
        onFocus={(e) => { setEditing(true); onFocus?.(e); }}
        onBlur={(e) => {
          setEditing(false);
          const parsed = parseMoney(value);
          if (parsed.value !== null && parsed.value !== value) onChange(parsed.value);
          onBlur?.(e);
        }}
        onChange={(e) => onChange(e.target.value)}
        {...rest}
      />
    </span>
  );
});
MoneyInput.displayName = 'MoneyInput';

export default MoneyInput;
