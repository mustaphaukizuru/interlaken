/**
 * motion.tsx — lazy framer-motion foundation for the PUBLIC site.
 *
 * Usage guidance:
 * - Always import `m` from here (`import { m } from '@/lib/motion'`) and use
 *   `m.div` / `m.h1` / … — NEVER `motion.*` from 'framer-motion'. The `m`
 *   components ship without an animation engine; <LazyMotion strict> throws in
 *   dev if a full `motion.*` component sneaks in, keeping the bundle honest.
 * - The domAnimation feature set (the actual animation engine) is loaded via a
 *   dynamic import of ./motionFeatures, so Rollup splits it into its own async
 *   chunk. Importing it as `import('framer-motion').then((mod) => mod.domAnimation)`
 *   directly would NOT split: 'framer-motion' is also statically imported here,
 *   and Rollup refuses to move a module that is both statically and dynamically
 *   imported into a separate chunk. The local re-export module keeps the split.
 * - <MotionConfig reducedMotion="user"> makes every m component respect
 *   prefers-reduced-motion (transform/layout animations are skipped; opacity
 *   still animates, which is the recommended accessible behavior).
 */
import { LazyMotion, MotionConfig } from 'framer-motion';
import type { ReactNode } from 'react';

export { m } from 'framer-motion';

const loadFeatures = () => import('./motionFeatures').then((mod) => mod.default);

/**
 * Wrap the root of each motion-using PUBLIC page with this provider (today:
 * HomePage). It deliberately does NOT live in PublicLayout or the App root:
 * both are part of the statically-imported app shell (main `index` chunk,
 * shared with the portal/admin), so mounting it there was measured to grow
 * that shared chunk by ~33 kB of framer runtime that portal users would pay
 * for. Inside a lazy public page, the framer runtime rides in that page's own
 * chunk and the engine (motionFeatures) stays a separate on-demand chunk —
 * portal/admin initial chunks stay framer-free. If several public pages adopt
 * motion later, revisit hoisting this into PublicLayout with fresh numbers.
 */
export function SiteMotionProvider({ children }: { children: ReactNode }) {
  return (
    <MotionConfig reducedMotion="user">
      <LazyMotion features={loadFeatures} strict>
        {children}
      </LazyMotion>
    </MotionConfig>
  );
}
