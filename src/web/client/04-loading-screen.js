// ---------------------------------------------------------------------------
// Matrix-style boot loader
//
// The first /api/projects round-trip leaves both panels empty — a black flash
// until data lands. This overlays a Matrix rain plus a "decrypting" status
// readout, then dissolves once the first render arrives. Shown once, on the
// initial load only.
// ---------------------------------------------------------------------------

var loadingOverlay = null
var loadingRaf = null
var loadingResize = null
var loadingStatusTimer = null
var loadingBarTimer = null
var loadingShownAt = 0
var loadingDismissed = false

var MATRIX_RAIN_GLYPHS = 'ｦｧｨｩｪｫｬｭｮｯｰｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉ0123456789<>/\\[]{}#*='
var MATRIX_RAIN_COLUMN_WIDTH = 14
var MATRIX_RAIN_FONT = '14px monospace'
var MATRIX_RAIN_PRIMARY = '#00ff41'
var MATRIX_RAIN_BRIGHT = '#c8ffc8'
var MATRIX_RAIN_RESET_THRESHOLD = 0.975
var LOADING_MESSAGES = ['ESTABLISHING LINK', 'DECRYPTING TRANSCRIPTS', 'INDEXING SESSIONS']
var LOADING_MIN_MS = 750
var LOADING_SAFETY_MS = 8000
var LOADING_TRAIL_FILL = 'rgba(5,10,5,0.08)'
var LOADING_BRIGHT_COLUMN_INTERVAL = 7
var LOADING_STATUS_INTERVAL_MS = 1100
var LOADING_BAR_INTERVAL_MS = 80
var LOADING_BAR_WIDTH = 16
var LOADING_REVEAL_FRAMES = 16
var LOADING_REMOVE_DELAY_MS = 550
var MATRIX_SOFT_STAGGER_MS = 90

function showLoadingOverlay() {
  if (loadingOverlay || loadingDismissed || !document.body) return
  loadingShownAt = Date.now()

  var overlay = document.createElement('div')
  overlay.id = 'reup-loading'

  var canvas = document.createElement('canvas')
  canvas.className = 'rl-canvas'
  overlay.appendChild(canvas)

  var panel = document.createElement('div')
  panel.className = 'rl-panel'
  panel.innerHTML =
    '<div class="rl-title">reup</div>' +
    '<div class="rl-status"></div>' +
    '<div class="rl-bar"></div>'
  overlay.appendChild(panel)
  document.body.appendChild(overlay)

  loadingOverlay = overlay
  startLoadingRain(canvas)
  startLoadingStatus(panel.querySelector('.rl-status'), panel.querySelector('.rl-bar'))
  setTimeout(hideLoadingOverlay, LOADING_SAFETY_MS)
}

function startLoadingRain(canvas) {
  var ctx = canvas.getContext('2d')
  var width = 0
  var height = 0
  var columns = 0
  var drops = []

  loadingResize = function () {
    width = canvas.width = window.innerWidth
    height = canvas.height = window.innerHeight
    columns = Math.floor(width / MATRIX_RAIN_COLUMN_WIDTH)
    drops = drops.slice(0, columns)
    while (drops.length < columns) drops.push(Math.random() * -height)
  }
  loadingResize()
  window.addEventListener('resize', loadingResize)

  function draw() {
    ctx.fillStyle = LOADING_TRAIL_FILL
    ctx.fillRect(0, 0, width, height)
    ctx.font = MATRIX_RAIN_FONT
    for (var i = 0; i < columns; i++) {
      ctx.fillStyle =
        i % LOADING_BRIGHT_COLUMN_INTERVAL === 0 ? MATRIX_RAIN_BRIGHT : MATRIX_RAIN_PRIMARY
      ctx.fillText(
        MATRIX_RAIN_GLYPHS[Math.floor(Math.random() * MATRIX_RAIN_GLYPHS.length)],
        i * MATRIX_RAIN_COLUMN_WIDTH,
        drops[i]
      )
      if (drops[i] > height && Math.random() > MATRIX_RAIN_RESET_THRESHOLD) drops[i] = 0
      drops[i] += MATRIX_RAIN_COLUMN_WIDTH
    }
    loadingRaf = requestAnimationFrame(draw)
  }
  loadingRaf = requestAnimationFrame(draw)
}

function startLoadingStatus(statusEl, barEl) {
  var messageIndex = 0
  function nextMessage() {
    scrambleReveal(statusEl, LOADING_MESSAGES[messageIndex % LOADING_MESSAGES.length])
    messageIndex++
  }
  nextMessage()
  loadingStatusTimer = setInterval(nextMessage, LOADING_STATUS_INTERVAL_MS)

  var barFrame = 0
  loadingBarTimer = setInterval(function () {
    var filled = barFrame % (LOADING_BAR_WIDTH + 1)
    var bar = ''
    for (var i = 0; i < LOADING_BAR_WIDTH; i++) bar += i < filled ? '█' : '▒'
    barEl.textContent = '[' + bar + ']'
    barFrame++
  }, LOADING_BAR_INTERVAL_MS)
}

/** Resolves random glyphs into the target text, left to right — "decrypt" effect. */
function scrambleReveal(element, text) {
  var frame = 0
  function step() {
    if (!loadingOverlay) return
    var revealed = Math.floor((frame / LOADING_REVEAL_FRAMES) * text.length)
    var output = ''
    for (var i = 0; i < text.length; i++) {
      if (i < revealed || text[i] === ' ') output += text[i]
      else output += MATRIX_RAIN_GLYPHS[Math.floor(Math.random() * MATRIX_RAIN_GLYPHS.length)]
    }
    element.textContent = output
    frame++
    if (frame <= LOADING_REVEAL_FRAMES) requestAnimationFrame(step)
  }
  step()
}

/** Fades and removes the boot loader, honouring a minimum on-screen time. */
function hideLoadingOverlay() {
  loadingDismissed = true
  if (!loadingOverlay) return
  var wait = Math.max(0, LOADING_MIN_MS - (Date.now() - loadingShownAt))
  setTimeout(function () {
    if (!loadingOverlay) return
    var overlay = loadingOverlay
    loadingOverlay = null
    overlay.style.opacity = '0'
    if (loadingRaf) cancelAnimationFrame(loadingRaf)
    if (loadingStatusTimer) clearInterval(loadingStatusTimer)
    if (loadingBarTimer) clearInterval(loadingBarTimer)
    if (loadingResize) window.removeEventListener('resize', loadingResize)
    loadingRaf = loadingStatusTimer = loadingBarTimer = loadingResize = null
    setTimeout(function () {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay)
    }, LOADING_REMOVE_DELAY_MS)
  }, wait)
}

/**
 * Returns a soft, CSS-animated Matrix shimmer for in-panel loading states
 * (deep search, touched-file expansion). Pure markup — no timers to clean up,
 * since the container's innerHTML is replaced once results arrive.
 */
function matrixSoftLoaderHtml(label, compact) {
  var cells = ''
  for (var i = 0; i < 11; i++) {
    var glyph = MATRIX_RAIN_GLYPHS[Math.floor(Math.random() * MATRIX_RAIN_GLYPHS.length)]
    cells +=
      '<span style="animation-delay:' + i * MATRIX_SOFT_STAGGER_MS + 'ms">' + glyph + '</span>'
  }
  return (
    '<div class="msoft' +
    (compact ? ' msoft-compact' : '') +
    '"><div class="msoft-rain">' +
    cells +
    '</div><div class="msoft-label">' +
    escapeHtml(label || '') +
    '<span class="msoft-cursor">▋</span></div></div>'
  )
}

showLoadingOverlay()
