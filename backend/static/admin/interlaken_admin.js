/* Colegio Interlaken — Django admin mobile niceties.
   Tiny, vanilla, no framework. Progressive enhancement only:
   if any element is absent the feature simply no-ops. */
(function () {
  'use strict';

  function isMobile() {
    return window.matchMedia('(max-width: 991.98px)').matches;
  }

  document.addEventListener('DOMContentLoaded', function () {

    // 1) Tap the dimmed content to close the off-canvas sidebar drawer.
    var content = document.querySelector('.content-wrapper');
    if (content) {
      content.addEventListener('click', function () {
        if (isMobile() && document.body.classList.contains('sidebar-open')) {
          document.body.classList.remove('sidebar-open');
        }
      });
    }

    // 2) Close the drawer after choosing a leaf nav item (mobile).
    Array.prototype.forEach.call(
      document.querySelectorAll('.nav-sidebar .nav-link'),
      function (link) {
        if (link.querySelector('.right')) { return; } // treeview toggle — keep open
        link.addEventListener('click', function () {
          if (isMobile()) { document.body.classList.remove('sidebar-open'); }
        });
      }
    );

    // 3) Collapse the change-list filter panel behind a "Filtros" toggle on mobile.
    var filter = document.getElementById('changelist-filter');
    if (filter && isMobile()) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-outline-info btn-block interlaken-filter-toggle';
      btn.textContent = 'Filtros';
      btn.setAttribute('aria-expanded', 'false');
      btn.setAttribute('aria-controls', 'changelist-filter');
      filter.classList.add('interlaken-filter-collapsed');
      filter.parentNode.insertBefore(btn, filter);
      btn.addEventListener('click', function () {
        var open = filter.classList.toggle('interlaken-filter-open');
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
    }
  });
})();
