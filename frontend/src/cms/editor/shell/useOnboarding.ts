import { useState } from 'react';

/** «Cómo editar una página» (docs/cms/editor-shell.md): dismissed once per browser. */
const KEY = 'cms-onboarding-dismissed';

function readDismissed(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

/** Shown until dismissed; «Más → Cómo editar» brings it back. */
export function useOnboarding() {
  const [visible, setVisible] = useState(() => !readDismissed());
  const dismiss = () => {
    setVisible(false);
    try { localStorage.setItem(KEY, '1'); } catch { /* private mode: hidden for this visit only */ }
  };
  return { visible, dismiss, show: () => setVisible(true) };
}
