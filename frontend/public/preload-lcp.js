/**
 * preload-lcp.js — attach the web-font stylesheet without blocking first paint.
 *
 * The home hero's LCP image no longer needs a script (2026-11-23): this file
 * used to guess it, and the guess went stale when the media round changed the
 * default poster while the school's published home kept court-wide.webp, so
 * visitors downloaded a photo they never saw. Now the HTML itself carries it:
 *   - home page not published in Contenido: the first-paint shell
 *     (public/shells.json, written by backend/apps/core/spa.py) holds the
 *     poster <img>, discovered while the HTML parses;
 *   - published home: spa.py writes a <link rel="preload"> for the poster the
 *     published hero really shows (content.pages.hero_preload).
 *
 * Lives in its own file (loaded with `defer` from index.html) because the
 * public CSP is `script-src 'self'` — inline scripts are blocked.
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
})();
