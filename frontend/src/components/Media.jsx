import { useState } from 'react'
import { imgSrc, gifSrc, mediaOf } from '../lib/exercises.js'
import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import Icon from './Icon.jsx'

// Big autoplaying animation; tap toggles to the still frame. `compact` shrinks it (superset cards).
// Custom exercises have no media — the animation stays blank by design (issue #11).
// `minimizable` (workout view) adds a persistent minimize/expand control so the animation stops
// eating the screen; the chosen size is saved to settings and carries across exercises and
// future workouts (issue #12).
export default function Media({ ex: base, id, compact, minimizable }) {
  const ex = mediaOf(base, useStore(s => s.S))
  const [playing, setPlaying] = useState(true)
  // big by default (it's how you check form); Minimize shrinks it to a thumbnail beside the name
  const media = useStore(s => s.S.mediaSize) || 'full'
  const update = useStore(s => s.update)
  if (!ex.gif) return null
  const mini = minimizable && media === 'thumb'
  const toggleSize = e => { e.stopPropagation(); update(s => { s.mediaSize = mini ? 'full' : 'thumb' }) }
  return (
    <div className={'exmedia' + (compact ? ' compact' : '') + (mini ? ' mini' : '')} id={id} onClick={mini ? toggleSize : () => setPlaying(p => !p)}
      role={mini ? 'button' : undefined} aria-label={mini ? t('Expand') : undefined}>
      <img decoding="async" src={playing ? gifSrc(ex) : imgSrc(ex)} alt={ex.n} />
      {minimizable && !mini && (
        <button className="giftoggle" onClick={toggleSize}>
          <Icon name={mini ? 'expand' : 'minimize'} />{mini ? t('Expand') : t('Minimize')}
        </button>
      )}
      {!mini && (
        <span className="gifhint">
          <Icon name={playing ? 'pause' : 'play'} />{playing ? t('tap to pause') : t('tap to play')}
        </span>
      )}
    </div>
  )
}

export function Thumb({ ex: base }) {
  const ex = mediaOf(base, useStore(s => s.S))
  if (!ex.img) return <div className="thumb thumb-x"><Icon name="dumbbell" /></div>
  return <img className="thumb" loading="lazy" decoding="async" src={imgSrc(ex)} alt="" />
}
