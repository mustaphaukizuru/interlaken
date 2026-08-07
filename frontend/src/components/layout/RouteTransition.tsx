import { type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Fades + lifts route content in on each navigation. Keyed by pathname so the
 * wrapper remounts and replays the CSS entrance, while the surrounding layout
 * (nav, sidebar, top bar) stays put. Reduced-motion users get an instant swap —
 * the `.route-enter` keyframe is disabled under prefers-reduced-motion.
 */
export function RouteTransition({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return (
    <div key={pathname} className="route-enter">
      {children}
    </div>
  );
}

export default RouteTransition;
