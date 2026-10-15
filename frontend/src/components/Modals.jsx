import { useEffect, useRef } from 'react'
import { useUI } from '../store/useUI.js'

// One bottom sheet (or centered dialog) with swipe-to-dismiss.
function Sheet({ sheet }) {
  const { closeSheet } = useUI.getState()
  const ref = useRef(null)
  const drag = useRef({ startY: null, delta: 0 })

  const onTouchStart = e => {
    const el = ref.current
    // a gesture that begins on a slider (or opted-out control) belongs to that control,
    // not to the sheet's swipe-to-dismiss — so it keeps working while you drag
    if (e.target.closest && e.target.closest('input[type=range], [data-nodrag]')) {
      drag.current = { startY: null, delta: 0 }
      return
    }
    drag.current = { startY: el.scrollTop <= 0 ? e.touches[0].clientY : null, delta: 0 }
  }
  const onTouchMove = e => {
    const el = ref.current, d = drag.current
    if (d.startY === null) return
    d.delta = e.touches[0].clientY - d.startY
    if (d.delta > 0 && el.scrollTop <= 0) {
      e.preventDefault()
      el.style.transition = 'none'
      el.style.transform = `translateY(${d.delta}px)`
    } else d.delta = 0
  }
  const onTouchEnd = () => {
    const el = ref.current, d = drag.current
    if (d.startY === null) return
    el.style.transition = 'transform .2s'
    if (d.delta > 90) { el.style.transform = 'translateY(110%)'; setTimeout(dismiss, 180) }
    else el.style.transform = ''
    d.startY = null
  }

  // non-passive touchmove so preventDefault works (bottom sheets only; centered dialogs have no ref)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    return () => el.removeEventListener('touchmove', onTouchMove)
  }, [])

  const close = () => closeSheet(sheet.id)
  const dismiss = () => { close(); sheet.onDismiss && sheet.onDismiss() }
  if (sheet.kind === 'center') {
    return (
      <div>
        <div className="mback" onClick={dismiss} />
        <div className="center">{sheet.render(close)}</div>
      </div>
    )
  }
  return (
    <div>
      <div className="mback" onClick={dismiss} />
      <div className="sheet" ref={ref} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        <div className="grab" />
        {sheet.render(close)}
      </div>
    </div>
  )
}

export default function Modals() {
  const sheets = useUI(s => s.sheets)

  // lock the page behind any open sheet. Not by pinning <body> with position:fixed: in the
  // iOS Home Screen app that shrank the viewport and left a strip under every sheet.
  useEffect(() => {
    if (!sheets.length) return
    const h = document.documentElement.style
    h.overflow = 'hidden'
    return () => { h.overflow = '' }
  }, [sheets.length > 0])

  if (!sheets.length) return null
  return (
    <div id="modal-root" className="open">
      {sheets.map(s => <Sheet key={s.id} sheet={s} />)}
    </div>
  )
}
