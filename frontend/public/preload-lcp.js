/**
 * preload-lcp.js — kick off the home-page hero fetch before the SPA boots.
 *
 * The hero (/assets/court-wide.webp, ~144 kB) is the LCP element of "/", but
 * as a React-rendered <img> it is only discovered after index/vendor download
 * and execute. Injecting a high-priority preload at HTML-parse time starts the
 * image download in parallel with the JS instead. Route-conditional so portal
 * and other public routes don't pay ~144 kB for an image they never render.
 *
 * Lives in its own file (loaded with `defer` from index.html) because the
 * public CSP is `script-src 'self'` — inline scripts are blocked. Keep the
 * href in sync with the hero <img> in src/pages/public/HomePage.tsx.
 */
(function () {
  if (location.pathname !== '/') return;
  var link = document.createElement('link');
  link.rel = 'preload';
  link.as = 'image';
  link.href = '/assets/court-wide.webp';
  link.fetchPriority = 'high';
  document.head.appendChild(link);
})();
