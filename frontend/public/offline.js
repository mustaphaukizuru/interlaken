/*
 * offline.js: puts the offline-page copy edited in Navegación («Textos del
 * sitio») into offline.html. The site stores it in localStorage
 * (src/lib/offlineCopy.ts) whenever it loads the site settings; without it
 * the page keeps its built-in text. Text only (textContent), never markup.
 */
(function () {
  try {
    var raw = window.localStorage.getItem('ik:offline-copy');
    if (!raw) return;
    var copy = JSON.parse(raw) || {};
    var set = function (id, key) {
      var el = document.getElementById(id);
      var v = copy[key];
      if (el && typeof v === 'string' && v.trim()) el.textContent = v.trim();
    };
    set('offline-title', 'offline_title');
    set('offline-accent', 'offline_accent');
    set('offline-text', 'offline_text');
    set('offline-retry', 'offline_retry');
    set('offline-home', 'offline_home');
  } catch (e) {
    /* Storage blocked or bad data: keep the built-in text. */
  }
})();
