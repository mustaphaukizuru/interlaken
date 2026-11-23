/**
 * preload-lcp.js — kick off the home-page hero fetch before the SPA boots.
 *
 * The hero poster (/assets/hero-home.webp, ~80 kB, the first frame of the
 * hero video; it was court-wide.webp before the 2026-11-22 media round) is
 * the LCP element of "/", but
 * as a React-rendered <img> it is only discovered after index/vendor download
 * and execute. Injecting a high-priority preload at HTML-parse time starts the
 * image download in parallel with the JS instead. Route-conditional so portal
 * and other public routes don't pay ~144 kB for an image they never render.
 *
 * Lives in its own file (loaded with `defer` from index.html) because the
 * public CSP is `script-src 'self'` — inline scripts are blocked. Keep the
 * href and `imagesizes` in sync with the poster <img> in
 * src/components/public/HeroVideo.tsx and the home hero default in
 * src/cms/sections/home.tsx.
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
  link.href = '/assets/hero-home.webp';
  // Same candidates and sizes as the poster <img> (lib/images.ts, HeroVideo)
  // so the browser preloads the file it will actually render, once.
  link.setAttribute('imagesrcset', '/assets/hero-home-480.webp 480w, /assets/hero-home-960.webp 960w, /assets/hero-home.webp 1600w');
  link.setAttribute('imagesizes', '(orientation: portrait) 165vh, 100vw');
  link.fetchPriority = 'high';
  document.head.appendChild(link);

})();
