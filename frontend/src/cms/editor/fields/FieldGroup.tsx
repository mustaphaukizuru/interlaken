/**
 * A collapsible group of fields (contract C4): long section forms read as a
 * few named parts. The header says how many fields have content, how many of
 * the required ones are filled, and how many need fixing.
 */
import type { ReactNode } from 'react';
import { AlertCircle, ChevronDown } from 'lucide-react';

export interface FieldGroupProps {
  id: string;
  title: string;
  open: boolean;
  onToggle: () => void;
  filled: number;
  total: number;
  required: number;
  requiredFilled: number;
  errors: number;
  children: ReactNode;
}

export function FieldGroup({ id, title, open, onToggle, filled, total, required, requiredFilled, errors, children }: FieldGroupProps) {
  const regionId = `${id}-panel`;
  return (
    <section className={`rounded-xl border bg-white ${errors ? 'border-coral-300' : 'border-line'}`} data-field-group={title}>
      <h3 className="m-0">
        <button
          type="button"
          id={`${id}-button`}
          aria-expanded={open}
          aria-controls={regionId}
          onClick={onToggle}
          className="flex min-h-[48px] w-full items-center gap-2 rounded-xl px-3 py-2 text-left hover:bg-cream-2/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-purple"
        >
          <ChevronDown size={16} className={`shrink-0 text-subtle transition-transform duration-150 ${open ? '' : '-rotate-90'}`} aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate text-sm font-bold text-ink">{title}</span>
          <span className="shrink-0 text-xs tabular-nums text-subtle">
            {filled} de {total}
            {required > 0 && <span className={requiredFilled < required ? 'text-coral-600' : undefined}> · obligatorios {requiredFilled}/{required}</span>}
          </span>
          {errors > 0 && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-coral-50 px-2 py-0.5 text-xs font-semibold text-coral-600">
              <AlertCircle size={12} aria-hidden="true" /> {errors}<span className="sr-only"> {errors === 1 ? 'campo por corregir' : 'campos por corregir'}</span>
            </span>
          )}
        </button>
      </h3>
      <div id={regionId} role="region" aria-labelledby={`${id}-button`} hidden={!open} className="space-y-4 border-t border-line px-3 pb-3 pt-3">
        {children}
      </div>
    </section>
  );
}
