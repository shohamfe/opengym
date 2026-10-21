// Tiny canvas confetti burst for "exercise done". One shared canvas; rapid bursts append particles.
let cv = null, ctx = null, parts = [], raf = 0, last = 0

export function confetti(x, y, n = 28) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
  if (!cv) {
    cv = document.createElement('canvas')
    cv.setAttribute('aria-hidden', 'true')
    cv.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:150'
    document.body.appendChild(cv)
    ctx = cv.getContext('2d')
  }
  const dpr = Math.min(devicePixelRatio || 1, 2)
  cv.width = innerWidth * dpr; cv.height = innerHeight * dpr
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  const css = getComputedStyle(document.documentElement)
  const cols = ['--acc', '--acc', '--blue', '--orange', '--yellow', '--pink', '--purple', '--teal'].map(v => css.getPropertyValue(v).trim() || '#30d158')
  const now = performance.now()
  for (let k = 0; k < n; k++) {
    const a = -Math.PI / 2 + (Math.random() * 2 - 1) * 0.96, v = 260 + Math.random() * 260 // ±55° around straight up
    parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, r: Math.random() * 6, vr: (Math.random() * 2 - 1) * 10,
      c: cols[k % cols.length], rect: Math.random() < 0.6, t0: now })
  }
  if (!raf) { last = now; raf = requestAnimationFrame(frame) }
}

function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.05); last = now
  ctx.clearRect(0, 0, innerWidth, innerHeight)
  parts = parts.filter(p => now - p.t0 < 1000)
  for (const p of parts) {
    p.vx *= 0.985; p.vy += 1400 * dt
    p.x += p.vx * dt; p.y += p.vy * dt; p.r += p.vr * dt
    const age = now - p.t0
    ctx.globalAlpha = age < 600 ? 1 : 1 - (age - 600) / 400
    ctx.fillStyle = p.c
    ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r)
    if (p.rect) ctx.fillRect(-3, -5, 6, 10)
    else { ctx.beginPath(); ctx.arc(0, 0, 2.5, 0, Math.PI * 2); ctx.fill() }
    ctx.restore()
  }
  raf = parts.length ? requestAnimationFrame(frame) : 0
}
