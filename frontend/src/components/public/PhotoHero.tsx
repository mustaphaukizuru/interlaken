import type { ReactNode } from 'react';
import { assetSrcSet } from '@/lib/images';

interface Props {
  /** Eyebrow above the title, e.g. "Comunidad". */
  label: string;
  labelClass?: string;
  title: ReactNode;
  subtitle?: ReactNode;
  /** `/assets/*.webp`; the 480/960 variants are picked up automatically. */
  image: string;
  /** Focal point for object-position, e.g. "center 30%". */
  focus?: string;
  /** How much the photo shows through the dark scrim. */
  opacity?: number;
  children?: ReactNode;
  className?: string;
}

/**
 * Public-page hero: campus photograph under a dark scrim, eyebrow, title.
 *
 * Every public page used to hand-roll this block, and three of them
 * (Nosotros, Calendario, Aviso) shipped without a photo at all, so those
 * sections read as a black band rather than the school. One component keeps
 * the treatment identical and makes "add a photo" a one-prop change.
 *
 * The image is the LCP element on these pages, so it loads eagerly with
 * fetchpriority high; the srcSet keeps phones on the 960w candidate.
 */
export function PhotoHero({
  label, labelClass = 'section-label-purple', title, subtitle, image, focus = 'center', opacity = 0.35, children, className = '',
}: Props) {
  return (
    <section className={`relative overflow-hidden bg-dark text-white ${className}`.trim()}>
      <img
        src={image}
        srcSet={assetSrcSet(image, { full: true })}
        sizes="100vw"
        alt=""
        width={1600}
        height={900}
        loading="eager"
        decoding="async"
        // @ts-expect-error fetchpriority is not yet in React's typings for img
        fetchpriority="high"
        className="absolute inset-0 h-full w-full object-cover"
        style={{ opacity, objectPosition: focus }}
        onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')}
      />
      <div className="absolute inset-0 bg-gradient-to-r from-dark/92 via-dark/75 to-dark/45" aria-hidden="true" />
      <div className="relative mx-auto max-w-[1120px] px-5 py-14 sm:px-6 sm:py-16 lg:py-[72px]">
        <span className={`${labelClass} inline-flex`}>{label}</span>
        <h1 className="mt-3 font-head text-fluid-4xl font-black leading-[1.08] tracking-[-0.03em]">{title}</h1>
        {subtitle && (
          <p className="mt-4 max-w-2xl text-[15.5px] leading-relaxed text-white/75 sm:text-base">{subtitle}</p>
        )}
        {children}
      </div>
    </section>
  );
}

export default PhotoHero;
