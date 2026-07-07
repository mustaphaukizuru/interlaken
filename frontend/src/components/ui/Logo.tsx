/**
 * Colegio Interlaken — official logo.
 *
 * Renders the real artwork (public/assets/logo-*.webp) — never re-typesets the
 * wordmark. See BRAND_LOGO_GUIDE.md.
 *
 *   variant="horizontal"  icon + wordmark + tagline (nav, footer)
 *   variant="stacked"     vertical lockup (login, sidebar)
 *   variant="icon"        clock isotipo only (compact / mobile)
 *   variant="seal"        40-años anniversary seal
 *   theme="dark"          white knockout version for dark backgrounds
 *
 * `size` sets the rendered height in px (aspect ratio preserved). Explicit
 * width/height on the <img> avoid layout shift.
 */

type Variant = 'horizontal' | 'stacked' | 'icon' | 'seal'
type Theme = 'light' | 'dark'

interface LogoProps {
  variant?: Variant
  /** Rendered height in px. Width scales to preserve aspect ratio. */
  size?: number
  theme?: Theme
  /** Extra width override (px). Rarely needed — size drives height. */
  width?: number
  className?: string
  /** Eager-load above-the-fold logos (nav); lazy for the rest. */
  eager?: boolean
}

// Intrinsic aspect ratios (width / height) of the exported artwork.
const RATIO: Record<Variant, number> = {
  horizontal: 1200 / 448,
  stacked: 900 / 896,
  icon: 512 / 510,
  seal: 900 / 778,
}

// Minimum heights (px) that keep each mark legible per the brand guide.
const MIN_HEIGHT: Record<Variant, number> = {
  horizontal: 28, // ~120px wide → tagline stays readable
  stacked: 40,
  icon: 24,
  seal: 40,
}

// Light (full color) vs dark (white knockout) source files.
const SRC: Record<Variant, { light: string; dark: string }> = {
  horizontal: {
    light: '/assets/logo-horizontal.webp',
    dark: '/assets/logo-horizontal-white.webp',
  },
  stacked: {
    light: '/assets/logo-vertical.webp',
    dark: '/assets/logo-vertical-white.webp',
  },
  // The clock isotipo is multicolor and reads on both light and dark.
  icon: {
    light: '/assets/logo-isotipo.webp',
    dark: '/assets/logo-isotipo.webp',
  },
  // The seal is the color anniversary mark; used on light contexts.
  seal: {
    light: '/assets/logo-seal-40.webp',
    dark: '/assets/logo-seal-40.webp',
  },
}

export default function Logo({
  variant = 'horizontal',
  size = 40,
  theme = 'light',
  width,
  className,
  eager = false,
}: LogoProps) {
  const height = Math.max(size, MIN_HEIGHT[variant])
  const computedWidth = width ?? Math.round(height * RATIO[variant])
  const src = theme === 'dark' ? SRC[variant].dark : SRC[variant].light

  return (
    <img
      src={src}
      alt="Colegio Interlaken"
      width={computedWidth}
      height={height}
      className={className}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      style={{ height, width: computedWidth, objectFit: 'contain', display: 'block' }}
    />
  )
}
