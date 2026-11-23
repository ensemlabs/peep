// Runs before first paint (external file: the CSP forbids inline scripts). Keep in sync with src/lib/theme.ts.
;(function () {
  var pref = 'system'
  try {
    var v = localStorage.getItem('ec_theme')
    if (v === 'light' || v === 'dark' || v === 'system') pref = v
  } catch (e) {}
  var dark = pref === 'dark' || (pref === 'system' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)
  var root = document.documentElement
  root.dataset.theme = dark ? 'dark' : 'light'
  root.classList.toggle('dark', dark)
})()
