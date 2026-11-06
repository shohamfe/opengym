// Progress photos live in this browser's IndexedDB only: never in the synced state, never on
// the server. Each row: { id, d (ISO date), blob }. photoList hands back object URLs.
const DB = 'gym_photos', STORE = 'photos'

function open() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1)
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true })
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error)
  })
}
async function tx(mode, fn) {
  const db = await open()
  return new Promise((res, rej) => {
    const x = db.transaction(STORE, mode), out = fn(x.objectStore(STORE))
    x.oncomplete = () => res(out.result)
    x.onerror = () => rej(x.error)
  })
}
export async function photoList() {
  const rows = await tx('readonly', s => s.getAll())
  return rows.sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : a.id - b.id)).map(p => ({ id: p.id, d: p.d, url: URL.createObjectURL(p.blob) }))
}
export const photoAdd = (d, blob) => tx('readwrite', s => s.add({ d, blob }))
export const photoDel = id => tx('readwrite', s => s.delete(id))

// Phone photos are 3-12 MB; 1200 px JPEG is plenty to compare and keeps storage small.
export async function shrinkImage(file, max = 1200) {
  const bmp = await createImageBitmap(file)
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height))
  const c = document.createElement('canvas')
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k)
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height)
  return new Promise(res => c.toBlob(res, 'image/jpeg', 0.85))
}
