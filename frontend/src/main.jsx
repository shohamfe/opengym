import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App, { CONSENT } from './App.jsx'
import { MOBILE } from './lib/mobile.js'
import './index.css'

createRoot(document.getElementById('root')).render(
  <StrictMode><App /></StrictMode>
)

// Not in the mobile build: the native shell already serves everything from disk. Not on the
// consent page either: from /oauth/ the relative 'sw.js' would register a second worker there.
if (!MOBILE && !CONSENT && 'serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {})
}
