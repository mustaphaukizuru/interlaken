import { useId, useState, type FormEvent } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';

export interface BulkValueOption {
  value: string;
  label: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** "Cambiar grupo de 12 alumnos". */
  title: string;
  /** Field label: "Nuevo grupo". */
  label: string;
  /** Fixed choices render a select; with `freeText` they become suggestions (datalist). */
  options: BulkValueOption[];
  freeText?: boolean;
  maxLength?: number;
  /** Uppercase free text as it is typed (groups: "a" → "A"). */
  uppercase?: boolean;
  hint?: string;
  onSubmit: (value: string) => void;
}

/**
 * Step 0 of a bulk edit that needs a value (Data Ops C5): pick the target
 * status / grade / group, then the page opens `BulkConfirmDialog` with it as
 * payload so the dry run plans against the real value.
 */
export function BulkValueDialog({ open, onClose, ...rest }: Props) {
  return (
    <Modal open={open} onClose={onClose} title={rest.title} maxWidth={440}>
      <BulkValueForm key={String(open)} onClose={onClose} {...rest} />
    </Modal>
  );
}

function BulkValueForm({ onClose, label, options, freeText = false, maxLength, uppercase = false, hint, onSubmit }: Omit<Props, 'open' | 'title'>) {
  const id = useId();
  const [value, setValue] = useState(freeText ? '' : (options[0]?.value ?? ''));
  const clean = value.trim();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (clean) onSubmit(clean);
  };
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div>
        <label htmlFor={`${id}-v`} className="label">{label}</label>
        {freeText ? (
          <>
            <input
              id={`${id}-v`}
              className="input-field"
              list={`${id}-list`}
              value={value}
              maxLength={maxLength}
              autoComplete="off"
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
              onChange={(e) => setValue(uppercase ? e.target.value.toUpperCase() : e.target.value)}
              aria-describedby={hint ? `${id}-hint` : undefined}
            />
            <datalist id={`${id}-list`}>
              {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </datalist>
          </>
        ) : (
          <select id={`${id}-v`} className="input-field" value={value} onChange={(e) => setValue(e.target.value)}>
            {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        )}
        {hint && <p id={`${id}-hint`} className="mt-1 text-xs text-muted">{hint}</p>}
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={onClose}>Cancelar</Button>
        <Button type="submit" size="sm" disabled={!clean}>Continuar</Button>
      </div>
    </form>
  );
}

export default BulkValueDialog;
