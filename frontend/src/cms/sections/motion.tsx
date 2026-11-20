import type { ComponentType } from 'react';
import { SiteMotionProvider } from '@/lib/motion';

/** Sections that use framer `m` carry their own provider, so they animate in the editor and on any page. */
export function withMotion<P extends object>(C: ComponentType<P>): ComponentType<P> {
  const Wrapped = (props: P) => <SiteMotionProvider><C {...props} /></SiteMotionProvider>;
  Wrapped.displayName = `withMotion(${C.displayName ?? C.name ?? 'Section'})`;
  return Wrapped;
}
