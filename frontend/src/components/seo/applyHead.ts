/**
 * applyHead: writes one HeadData into document.head IN PLACE.
 *
 * The server (backend/apps/core/spa.py) already wrote the right tags for the
 * first URL into the raw HTML; this only rewrites their values on client-side
 * navigation, so there is always exactly ONE title, description, canonical,
 * og:* and twitter:* tag. (react-helmet-async appended a second canonical next
 * to the static one, and lost the route's tags entirely whenever a lazy page
 * re-suspended the layout, so inner pages declared the home page as canonical.)
 */
import type { HeadData } from '@/lib/siteMeta';

/** Marks page-level JSON-LD blocks (the site-wide graph in index.html has no marker). */
export const PAGE_LD_ATTR = 'data-page-ld';

function upsertMeta(attr: 'name' | 'property', key: string, content: string | undefined) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (content === undefined) {
    el?.remove();
    return;
  }
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  if (el.getAttribute('content') !== content) el.setAttribute('content', content);
}

function upsertCanonical(href: string) {
  const all = document.head.querySelectorAll<HTMLLinkElement>('link[rel="canonical"]');
  all.forEach((el, i) => { if (i > 0) el.remove(); });
  let el = all[0];
  if (!el) {
    el = document.createElement('link');
    el.rel = 'canonical';
    document.head.appendChild(el);
  }
  if (el.getAttribute('href') !== href) el.setAttribute('href', href);
}

export function applyHead(head: HeadData): void {
  if (typeof document === 'undefined') return;
  if (document.title !== head.title) document.title = head.title;
  upsertMeta('name', 'description', head.description);
  upsertCanonical(head.canonical);
  upsertMeta('name', 'robots', head.robots);
  upsertMeta('property', 'og:title', head.title);
  upsertMeta('property', 'og:description', head.description);
  upsertMeta('property', 'og:url', head.canonical);
  upsertMeta('property', 'og:image', head.image);
  upsertMeta('name', 'twitter:title', head.title);
  upsertMeta('name', 'twitter:description', head.description);
  upsertMeta('name', 'twitter:image', head.image);

  const wanted = head.jsonLd.map((b) => JSON.stringify(b));
  const current = Array.from(document.head.querySelectorAll<HTMLScriptElement>(`script[${PAGE_LD_ATTR}]`));
  if (current.length === wanted.length && current.every((s, i) => s.textContent === wanted[i])) return;
  current.forEach((s) => s.remove());
  for (const json of wanted) {
    const s = document.createElement('script');
    s.type = 'application/ld+json';
    s.setAttribute(PAGE_LD_ATTR, '');
    s.textContent = json;
    document.head.appendChild(s);
  }
}
