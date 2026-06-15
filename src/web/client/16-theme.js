// ---------------------------------------------------------------------------
// Theme selection — cycle + API persistence + Matrix rain easter egg
// ---------------------------------------------------------------------------

const THEME_CYCLE = ['dark', 'light', 'terminal']
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
  matrixCanvas.style.cssText =
    'position:fixed;inset:0;z-index:9998;pointer-events:none;opacity:0;transition:opacity 0.4s'
  document.body.appendChild(matrixCanvas)

  var ctx = matrixCanvas.getContext('2d')
  var W, H, cols, drops

  function resize() {
    W = matrixCanvas.width = window.innerWidth
    H = matrixCanvas.height = window.innerHeight
    cols = Math.floor(W / 14)
    drops = drops ? drops.slice(0, cols) : []
    while (drops.length < cols) drops.push(Math.random() * -H)
  }
  resize()
  window.addEventListener('resize', resize)

  setTimeout(function () {
    matrixCanvas.style.opacity = '1'
  }, 16)

  var chars = 'ｦｧｨｩｪｫｬｭｮｯｰｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0123456789'

  function draw() {
    ctx.fillStyle = 'rgba(5,10,5,0.06)'
    ctx.fillRect(0, 0, W, H)
    ctx.font = '14px monospace'
    for (var i = 0; i < cols; i++) {
      var ch = chars[Math.floor(Math.random() * chars.length)]
      var x = i * 14
      var y = drops[i]
      ctx.fillStyle = i % 5 === 0 ? '#c8ffc8' : '#00ff41'
      ctx.fillText(ch, x, y)
      if (y > H && Math.random() > 0.975) drops[i] = 0
      drops[i] += 14
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
    }, 450)
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
    }, 3000)
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
