import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from './useMediaQuery';

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

/**
 * Tween a number toward `target` with an ease-out curve (dashboard stat count-up).
 *
 * - Respects `prefers-reduced-motion`: jumps straight to the value, no animation.
 * - Falls back to the final value if requestAnimationFrame is unavailable
 *   (SSR, or the headless preview renderer that never paints frames), so a stat
 *   can never get stuck mid-tween showing 0.
 * - On a later `target` change it tweens from the currently displayed value, so
 *   live query updates animate instead of snapping.
 */
export function useCountUp(target: number, duration = 900): number {
  const reduced = useReducedMotion();
  const canAnimate =
    typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function';

  const [display, setDisplay] = useState(reduced || !canAnimate ? target : 0);
  const fromRef = useRef(reduced || !canAnimate ? target : 0);
  const rafRef = useRef<number>();

  useEffect(() => {
    if (reduced || !canAnimate) {
      fromRef.current = target;
      setDisplay(target);
      return;
    }
    const from = fromRef.current;
    const delta = target - from;
    if (delta === 0) return;

    let startTs: number | null = null;
    const step = (ts: number) => {
      if (startTs === null) startTs = ts;
      const progress = Math.min((ts - startTs) / duration, 1);
      setDisplay(from + delta * easeOutCubic(progress));
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        fromRef.current = target;
      }
    };
    rafRef.current = requestAnimationFrame(step);

    // Safety net: if rAF never fires (backgrounded tab, throttled/headless
    // renderer with no paint), force the final value so a stat can't get
    // stuck mid-tween. Harmless when the animation already finished.
    const settle = window.setTimeout(() => {
      fromRef.current = target;
      setDisplay(target);
    }, duration + 120);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      window.clearTimeout(settle);
    };
  }, [target, duration, reduced, canAnimate]);

  return display;
}

export default useCountUp;
