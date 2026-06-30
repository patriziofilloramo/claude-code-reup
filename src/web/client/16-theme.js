// ---------------------------------------------------------------------------
// Theme selection — cycle + API persistence + Matrix rain easter egg
// ---------------------------------------------------------------------------

const THEME_CYCLE = ['dark', 'light', 'terminal']
const MATRIX_EASTER_TRAIL_FILL = 'rgba(5,10,5,0.06)'
const MATRIX_EASTER_BRIGHT_COLUMN_INTERVAL = 5
const MATRIX_EASTER_FADE_IN_DELAY_MS = 16
const MATRIX_EASTER_REMOVE_DELAY_MS = 450
const MATRIX_HOLD_TO_START_MS = 3000
const THEME_ICONS = { dark: '◐', light: '○', terminal: '█' }

function getActiveTheme() {
  return document.documentElement.getAttribute('data-theme') || 'dark'
}

function applyTheme(name) {
  document.documentElement.setAttribute('data-theme', name)
  var btn = document.getElementById('ftr-theme-btn')
  if (btn) btn.textContent = (THEME_ICONS[name] || '●') + ' ' + name
}

function cycleTheme() {
  var current = getActiveTheme()
  var idx = THEME_CYCLE.indexOf(current)
  var next = THEME_CYCLE[(idx + 1) % THEME_CYCLE.length]
  applyTheme(next)
  fetch('/api/theme', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: next }),
  }).catch(function () {})
}

// ── Matrix rain easter egg (terminal theme, logo hold ≥3 s) ─────────────

var matrixActive = false
var matrixCanvas = null
var matrixRaf = null
var logoHoldTimer = null

function startMatrixRain() {
  if (matrixActive) return
  matrixActive = true

  matrixCanvas = document.createElement('canvas')
  matrixCanvas.className = 'matrix-canvas'
  document.body.appendChild(matrixCanvas)

  var ctx = matrixCanvas.getContext('2d')
  var W, H, cols, drops

  function resize() {
    W = matrixCanvas.width = window.innerWidth
    H = matrixCanvas.height = window.innerHeight
    cols = Math.floor(W / MATRIX_RAIN_COLUMN_WIDTH)
    drops = drops ? drops.slice(0, cols) : []
    while (drops.length < cols) drops.push(Math.random() * -H)
  }
  resize()
  window.addEventListener('resize', resize)

  setTimeout(function () {
    matrixCanvas.style.opacity = '1'
  }, MATRIX_EASTER_FADE_IN_DELAY_MS)

  function draw() {
    ctx.fillStyle = MATRIX_EASTER_TRAIL_FILL
    ctx.fillRect(0, 0, W, H)
    ctx.font = MATRIX_RAIN_FONT
    for (var i = 0; i < cols; i++) {
      var ch = MATRIX_RAIN_GLYPHS[Math.floor(Math.random() * MATRIX_RAIN_GLYPHS.length)]
      var x = i * MATRIX_RAIN_COLUMN_WIDTH
      var y = drops[i]
      ctx.fillStyle =
        i % MATRIX_EASTER_BRIGHT_COLUMN_INTERVAL === 0 ? MATRIX_RAIN_BRIGHT : MATRIX_RAIN_PRIMARY
      ctx.fillText(ch, x, y)
      if (y > H && Math.random() > MATRIX_RAIN_RESET_THRESHOLD) drops[i] = 0
      drops[i] += MATRIX_RAIN_COLUMN_WIDTH
    }
    matrixRaf = requestAnimationFrame(draw)
  }
  matrixRaf = requestAnimationFrame(draw)
}

function stopMatrixRain() {
  if (!matrixActive) return
  matrixActive = false
  if (matrixRaf) {
    cancelAnimationFrame(matrixRaf)
    matrixRaf = null
  }
  if (matrixCanvas) {
    matrixCanvas.style.opacity = '0'
    var c = matrixCanvas
    setTimeout(function () {
      if (c.parentNode) c.parentNode.removeChild(c)
    }, MATRIX_EASTER_REMOVE_DELAY_MS)
    matrixCanvas = null
  }
}

var logoEl = document.querySelector('.logo')
if (logoEl) {
  logoEl.addEventListener('mousedown', function () {
    if (getActiveTheme() !== 'terminal') return
    logoHoldTimer = setTimeout(function () {
      startMatrixRain()
      logoHoldTimer = null
    }, MATRIX_HOLD_TO_START_MS)
  })
  logoEl.addEventListener('mouseup', function () {
    if (logoHoldTimer) {
      clearTimeout(logoHoldTimer)
      logoHoldTimer = null
    }
  })
  logoEl.addEventListener('mouseleave', function () {
    if (logoHoldTimer) {
      clearTimeout(logoHoldTimer)
      logoHoldTimer = null
    }
  })
  logoEl.addEventListener('click', function () {
    if (matrixActive) stopMatrixRain()
  })
}

// initialise button label from current data-theme (set server-side)
applyTheme(getActiveTheme())
