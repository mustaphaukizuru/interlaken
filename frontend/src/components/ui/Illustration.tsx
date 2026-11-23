import { illustrationSrc, type IllustrationName } from '@/lib/illustrations';

interface Props {
  name: IllustrationName;
  /** CSS width the illustration is shown at (px); picks the 320 or 640 file. */
  size?: number;
  className?: string;
  /** Above the fold (hero side art): load eagerly with high priority. */
  priority?: boolean;
  /** Width set by `className` (for example w-3/5) instead of `size`; `size` still picks the file. */
  fluid?: boolean;
}

/**
 * A 3D spot illustration (lib/illustrations). Decorative: the heading next to
 * it says the same, so it is hidden from screen readers.
 */
export function Illustration({ name, size = 160, className = '', priority = false, fluid = false }: Props) {
  return (
    <img
      src={illustrationSrc(name)}
      srcSet={`${illustrationSrc(name, true)} 320w, ${illustrationSrc(name)} 640w`}
      sizes={`${size}px`}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      draggable={false}
      loading={priority ? 'eager' : 'lazy'}
      decoding="async"
      {...(priority ? { fetchpriority: 'high' } : {})}
      className={`select-none object-contain ${fluid ? 'h-auto' : ''} ${className}`}
      style={fluid ? undefined : { width: size, height: size }}
    />
  );
}

/** A soft wash of a colour mixed with white (works for any token or CMS colour). */
export const wash = (color: string, pct: number) => `color-mix(in srgb, ${color} ${pct}%, white)`;

interface PanelProps {
  name: IllustrationName;
  /** Any CSS colour (token var or CMS colour); the panel is a light wash of it. */
  tint?: string;
  className?: string;
  priority?: boolean;
}

/**
 * The illustration on a soft panel of `tint`, with two quiet circles and a
 * floor shadow: the media beside a block of text (level pages, admissions,
 * modelo, contact…). Shorter on phones so long pages do not turn into scroll.
 */
export function IllustrationPanel({ name, tint = 'var(--purple)', className = '', priority = false }: PanelProps) {
  return (
    <div
      aria-hidden="true"
      className={`relative mx-auto flex aspect-[16/10] w-full max-w-[440px] items-center justify-center overflow-hidden rounded-md lg:aspect-[5/4] ${className}`}
      style={{ background: `radial-gradient(120% 95% at 50% 38%, ${wash(tint, 24)} 0%, ${wash(tint, 8)} 68%)` }}
    >
      <span className="absolute -right-12 -top-12 h-44 w-44 rounded-full" style={{ background: wash(tint, 30), opacity: 0.45 }} />
      <span className="absolute -bottom-14 -left-10 h-36 w-36 rounded-full" style={{ background: wash(tint, 30), opacity: 0.35 }} />
      <span className="absolute bottom-[13%] h-5 w-[34%] rounded-full bg-purple/15 blur-md" />
      <Illustration name={name} size={280} fluid priority={priority} className="relative w-[46%] max-w-[300px] lg:w-[64%]" />
    </div>
  );
}
