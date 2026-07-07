import { type HTMLAttributes, useEffect, useRef, useState } from 'react';

interface RevealProps extends HTMLAttributes<HTMLDivElement> {
  /** Direction the element slides in from. */
  direction?: 'up' | 'down' | 'left' | 'right' | 'none';
  /** Delay before the transition starts, in ms (stagger helper). */
  delay?: number;
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
  distance = 24,
  style,
  children,
  ...props
}: RevealProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  const reduced =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  useEffect(() => {
    if (reduced) {
      setVisible(true);
      return;
    }
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

  const travel = OFFSET[direction].replace('24px', `${distance}px`);

  return (
    <div
      ref={ref}
      style={{
        opacity: visible ? 1 : 0,
        transform: visible || reduced ? 'none' : travel,
        transition: reduced
          ? 'none'
          : `opacity 0.6s cubic-bezier(0.4,0,0.2,1) ${delay}ms, transform 0.6s cubic-bezier(0.4,0,0.2,1) ${delay}ms`,
        willChange: 'opacity, transform',
        ...style,
      }}
      {...props}
    >
      {children}
    </div>
  );
}

export default Reveal;
