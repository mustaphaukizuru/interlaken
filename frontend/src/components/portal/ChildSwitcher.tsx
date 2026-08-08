import { useEffect } from 'react';
import { useSelectedChildStore } from '@/store/selectedChildStore';

export type SwitcherChild = {
  id: number;
  name: string;
  grade?: string;
  group?: string;
};

interface ChildSwitcherProps {
  students: SwitcherChild[];
  /** When true, include a "Todos" chip (useful on list pages). */
  allowAll?: boolean;
  className?: string;
}

/**
 * Compact chip row to pick among linked children. Persists selection so
 * Colegiaturas / Cafetería can filter to the same alumno.
 */
export function ChildSwitcher({ students, allowAll = false, className = '' }: ChildSwitcherProps) {
  const childId = useSelectedChildStore((s) => s.childId);
  const setChildId = useSelectedChildStore((s) => s.setChildId);

  // Drop a stale id (unlinked child) and default to first when "Todos" is off.
  useEffect(() => {
    if (!students.length) return;
    const valid = childId != null && students.some((c) => c.id === childId);
    if (valid) return;
    if (allowAll) {
      if (childId != null) setChildId(null);
      return;
    }
    setChildId(students[0].id);
  }, [students, childId, allowAll, setChildId]);

  if (students.length < 2) return null;

  const chip = (active: boolean) =>
    `min-h-[40px] rounded-xl border px-3.5 py-2 text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40 ${
      active
        ? 'border-purple/40 bg-purple text-white shadow-[0_6px_14px_-8px_rgba(64,26,142,0.55)]'
        : 'border-line bg-white text-ink hover:border-purple/25 hover:bg-cream'
    }`;

  return (
    <div
      className={`flex flex-wrap items-center gap-2 ${className}`}
      role="group"
      aria-label="Seleccionar alumno"
    >
      {allowAll && (
        <button type="button" className={chip(childId == null)} onClick={() => setChildId(null)}>
          Todos
        </button>
      )}
      {students.map((c) => {
        const active = childId === c.id;
        const meta = [c.grade, c.group].filter(Boolean).join(' · ');
        return (
          <button
            key={c.id}
            type="button"
            className={chip(active)}
            onClick={() => setChildId(c.id)}
            aria-pressed={active}
          >
            {c.name}
            {meta ? <span className={`ml-1.5 font-medium ${active ? 'text-white/70' : 'text-subtle'}`}>{meta}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

export default ChildSwitcher;
