/**
 * Allow-list HTML sanitizer for CMS rich text (no external dependency).
 * Keeps block/inline formatting, links and lists; strips scripts, handlers,
 * styles, iframes and any javascript: URL. Runs in the browser via DOMParser.
 */
const ALLOWED: Record<string, string[]> = {
  p: [], br: [], strong: [], b: [], em: [], i: [], u: [], s: [],
  h2: [], h3: [], h4: [], ul: [], ol: [], li: [], blockquote: [], hr: [],
  a: ['href', 'title', 'target', 'rel'],
  span: [], small: [],
};

export function sanitizeHtml(html: string): string {
  if (typeof DOMParser === 'undefined') return '';
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  const root = doc.body.firstElementChild;
  if (!root) return '';
  const walk = (el: Element) => {
    for (const child of Array.from(el.children)) {
      const tag = child.tagName.toLowerCase();
      if (!(tag in ALLOWED)) {
        // unwrap unknown elements (keep their text), drop dangerous ones outright
        if (['script', 'style', 'iframe', 'object', 'embed', 'svg', 'img', 'video'].includes(tag)) { child.remove(); continue; }
        const frag = doc.createDocumentFragment();
        while (child.firstChild) frag.appendChild(child.firstChild);
        child.replaceWith(frag);
        continue;
      }
      for (const attr of Array.from(child.attributes)) {
        if (!ALLOWED[tag].includes(attr.name)) child.removeAttribute(attr.name);
      }
      if (tag === 'a') {
        const href = child.getAttribute('href') ?? '';
        if (/^\s*(javascript|data|vbscript):/i.test(href)) child.removeAttribute('href');
        if (child.getAttribute('target') === '_blank') child.setAttribute('rel', 'noopener noreferrer');
      }
      walk(child);
    }
  };
  walk(root);
  return root.innerHTML;
}
