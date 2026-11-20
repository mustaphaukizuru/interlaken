/**
 * The HTML the visual text editor stores (contract C5 «Rich text»). Browsers
 * write <b>, <i>, <div> and inline styles while editing; this turns them into
 * the tags the site's sanitizer keeps (<strong>, <em>, <p>) and then runs that
 * sanitizer, so `sanitizeHtml(normalizeRichHtml(x)) === normalizeRichHtml(x)`:
 * what is stored is exactly what the site shows.
 */
import { sanitizeHtml } from '../../sanitize';

const RENAME: Record<string, string> = { b: 'strong', i: 'em', div: 'p' };
const BLOCKS = new Set(['p', 'h2', 'h3', 'h4', 'ul', 'ol', 'blockquote', 'hr']);

export function normalizeRichHtml(html: string): string {
  if (typeof DOMParser === 'undefined') return sanitizeHtml(html);
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  const root = doc.body.firstElementChild;
  if (!root) return '';
  const walk = (el: Element) => {
    for (const child of Array.from(el.children)) {
      const tag = child.tagName.toLowerCase();
      let node: Element = child;
      if (RENAME[tag]) {
        node = doc.createElement(RENAME[tag]);
        while (child.firstChild) node.appendChild(child.firstChild);
        for (const a of Array.from(child.attributes)) node.setAttribute(a.name, a.value);
        child.replaceWith(node);
      }
      // Browser styling attributes never reach the site.
      for (const a of ['style', 'class', 'dir', 'id']) node.removeAttribute(a);
      walk(node);
    }
  };
  walk(root);
  // A <p> inside a <p> (pasting, Enter in some browsers) is unwrapped.
  for (const inner of Array.from(root.querySelectorAll('p p'))) {
    const frag = doc.createDocumentFragment();
    while (inner.firstChild) frag.appendChild(inner.firstChild);
    inner.replaceWith(frag);
  }
  // Loose text at the top level goes into a paragraph.
  let loose: Element | null = null;
  for (const n of Array.from(root.childNodes)) {
    const isBlock = n.nodeType === 1 && BLOCKS.has((n as Element).tagName.toLowerCase());
    if (isBlock) { loose = null; continue; }
    if (n.nodeType === 3 && !n.textContent?.trim() && !loose) { n.remove(); continue; }
    if (!loose) { loose = doc.createElement('p'); n.replaceWith(loose); }
    loose.appendChild(n);
  }
  // Trailing empty paragraphs left by Enter.
  while (root.lastElementChild?.tagName === 'P' && !root.lastElementChild.textContent?.trim() && !root.lastElementChild.querySelector('a')) root.lastElementChild.remove();
  return sanitizeHtml(root.innerHTML);
}

/** Plain text of rich HTML (empty check, summaries). */
export const richPlainText = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
