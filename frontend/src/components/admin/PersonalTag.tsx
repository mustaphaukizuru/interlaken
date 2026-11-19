import { Briefcase } from 'lucide-react';

/**
 * The small «Personal» tag on a staff member's cafetería row (A8): their
 * wallet sits in the same lists as the pupils', this says which is which.
 */
export function PersonalTag({ title, className = '' }: { title?: string; className?: string }) {
  return (
    <span
      title={title ?? 'Personal del colegio'}
      className={`inline-flex items-center gap-1 rounded-full bg-purple/[0.08] px-2 py-0.5 align-middle font-head text-[10px] font-bold uppercase tracking-[0.8px] text-purple ring-1 ring-inset ring-purple/20 ${className}`.trim()}
    >
      <Briefcase className="h-3 w-3" aria-hidden="true" />
      Personal
    </span>
  );
}

export default PersonalTag;
