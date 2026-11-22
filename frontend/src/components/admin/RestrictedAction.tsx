import { useId, type ReactNode } from 'react';
import { Lock } from 'lucide-react';

/**
 * A console action this account may not use: still visible, disabled, and it
 * says why (UX Phase 7: «restricted actions are disabled and show the
 * reason», as the admissions case cards do). `aria-disabled` rather than
 * `disabled`, so keyboard and screen-reader users reach it and hear the
 * reason through `aria-describedby`. The API refuses the action anyway: this
 * only explains the missing button.
 */
export function RestrictedAction({ reason, className = 'btn-outline', children }: {
  reason: string;
  className?: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        aria-disabled="true"
        aria-describedby={id}
        title={reason}
        onClick={(e) => e.preventDefault()}
        className={`${className} cursor-not-allowed opacity-50`}
      >
        {children}
      </button>
      <span id={id} className="flex items-center gap-1 text-xs text-muted">
        <Lock size={16} className="flex-shrink-0" aria-hidden="true" /> {reason}
      </span>
    </span>
  );
}

export default RestrictedAction;
