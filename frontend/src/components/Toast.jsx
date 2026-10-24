import { Toaster } from 'sonner'
import { useStore } from '../store/useStore.js'

// sonner draws the toasts; colours and the bottom offset come from index.css (--toast-bottom)
export default function Toast() {
  const light = useStore(s => s.S.theme) === 'light'
  const at = { bottom: 'var(--toast-bottom)' }
  return <Toaster theme={light ? 'light' : 'dark'} position="bottom-center" duration={2600} offset={at} mobileOffset={at} />
}
