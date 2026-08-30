// Shared i18n helper for melthewinner sub-pages
// Each page defines window.PAGE_TRANS = { en: {...}, pt: {...} } before loading this script
(function () {
  var _l = localStorage.getItem('mel-lang') || 'en';

  function apply(l) {
    var T = window.PAGE_TRANS || {};
    var data = T[l] || T['en'] || {};
    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      var v = data[el.dataset.i18n];
      if (v !== undefined) el.textContent = v;
    });
    document.querySelectorAll('[data-i18n-html]').forEach(function (el) {
      var v = data[el.dataset.i18nHtml];
      if (v !== undefined) el.innerHTML = v;
    });
    document.querySelectorAll('[data-i18n-ph]').forEach(function (el) {
      var v = data[el.dataset.i18nPh];
      if (v !== undefined) el.placeholder = v;
    });
    document.querySelectorAll('.lang-btn').forEach(function (b) {
      b.classList.toggle('active-lang', b.dataset.lang === l);
    });
    localStorage.setItem('mel-lang', l);
    _l = l;
  }

  window.setLang = apply;

  document.addEventListener('DOMContentLoaded', function () {
    apply(_l);
  });
})();
