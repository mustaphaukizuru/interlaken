import { useState } from 'react';
import { useReducedMotion } from './useMediaQuery';

/**
 * Entrance-animation props for a Recharts series, made safe for the staff
 * dashboard.
 *
 * Recharts animates a series from its zero baseline using requestAnimationFrame.
 * A backgrounded / throttled / battery-saver tab never fires those frames, so a
 * naive `isAnimationActive` leaves the chart stuck at its empty first frame —
 * blank exactly when a director glances at a backgrounded phone tab. We avoid
 * that by animating ONLY when motion is allowed AND the tab is visible at mount:
 * a chart mounted while hidden renders its final state immediately, and a
 * foreground mount is guaranteed to get its rAF ticks.
 *
 * The entrance is first-render-only: onAnimationEnd flips it off so the 60s
 * analytics refetch re-renders without replaying the animation.
 *
 * Spread the return value onto a <Bar>/<Area>/<Line>: `<Bar {...entrance} />`.
 */
export function useChartEntrance(animationDuration = 700) {
  const reduced = useReducedMotion();
  const [active, setActive] = useState(
    () => !reduced && (typeof document === 'undefined' || document.visibilityState === 'visible'),
  );
  return {
    isAnimationActive: active,
    animationDuration,
    animationEasing: 'ease-out' as const,
    onAnimationEnd: () => setActive(false),
  };
}

export default useChartEntrance;
