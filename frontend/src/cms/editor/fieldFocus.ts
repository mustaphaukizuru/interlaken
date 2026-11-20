/**
 * Field addresses and «jump to field» for the CMS editor (contract C3).
 *
 * A field path is the prop key, with list items as indexes: `title`,
 * `items.2.title`, `photos.0.image`. The backend uses the same paths in its
 * structured errors (`errors[].field`), so a server error and a client error
 * point at the same input.
 */

/** DOM id of the main control of a field (input, textarea, or the picker button). */
export const fieldDomId = (blockId: string, path: string) => `f-${blockId}-${path}`;

type Request = { blockId: string; path: string };
let pending: Request | null = null;
const listeners = new Set<(r: Request) => void>();

/**
 * Ask the block form to open the field's group and list item, scroll to it
 * and focus it. Works before the form of that block is mounted: the request
 * waits until the form of `blockId` takes it.
 */
export function requestFieldFocus(blockId: string, path: string) {
  pending = { blockId, path };
  for (const l of listeners) l(pending);
}

/** The pending request for this block, without consuming it (safe during render). */
export function peekFieldFocus(blockId: string): string | null {
  return pending?.blockId === blockId ? pending.path : null;
}

/** The pending request for this block, consumed (call from an effect or an event, never during render). */
export function takeFieldFocus(blockId: string): string | null {
  if (pending?.blockId !== blockId) return null;
  const { path } = pending;
  pending = null;
  return path;
}

export function onFieldFocusRequest(fn: (r: Request) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

const FOCUSABLE = 'input:not([type="hidden"]), textarea, select, button, [contenteditable="true"], [tabindex]:not([tabindex="-1"])';

/** Opens every collapsed list item around the field, then focuses its control. Returns false when the field is not on screen. */
export function focusFieldElement(root: ParentNode, blockId: string, path: string): boolean {
  const candidates = [path];
  // A link's href, a nested key the form does not show: fall back to the closest field above it.
  for (let p = path; p.includes('.'); ) { p = p.slice(0, p.lastIndexOf('.')); candidates.push(p); }
  for (const p of candidates) {
    const wrap = root.querySelector<HTMLElement>(`[data-field-path="${p.replace(/["\\]/g, '\\$&')}"]`);
    const el = (typeof document !== 'undefined' ? document.getElementById(fieldDomId(blockId, p)) : null) ?? wrap?.querySelector<HTMLElement>(FOCUSABLE) ?? null;
    if (!el) continue;
    for (let n: HTMLElement | null = el; n; n = n.parentElement) if (n instanceof HTMLDetailsElement) n.open = true;
    el.focus({ preventScroll: true });
    (wrap ?? el).scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    return true;
  }
  return false;
}
