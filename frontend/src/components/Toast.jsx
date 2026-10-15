import { useUI } from '../store/useUI.js'
export default function Toast() {
  const msg = useUI(s => s.toastMsg)
  return <div id="toast" role="status" aria-live="polite" className={msg ? 'show' : ''}>{msg}</div>
}
