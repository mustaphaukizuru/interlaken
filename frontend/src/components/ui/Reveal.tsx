import { type HTMLAttributes, useEffect, useRef, useState } from 'react';

interface RevealProps extends HTMLAttributes<HTMLElement> {
  /** Direction the element slides in from. */
  direction?: 'up' | 'down' | 'left' | 'right' | 'none';
  /** Delay before the transition starts, in ms (stagger helper). */
  delay?: number;
  /** Element to render (li keeps <ol>/<ul> children valid for a11y). */
  as?: 'div' | 'li' | 'section' | 'article';
  /** Distance travelled during the slide, in px. */
  distance?: number;
}

const OFFSET: Record<NonNullable<RevealProps['direction']>, string> = {
  up: 'translateY(24px)',
  down: 'translateY(-24px)',
  left: 'translateX(24px)',
  right: 'translateX(-24px)',
  none: 'none',
};

/**
 * Scroll-triggered fade/slide using IntersectionObserver — no animation deps.
 * Respects prefers-reduced-motion by rendering fully visible with no transform.
 */
export function Reveal({
  direction = 'up',
  delay = 0,
  distance = 12,
  style,
  children,
  as: Tag = 'div',
  ...props
}: RevealProps) {
  const ref = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);

  const reduced =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  // Reduced motion renders fully visible from the first paint — derived here
  // instead of setState in the effect (which then only manages the observer).
  const shown = visible || reduced;

  useEffect(() => {
    if (reduced) return;
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setVisible(true);
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: '0px 0px -40px 0px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [reduced]);

  // Motion standard (docs/UIUX-REFINEMENT-PROMPT.md §3.5): rise 8-12 px, 300 ms
  // ceiling, list stagger capped at 6 items (6 x 60 ms).
  const travel = OFFSET[direction].replace('24px', `${Math.min(distance, 12)}px`);
  const wait = Math.min(delay, 360);

  return (
    <Tag
      ref={ref as never}
      style={{
        opacity: shown ? 1 : 0,
        transform: shown ? 'none' : travel,
        transition: reduced
          ? 'none'
          : `opacity 0.3s cubic-bezier(0.4,0,0.2,1) ${wait}ms, transform 0.3s cubic-bezier(0.4,0,0.2,1) ${wait}ms`,
        willChange: 'opacity, transform',
        ...style,
      }}
      {...props}
    >
      {children}
    </Tag>
  );
}

export default Reveal;
