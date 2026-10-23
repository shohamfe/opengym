// The Push/Pull/Legs starter plan. Shared by the "Load starter plan" action in Settings
// and by the demo build, which seeds a history on top of exactly these routines.
import { uid } from './format.js'
import { EXIDX } from './exercises.js'

const SPEC = [
  ['Push Day', 'barbell', [['0025', 4, 8], ['0047', 3, 10], ['0426', 3, 10], ['0334', 3, 12], ['0241', 3, 12], ['0251', 3, 10]]],
  ['Pull Day', 'pullup', [['2330', 4, 10], ['0027', 4, 8], ['1323', 3, 10], ['0031', 3, 10], ['0313', 3, 12]]],
  ['Leg Day', 'legs', [['0043', 4, 8], ['0085', 3, 10], ['0739', 3, 12], ['0585', 3, 12], ['0586', 3, 12], ['0605', 4, 15]]]
]

// Fresh routine objects (new ids) — [push, pull, legs].
export const starterRoutines = () =>
  SPEC.map(([name, emoji, list]) => ({ id: uid(), name, emoji, ex: list.map(([id, sets, reps]) => ({ id, sets, reps, weight: 0 })) }))

// Pregnancy starter (coach-pregnancy.md §4): two full-body days of good picks, light sets.
// 9002+ are the pregnancy built-ins added separately; until an id exists it is left out.
// Assumed ids (coach's "highest value first" order): 9002 bird dog, 9003 Kegel,
// 9006 side-lying clamshell (stands in for side-lying hip abduction), 9008 face pull.
const PREG = [
  ['Full body A', 'legs', ['1760', '0314', '0861', '0196', '0979', '9006', '9003']],
  ['Full body B', 'pullup', ['2368', '0405', '2330', '1459', '9002', '9008', '2133']]
]
export const pregnancyStarterRoutines = () =>
  PREG.map(([name, emoji, ids]) => ({ id: uid(), name, emoji, ex: ids.filter(id => EXIDX[id]).map(id => ({ id, sets: 2, reps: 12, weight: 0 })) }))
