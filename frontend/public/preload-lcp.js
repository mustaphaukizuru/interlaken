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
  // Fonts: the stylesheet is only preloaded in index.html so it cannot block
  // first paint; attach it here (async, every route) and let display=swap
  // upgrade the text once Poppins/Inter arrive.
  var pre = document.querySelector('link[rel="preload"][as="style"][href^="https://fonts.googleapis.com"]');
  if (pre) {
    var css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = pre.getAttribute('href');
    document.head.appendChild(css);
  }
  if (location.pathname !== '/') return;
  var link = document.createElement('link');
  link.rel = 'preload';
  link.as = 'image';
  link.href = '/assets/court-wide.webp';
  // Same candidates as the hero <img> srcSet (lib/images.ts) so the browser
  // preloads the size it will actually render instead of two files.
  link.setAttribute('imagesrcset', '/assets/court-wide-480.webp 480w, /assets/court-wide-960.webp 960w, /assets/court-wide.webp 1600w');
  link.setAttribute('imagesizes', '100vw');
  link.fetchPriority = 'high';
  document.head.appendChild(link);

})();
