// ---------------------------------------------------------------------------
// Matrix-style boot loader
//
// The first /api/projects round-trip leaves both panels empty — a black flash
// until data lands. This overlays a Matrix rain plus a "decrypting" status
// readout, then dissolves once the first render arrives. Shown once, on the
// initial load only; self-contained (no HTML/CSS dependencies).
// ---------------------------------------------------------------------------

var loadingOverlay = null
var loadingRaf = null
var loadingResize = null
var loadingStatusTimer = null
var loadingBarTimer = null
var loadingShownAt = 0
var loadingDismissed = false

var LOADING_GLYPHS = 'ｦｧｨｩｪｫｬｭｮｯｰｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉ0123456789<>/\\[]{}#*='
var LOADING_MESSAGES = ['ESTABLISHING LINK', 'DECRYPTING TRANSCRIPTS', 'INDEXING SESSIONS']
var LOADING_MIN_MS = 750
var LOADING_SAFETY_MS = 8000

function showLoadingOverlay() {
  if (loadingOverlay || loadingDismissed || !document.body) return
  loadingShownAt = Date.now()

  var overlay = document.createElement('div')
  overlay.id = 'reup-loading'
  overlay.style.cssText =
    'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;' +
    'background:#050a05;transition:opacity 0.5s ease;' +
    'font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace'

  var canvas = document.createElement('canvas')
  canvas.style.cssText = 'position:absolute;inset:0;opacity:0.5'
  overlay.appendChild(canvas)

  var panel = document.createElement('div')
  panel.style.cssText =
    'position:relative;text-align:center;color:#00ff41;text-shadow:0 0 10px rgba(0,255,65,0.55)'
  panel.innerHTML =
    '<div style="font-size:44px;font-weight:700;letter-spacing:10px;padding-left:10px">reup</div>' +
    '<div class="rl-status" style="margin-top:18px;font-size:13px;letter-spacing:3px;' +
    'min-height:1em;color:#8fffb0"></div>' +
    '<div class="rl-bar" style="margin-top:12px;font-size:13px;letter-spacing:2px"></div>'
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
    columns = Math.floor(width / 14)
    drops = drops.slice(0, columns)
    while (drops.length < columns) drops.push(Math.random() * -height)
  }
  loadingResize()
  window.addEventListener('resize', loadingResize)

  function draw() {
    ctx.fillStyle = 'rgba(5,10,5,0.08)'
    ctx.fillRect(0, 0, width, height)
    ctx.font = '14px monospace'
    for (var i = 0; i < columns; i++) {
      ctx.fillStyle = i % 7 === 0 ? '#c8ffc8' : '#00ff41'
      ctx.fillText(
        LOADING_GLYPHS[Math.floor(Math.random() * LOADING_GLYPHS.length)],
        i * 14,
        drops[i]
      )
      if (drops[i] > height && Math.random() > 0.975) drops[i] = 0
      drops[i] += 14
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
  loadingStatusTimer = setInterval(nextMessage, 1100)

  var barFrame = 0
  var barWidth = 16
  loadingBarTimer = setInterval(function () {
    var filled = barFrame % (barWidth + 1)
    var bar = ''
    for (var i = 0; i < barWidth; i++) bar += i < filled ? '█' : '▒'
    barEl.textContent = '[' + bar + ']'
    barFrame++
  }, 80)
}

/** Resolves random glyphs into the target text, left to right — "decrypt" effect. */
function scrambleReveal(element, text) {
  var frame = 0
  var totalFrames = 16
  function step() {
    if (!loadingOverlay) return
    var revealed = Math.floor((frame / totalFrames) * text.length)
    var output = ''
    for (var i = 0; i < text.length; i++) {
      if (i < revealed || text[i] === ' ') output += text[i]
      else output += LOADING_GLYPHS[Math.floor(Math.random() * LOADING_GLYPHS.length)]
    }
    element.textContent = output
    frame++
    if (frame <= totalFrames) requestAnimationFrame(step)
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
    }, 550)
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
    var glyph = LOADING_GLYPHS[Math.floor(Math.random() * LOADING_GLYPHS.length)]
    cells += '<span style="animation-delay:' + i * 90 + 'ms">' + glyph + '</span>'
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
