/**
 * motionFeatures.ts — split point for the framer-motion animation engine.
 *
 * Only ever imported dynamically (see lib/motion.tsx). This indirection exists
 * so Rollup can put domAnimation in its own lazy chunk even though the
 * 'framer-motion' entry is also statically imported for LazyMotion/m.
 */
import { domAnimation } from 'framer-motion';

export default domAnimation;
