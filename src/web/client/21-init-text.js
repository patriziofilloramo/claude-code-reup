// ---------------------------------------------------------------------------
// Static text initialisation — sets every translatable string from STRINGS so
// that ui.html contains no user-visible text. To add a new translatable
// element, add the key to STRINGS and one of these data attributes:
//   data-str="key"             → el.textContent
//   data-str-placeholder="key" → el.placeholder
//   data-str-title="key"       → el.title
//   data-str-aria="key"        → el.setAttribute('aria-label', …)
// ---------------------------------------------------------------------------

function initStaticText() {
  document.querySelectorAll('[data-str]').forEach(function (el) {
    var key = el.dataset.str
    if (STRINGS[key] !== undefined) el.textContent = STRINGS[key]
  })
  document.querySelectorAll('[data-str-placeholder]').forEach(function (el) {
    var key = el.dataset.strPlaceholder
    if (STRINGS[key] !== undefined) el.placeholder = STRINGS[key]
  })
  document.querySelectorAll('[data-str-title]').forEach(function (el) {
    var key = el.dataset.strTitle
    if (STRINGS[key] !== undefined) el.title = STRINGS[key]
  })
  document.querySelectorAll('[data-str-aria]').forEach(function (el) {
    var key = el.dataset.strAria
    if (STRINGS[key] !== undefined) el.setAttribute('aria-label', STRINGS[key])
  })
}

initStaticText()
