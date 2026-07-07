import { type CSSProperties } from 'react';

type Tone = 'purple' | 'pink' | 'teal' | 'green' | 'amber';

const TONE: Record<Tone, string> = {
  purple: '#401a8e',
  pink: '#ef2558',
  teal: '#1da2ab',
  green: '#48d06a',
  amber: '#d97706',
};

/** A few soft organic paths so blobs don't all read as the same shape. */
const SHAPES = [
  'M43.9,-58.6C56.3,-49.9,65,-36.3,68.8,-21.4C72.6,-6.5,71.4,9.7,64.9,23.3C58.4,36.9,46.6,47.9,33.3,55.9C20,63.9,5.2,68.9,-9.9,68.4C-25,67.9,-40.4,61.9,-52.4,51.1C-64.4,40.3,-73,24.7,-74.6,8.3C-76.2,-8.1,-70.8,-25.3,-60.3,-38.2C-49.8,-51.1,-34.2,-59.7,-19,-64.9C-3.8,-70.1,11,-71.9,25.6,-68.7C40.2,-65.5,54.6,-57.3,43.9,-58.6Z',
  'M39.5,-52.6C51.9,-44.3,62.9,-33,67.7,-19.2C72.5,-5.4,71.1,10.9,64.4,24.5C57.7,38.1,45.7,49,32.2,56.8C18.7,64.6,3.7,69.3,-11.9,68.8C-27.5,68.3,-43.7,62.6,-55.3,51.6C-66.9,40.6,-73.9,24.3,-74.6,7.9C-75.3,-8.5,-69.7,-25,-59.6,-37.9C-49.5,-50.8,-34.9,-60.1,-20.1,-66.3C-5.3,-72.5,9.7,-75.6,23.6,-71.4C37.5,-67.2,50.3,-55.7,39.5,-52.6Z',
  'M45.3,-59.8C58.1,-51.3,67.3,-37.2,71.4,-21.7C75.5,-6.2,74.5,10.7,68,25.1C61.5,39.5,49.5,51.4,35.6,59.4C21.7,67.4,5.9,71.5,-9.6,70.6C-25.1,69.7,-40.3,63.8,-52.6,53.3C-64.9,42.8,-74.3,27.7,-76.6,11.4C-78.9,-4.9,-74.1,-22.4,-64.2,-36.1C-54.3,-49.8,-39.3,-59.7,-24.1,-66.7C-8.9,-73.7,6.5,-77.8,20.9,-73.9C35.3,-70,58.5,-58.1,45.3,-59.8Z',
];

interface BlobProps {
  tone?: Tone;
  /** 0–1 fill opacity. Kept low so blobs stay a restrained background accent. */
  opacity?: number;
  /** Pixel diameter of the blob box. */
  size?: number;
  /** Which of the built-in organic paths to use. */
  shape?: 0 | 1 | 2;
  style?: CSSProperties;
  className?: string;
}

/**
 * Decorative organic "blob" shape for layering behind hero/level imagery (P1).
 * Purely presentational: `aria-hidden` + `pointer-events: none`, positioned by
 * the parent via `style`. Restrained by design — brand colors only, no doodles.
 */
export function Blob({
  tone = 'purple',
  opacity = 0.12,
  size = 320,
  shape = 0,
  style,
  className,
}: BlobProps) {
  return (
    <svg
      viewBox="-80 -80 160 160"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      className={className}
      style={{ position: 'absolute', pointerEvents: 'none', zIndex: 0, ...style }}
    >
      <path d={SHAPES[shape]} fill={TONE[tone]} opacity={opacity} />
    </svg>
  );
}

interface AccentProps {
  tone?: Tone;
  /** Diameter of the ring/dot in px. */
  size?: number;
  /** `ring` = hollow outline, `dot` = solid filled circle. */
  variant?: 'ring' | 'dot';
  opacity?: number;
  style?: CSSProperties;
  className?: string;
}

/**
 * Small geometric accent (ring or dot) to sprinkle near imagery — the
 * brand-appropriate, restrained stand-in for the references' sticker doodles.
 */
export function Accent({
  tone = 'teal',
  size = 40,
  variant = 'ring',
  opacity = 0.5,
  style,
  className,
}: AccentProps) {
  const color = TONE[tone];
  return (
    <span
      aria-hidden="true"
      className={className}
      style={{
        position: 'absolute',
        width: size,
        height: size,
        borderRadius: '50%',
        pointerEvents: 'none',
        zIndex: 0,
        opacity,
        ...(variant === 'ring'
          ? { border: `${Math.max(3, size / 12)}px solid ${color}`, background: 'transparent' }
          : { background: color }),
        ...style,
      }}
    />
  );
}

export default Blob;
