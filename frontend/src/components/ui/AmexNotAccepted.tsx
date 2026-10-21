/**
 * «No se acepta American Express» with the Amex logo crossed out (owner,
 * 2026-10-20). Banorte's window still shows Amex among its brands, so the
 * portal says it before the family gets there. The text carries the meaning;
 * the logo is decorative.
 */
export function AmexNotAccepted({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 text-xs font-semibold text-coral ${className}`}>
      <span className="relative inline-block h-6 w-6 shrink-0 overflow-hidden rounded-[4px]" aria-hidden="true">
        <img src="/assets/cards/amex.webp" alt="" width={24} height={24} loading="lazy" decoding="async" className="h-6 w-6 opacity-70" />
        <span className="absolute left-1/2 top-1/2 h-[2px] w-[34px] -translate-x-1/2 -translate-y-1/2 -rotate-45 rounded-full bg-coral ring-1 ring-white" />
      </span>
      No se acepta American Express.
    </span>
  );
}

export default AmexNotAccepted;
