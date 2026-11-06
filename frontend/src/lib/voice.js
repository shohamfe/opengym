// Workout voice: the phone's own speech engine reads the next set and the end of the rest.
// Off unless S.voice is on; silently does nothing where speechSynthesis is missing.
import { useStore } from '../store/useStore.js'

export const voiceSupported = () => typeof window !== 'undefined' && 'speechSynthesis' in window

export function say(text) {
  const S = useStore.getState().S
  if (!S.voice || !text || !voiceSupported()) return
  try {   // the voice must never break the rest timer that calls it
    const u = new SpeechSynthesisUtterance(text)
    u.lang = S.lang || 'en'
    speechSynthesis.cancel()
    speechSynthesis.speak(u)
  } catch { /* no voice, no harm */ }
}
