// WebAudio beeps + haptics (ported from the vanilla app). `enabled` gates sound.
let audioCtx = null
// iOS: 'ambient' obeys the silent switch and mixes with the user's music instead of pausing it.
// Set again before every sound, since iOS can reset the session when the app comes back.
function ctx() {
  try { if (navigator.audioSession && navigator.audioSession.type !== 'ambient') navigator.audioSession.type = 'ambient' } catch (e) { /* */ }
  audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)()
  return audioCtx
}
export function beep(enabled, freq, dur, when) {
  if (!enabled) return
  try {
    ctx()
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
    const c = ctx()
    bufs[url] = bufs[url] || fetch(url).then(r => r.arrayBuffer()).then(b => c.decodeAudioData(b))
    bufs[url].then(buf => { const s = c.createBufferSource(); s.buffer = buf; s.connect(c.destination); s.start() }).catch(() => { delete bufs[url] })
  } catch (e) { /* */ }
}
export function vibrate(p) { try { navigator.vibrate && navigator.vibrate(p) } catch (e) { /* */ } }
