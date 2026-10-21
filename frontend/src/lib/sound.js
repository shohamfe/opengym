// WebAudio beeps + haptics (ported from the vanilla app). `enabled` gates sound.
let audioCtx = null
// iOS: 'ambient' obeys the silent switch and mixes with the user's music instead of pausing it
try { if (navigator.audioSession) navigator.audioSession.type = 'ambient' } catch (e) { /* */ }
export function beep(enabled, freq, dur, when) {
  if (!enabled) return
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)()
    const o = audioCtx.createOscillator(), g = audioCtx.createGain()
    o.connect(g); g.connect(audioCtx.destination)
    o.frequency.value = freq || 880; o.type = 'sine'
    const t0 = audioCtx.currentTime + (when || 0)
    g.gain.setValueAtTime(0.001, t0)
    g.gain.exponentialRampToValueAtTime(0.35, t0 + 0.02)
    g.gain.exponentialRampToValueAtTime(0.001, t0 + (dur || 0.18))
    o.start(t0); o.stop(t0 + (dur || 0.18) + 0.05)
  } catch (e) { /* */ }
}
// short audio files (src/assets/sounds, Kenney CC0), decoded once and played through the same context as beep()
const bufs = {}
export function play(enabled, url) {
  if (!enabled) return
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)()
    const ctx = audioCtx
    bufs[url] = bufs[url] || fetch(url).then(r => r.arrayBuffer()).then(b => ctx.decodeAudioData(b))
    bufs[url].then(buf => { const s = ctx.createBufferSource(); s.buffer = buf; s.connect(ctx.destination); s.start() }).catch(() => { delete bufs[url] })
  } catch (e) { /* */ }
}
export function vibrate(p) { try { navigator.vibrate && navigator.vibrate(p) } catch (e) { /* */ } }
