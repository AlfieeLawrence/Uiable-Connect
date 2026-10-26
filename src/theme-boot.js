'use strict';
(function () {
  try {
    var known = { dark: 1, light: 1, solarized: 1, dracula: 1, monokai: 1 };
    var p = localStorage.getItem('uc.theme') || 'dark';
    var r;
    if (p === 'system') {
      r = (window.matchMedia && matchMedia('(prefers-color-scheme: light)').matches) ? 'light' : 'dark';
    } else if (known[p]) {
      r = p;
    } else {
      r = 'dark';
    }
    document.documentElement.setAttribute('data-theme', r);
  } catch (e) {}
})();
