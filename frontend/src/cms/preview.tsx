/**
 * Editor-preview flag (its own module so public pages that never ask do not
 * load it). EditableBlocks sets it; sections that carry application logic
 * (sign-in, invitation and confirmation links) render a sample state there
 * instead of running it: the editor must never sign anyone in, redirect or
 * spend a token.
 */
import { createContext, useContext, type ReactNode } from 'react';

const PreviewContext = createContext(false);

/** Set by the editor's live preview (cms/editor/EditableBlocks). */
export function CmsPreviewProvider({ children }: { children: ReactNode }) {
  return <PreviewContext.Provider value>{children}</PreviewContext.Provider>;
}

/** True inside the editor preview. */
export const useCmsPreview = () => useContext(PreviewContext);
