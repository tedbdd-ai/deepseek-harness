/**
 * Atelier client: Seitenleiste, Sammlung, Library, Projekte und Anbieter.
 * Spricht nur mit der Hub-API unter /creativity-hub/api; Routen sind Hash-Routen (#/sammlung, #/projekt/<id> …).
 */
import { canEditImage, cropImage, formatSize, reduceImage } from './media-editor.js'
import { createTags } from './tags.js'

const API = '/creativity-hub/api'
const $ = (selector, root = document) => root.querySelector(selector)
const view = $('#view')
const inspector = $('#inspector')

/** Builds an element: el('div', { class: 'x', onclick }, child, 'text'). */
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag)
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue
    if (key.startsWith('on')) node.addEventListener(key.slice(2), value)
    else if (key === 'html') node.innerHTML = value
    else node.setAttribute(key, value === true ? '' : value)
  }
  for (const child of children.flat()) if (child !== null && child !== undefined && child !== false) node.append(child)
  return node
}
const svg = paths => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true'); s.innerHTML = paths; return s }
const icons = {
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
  expand: '<path d="M8 3H3v5m13-5h5v5m0 8v5h-5M3 16v5h5"/>',
  close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  upload: '<path d="M12 15V3"/><path d="m7 8 5-5 5 5"/><path d="M5 21h14"/>',
  down: '<path d="M12 15V3"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>',
  open: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  cut: '<circle cx="6" cy="6" r="3"/><path d="M8.12 8.12 12 12"/><path d="M20 4 8.12 15.88"/><circle cx="6" cy="18" r="3"/><path d="M14.8 14.8 20 20"/>',
  inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  film: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16m10-16v16M3 9h4m10 0h4M3 15h4m10 0h4"/>',
  play: '<path d="m8 5 12 7-12 7z"/>',
  pause: '<path d="M9 5v14m6-14v14"/>',
  volume: '<path d="M4 9h4l5-4v14l-5-4H4zM17 9c2 2 2 4 0 6m3-8c3 3 3 7 0 10"/>',
  muted: '<path d="M4 9h4l5-4v14l-5-4H4zm13 1 5 5m0-5-5 5"/>',
  wave: '<path d="M3 10v4m4-7v10m5-14v18m5-15v12m4-8v4"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
  wand: '<path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72"/><path d="m14 7 3 3"/>',
  chev: '<path d="m7 15 5 5 5-5"/><path d="m7 9 5-5 5 5"/>',
  'chev-down': '<path d="m6 9 6 6 6-6"/>',
  star: '<path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z"/>',
  ban: '<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  tag: '<path d="M12.59 2.59A2 2 0 0 0 11.17 2H4a2 2 0 0 0-2 2v7.17a2 2 0 0 0 .59 1.42l8.7 8.7a2.43 2.43 0 0 0 3.42 0l6.58-6.58a2.43 2.43 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r="1"/>',
  layers: '<path d="m12 2 10 5-10 5L2 7z"/><path d="m2 12 10 5 10-5"/><path d="m2 17 10 5 10-5"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  sort: '<path d="M3 6h13"/><path d="M3 12h9"/><path d="M3 18h5"/><path d="m17 14 4 4 4-4" transform="translate(-4 -2)"/>',
}
const icon = name => svg(icons[name])

async function api(path, method = 'GET', body) {
  const response = await fetch(API + path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined })
  const text = await response.text()
  const data = text ? JSON.parse(text) : null
  if (!response.ok) throw new Error((data && (data.error || data.message)) || `Der Hub antwortet mit ${response.status}.`)
  return data
}

let toastTimer
function toast(message, error = false) {
  const box = $('#toast')
  box.textContent = message
  box.className = 'toast' + (error ? ' err' : '')
  box.hidden = false
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { box.hidden = true }, error ? 6000 : 3000)
}

/* Daten */
const palette = ['#FF6B57', '#BF5AF2', '#0A84FF', '#30D158', '#FF9F0A', '#64D2FF', '#FF375F']
const colorOf = id => palette[[...id].reduce((sum, c) => sum + c.charCodeAt(0), 0) % palette.length]
const state = { projects: [], snapshots: [], members: new Map(), selected: null, filter: 'alle', query: '' }
/** `replaceChildren` that skips empty slots (it would print `null`). */
const put = (node, ...kids) => node.replaceChildren(...kids.flat().filter(kid => kid !== null && kid !== undefined && kid !== false))
const openItem = item => item.library === 'generation' ? openGeneration(item) : openClip(item)
const tags = createTags({ el, icon, api, toast, state, confirmDialog, get mediaUrl() { return mediaUrl }, get media() { return media }, emptyState, errorState, header, loading, get view() { return view }, openItem })

async function renderSaved() {
  const items = await api('/saved-searches').catch(() => [])
  state.saved = items
  $('#saved-title').hidden = !items.length
  $('#saved').replaceChildren(...items.map(item => el('div', { class: 'saved-row' },
    el('a', { class: 'navi' + (location.hash === item.href ? ' on' : ''), href: item.href, title: item.name }, svg(icons.search), el('span', { class: 't' }, item.name)),
    el('button', { type: 'button', class: 'icon rm', 'aria-label': `Suche „${item.name}“ löschen`, onclick: async () => {
      try { await api('/saved-searches', 'PUT', { items: state.saved.filter(entry => entry.id !== item.id) }); await renderSaved() } catch (error) { toast(error.message, true) }
    } }, icon('close')))))
}

/** Asks for a name and stores the current search (text and filters) as a smart collection. */
function saveSearchDialog(filterState, routeName) {
  const params = tags.searchParams(filterState)
  const name = el('input', { class: 'text-in', required: true, maxlength: 60, placeholder: 'z. B. Latex bei Nacht', autocomplete: 'off' })
  const dialog = el('dialog', {}, el('form', { method: 'dialog' }, el('h2', {}, 'Suche speichern'),
    el('p', { class: 'meta' }, 'Sie erscheint links unter „Sammlungen“ und zeigt immer den aktuellen Stand.'),
    el('label', { class: 'field' }, el('span', {}, 'Name'), name),
    el('div', { class: 'row' }, el('button', { type: 'button', class: 'btn ghost', onclick: () => dialog.close('no') }, 'Abbrechen'), el('button', { class: 'btn primary', value: 'yes' }, 'Speichern'))))
  dialog.addEventListener('close', async () => {
    if (dialog.returnValue === 'yes' && name.value.trim()) {
      try {
        const item = { id: crypto.randomUUID(), name: name.value.trim(), href: '#/' + routeName + (params.toString() ? '?' + params : '') }
        await api('/saved-searches', 'PUT', { items: [...(state.saved ?? []), item] }); await renderSaved(); toast('Gespeichert unter „Sammlungen“.')
      } catch (error) { toast(error.message, true) }
    }
    dialog.remove()
  })
  document.body.append(dialog)
  dialog.showModal()
  name.focus()
}

async function loadProjects() {
  state.projects = await api('/projects')
  state.members = new Map()
  const lists = await Promise.all(state.projects.map(p => api('/assets?project=' + p.id).then(items => [p.id, items])))
  for (const [projectId, items] of lists) for (const item of items) {
    if (!state.members.has(item.id)) state.members.set(item.id, new Set())
    state.members.get(item.id).add(projectId)
  }
  renderProjects()
}

function renderProjects() {
  const active = location.hash.match(/^#\/projekt\/([\w-]+)/)?.[1]
  $('#projects').replaceChildren(...state.projects.map(p => el('a', {
    class: 'navi' + (p.id === active ? ' on' : ''), href: '#/projekt/' + p.id, title: p.title, 'aria-current': p.id === active ? 'page' : null,
  }, el('span', { class: 'pd', style: `background:${colorOf(p.id)}` }), el('span', { class: 't' }, p.title))))
}

async function refreshCounts() {
  const clips = await api('/assets?library=clips')
  $('#count-clips').textContent = clips.length || ''
}

const editedMedia = new Map()
const mediaUrl = item => item.media_type
  ? `${API}/media/${item.id}?v=${editedMedia.get(item.id) ?? item.size ?? 0}`
  : (item.preview || '')
const kindOf = item => item.media_type?.startsWith('video/') ? 'videos' : item.media_type?.startsWith('image/') || item.preview ? 'bilder' : item.source ? 'webseiten' : 'notizen'
const kindLabel = { bilder: 'Bild', videos: 'Video', webseiten: 'Webseite', notizen: 'Notiz' }
const domainOf = url => { try { return new URL(url).hostname.replace(/^www\./, '') } catch { return '' } }
const sourceDot = domain => /instagram/.test(domain) ? '#E1306C' : /pinterest/.test(domain) ? '#E60023' : /youtube/.test(domain) ? '#FF3B30' : /(^|\.)x\.com|twitter/.test(domain) ? '#F2F2F0' : '#0A84FF'
const dateLabel = iso => {
  const d = new Date(iso), today = new Date(); today.setHours(0, 0, 0, 0)
  const diff = Math.round((today - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 864e5)
  return diff === 0 ? 'Heute' : diff === 1 ? 'Gestern' : d.toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: today.getFullYear() === d.getFullYear() ? undefined : 'numeric' })
}
const timeLabel = iso => new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
/** Reads the lines the hub writes into a generation's description. */
function parseGeneration(item) {
  const get = key => (item.description || '').split('\n').find(line => line.startsWith(key + ': '))?.slice(key.length + 2) ?? ''
  const [model, provider] = get('Modell').split(' über ')
  return { prompt: get('Prompt') || item.title, model: model || 'Unbekanntes Modell', provider: provider || '', refs: get('Referenzen') }
}

/* Gemeinsame Bausteine */
function media(item, { full = false } = {}) {
  const url = mediaUrl(item)
  if (item.media_type?.startsWith('audio/')) {
    return full ? el('audio', { src: url, controls: true, preload: 'metadata', 'aria-label': item.title })
      : el('div', { class: 'link-card' }, el('span', { class: 'meta' }, 'Audio'), el('b', {}, item.title))
  }
  if (item.media_type?.startsWith('video/')) return el('video', { src: url, muted: true, loop: true, playsinline: true, preload: 'metadata', controls: full || null, onmouseenter: e => e.target.play(), onmouseleave: e => e.target.pause() })
  if (item.media_type === 'model/gltf-binary') return el('div', { class: 'link-card' }, el('span', { class: 'meta' }, 'GLB · 3D-Modell'), el('b', {}, item.title))
  if (url) return el('img', { src: url, alt: item.title, loading: 'lazy', decoding: 'async' })
  if (item.source) return el('div', { class: 'link-card' }, el('span', { class: 'meta' }, domainOf(item.source)), el('b', {}, item.title))
  return el('div', { class: 'note-card' }, item.description || item.title)
}

function openImage(url, title) {
  const dialog = el('dialog', { class: 'image-viewer', 'aria-label': title },
    el('button', { type: 'button', class: 'icon image-viewer-close', 'aria-label': 'Vollbild schließen', title: 'Schließen (Esc)', autofocus: true, onclick: () => dialog.close() }, icon('close')),
    el('img', { src: url, alt: title }))
  dialog.addEventListener('click', e => { if (e.target === dialog) dialog.close() })
  dialog.addEventListener('close', () => dialog.remove(), { once: true })
  document.body.append(dialog)
  dialog.showModal()
}

function fullscreenButton(url, title) {
  return el('button', { type: 'button', class: 'icon image-expand', 'aria-label': `${title} im Vollbild öffnen`, title: 'Vollbild', onclick: () => openImage(url, title) }, icon('expand'))
}

function withFullscreen(item, content) {
  const url = mediaUrl(item)
  if (!url || (item.media_type && !item.media_type.startsWith('image/'))) return content
  // The expand button sits on the image and appears on hover or focus; a double-click opens it too.
  return el('div', { class: 'image-frame', ondblclick: e => { e.preventDefault(); openImage(url, item.title) } }, content, fullscreenButton(url, item.title))
}

/* Mehrfachauswahl: im Auswahlmodus (oder mit ⌘ bzw. Shift) wählt ein Klick aus, statt zu öffnen. */
const picking = { on: false, ids: new Set(), visible: [] }

function setPicking(on) {
  picking.on = on
  if (!on) picking.ids.clear()
  document.body.classList.toggle('picking', on)
  document.querySelectorAll('.image-frame[data-asset]').forEach(f => f.classList.toggle('picked', picking.ids.has(f.dataset.asset)))
  drawPickBar()
}

function togglePick(id) {
  if (!picking.on) setPicking(true)
  picking.ids.has(id) ? picking.ids.delete(id) : picking.ids.add(id)
  document.querySelectorAll(`.image-frame[data-asset="${id}"]`).forEach(f => f.classList.toggle('picked', picking.ids.has(id)))
  drawPickBar()
}

/** The selection controls for an overview; `items` are the tiles currently shown. */
function pickControls(items) {
  picking.visible = items
  const box = el('span', { class: 'pick-bar', style: 'display:contents' })
  drawPickBar(box)
  return box
}

function drawPickBar(box = document.querySelector('.pick-bar')) {
  if (!box) return
  const n = picking.ids.size
  box.replaceChildren(...(picking.on ? [
    el('span', { class: 'meta', 'aria-live': 'polite' }, n === 1 ? '1 ausgewählt' : `${n} ausgewählt`),
    el('button', { type: 'button', class: 'btn sm ghost', onclick: () => { const all = picking.visible.every(i => picking.ids.has(i.id)); picking.visible.forEach(i => all ? picking.ids.delete(i.id) : picking.ids.add(i.id)); setPicking(true) } }, picking.visible.length && picking.visible.every(i => picking.ids.has(i.id)) ? 'Keine' : 'Alle'),
    ['sammlung', 'library'].includes(currentRoute()) && el('button', { type: 'button', class: 'btn sm', disabled: !n || null,
      onclick: () => tags.bulkDialog([...picking.ids], route) }, icon('tag'), 'Tags'),
    ['sammlung', 'library'].includes(currentRoute()) && el('button', { type: 'button', class: 'btn sm', disabled: !n || null, 'aria-label': 'Als Favorit markieren', onclick: () => rateSelection(1) }, icon('star'), 'Favorit'),
    ['sammlung', 'library'].includes(currentRoute()) && el('button', { type: 'button', class: 'btn sm', disabled: !n || null, onclick: () => rateSelection(-1) }, icon('ban'), 'Aussortieren'),
    el('button', { type: 'button', class: 'btn sm danger', disabled: !n || null, onclick: removePicked }, icon('trash'), 'Löschen'),
    el('button', { type: 'button', class: 'btn sm', onclick: () => setPicking(false) }, 'Fertig'),
  ] : [el('button', { type: 'button', class: 'btn sm', onclick: () => setPicking(true), title: 'Mehrere auswählen (auch mit ⌘ oder Shift und Klick)' }, icon('check'), 'Auswählen')]))
}

async function rateSelection(rating) {
  const ids = [...picking.ids]
  try {
    await api('/assets/rating', 'POST', { ids, rating })
    toast(rating === 1 ? 'Als Favorit markiert.' : 'Aussortiert. Du findest die Einträge unter „Aussortierte“.')
    setPicking(false); route()
  } catch (error) { toast(error.message, true) }
}

async function removePicked() {
  const ids = [...picking.ids]
  if (!ids.length) return
  if (!await confirmDialog(`${ids.length} ${ids.length === 1 ? 'Element' : 'Elemente'} löschen?`, 'Sie werden aus dem Atelier gelöscht, auch aus allen Projekten. Das lässt sich nicht rückgängig machen.', 'Löschen')) return
  let done = 0
  for (const id of ids) { try { await api('/assets/' + id, 'DELETE'); done++ } catch (error) { toast(error.message, true) } }
  toast(done === 1 ? '1 Element gelöscht.' : `${done} Elemente gelöscht.`)
  setPicking(false); closeInspector(); refreshCounts(); route()
}

function tile(item, onOpen, { caption = true, onDelete = () => removeAsset(item, route) } = {}) {
  const kind = kindOf(item)
  const domain = domainOf(item.source)
  // Delete straight from the grid: the button appears on the image on hover or focus.
  const remove = el('button', { type: 'button', class: 'icon tile-delete', 'aria-label': `„${item.title}“ löschen`, title: 'Löschen', onclick: e => { e.stopPropagation(); onDelete() } }, icon('trash'))
  const framed = withFullscreen(item, el('button', { type: 'button', class: 'tile' + (state.selected === item.id ? ' sel' : ''), 'data-id': item.id, 'aria-label': item.title, onclick: e => { if (picking.on || e.metaKey || e.ctrlKey || e.shiftKey) { e.preventDefault(); togglePick(item.id) } else onOpen(item) } },
    el('span', { class: 'pic' }, media(item), (kind === 'videos' || kind === 'webseiten') && mediaUrl(item) ? el('span', { class: 'kind' }, kindLabel[kind]) : null,
      item.rating === 1 ? el('span', { class: 'badge', title: 'Favorit' }, icon('star')) : null,
      item.stackCount > 1 ? el('span', { class: 'badge stack', title: `Stapel mit ${item.stackCount} Bildern` }, icon('layers'), item.stackCount) : null),
    caption ? el('span', { class: 'title' }, item.title) : null,
    caption && item.library === 'clips' && item.tags?.length ? el('span', { class: 'tile-tags' },
      item.tags.slice(0, 3).map(tag => el('span', { class: 'tag-label' }, tag))) : null,
    caption && domain ? el('span', { class: 'src' }, el('span', { class: 'dot', style: `background:${sourceDot(domain)}` }), domain) : null))
  const frame = framed.classList?.contains('image-frame') ? framed : el('div', { class: 'image-frame' }, framed)
  frame.dataset.asset = item.id
  frame.classList.toggle('picked', picking.ids.has(item.id))
  frame.append(remove, el('span', { class: 'pick-mark', 'aria-hidden': 'true' }, icon('check')))
  return frame
}

function chev() { const s = svg(icons.chev); s.classList.add('chev'); return s }

function projectChips(item) {
  const box = el('div', { class: 'chips' })
  const draw = () => box.replaceChildren(...state.projects.map(p => {
    const on = state.members.get(item.id)?.has(p.id) ?? false
    return el('button', { type: 'button', class: 'chip', 'aria-pressed': String(on), onclick: async () => {
      try {
        await api(on ? '/unassign' : '/assign', 'POST', { id: item.id, projectId: p.id })
        if (!state.members.has(item.id)) state.members.set(item.id, new Set())
        state.members.get(item.id)[on ? 'delete' : 'add'](p.id)
        draw()
      } catch (error) { toast(error.message, true) }
    } }, el('span', { class: 'dot', style: `background:${colorOf(p.id)}` }), p.title, on ? icon('check') : null)
  }))
  draw()
  return box
}

function confirmDialog(title, text, actionLabel) {
  return new Promise(resolve => {
    const dialog = el('dialog', {}, el('form', { method: 'dialog' },
      el('h2', {}, title), el('p', { style: 'margin:0;color:var(--c-ink-2)' }, text),
      el('div', { class: 'row' }, el('button', { class: 'btn ghost', value: 'no' }, 'Abbrechen'), el('button', { class: 'btn danger', value: 'yes' }, actionLabel))))
    dialog.addEventListener('close', () => { resolve(dialog.returnValue === 'yes'); dialog.remove() })
    document.body.append(dialog)
    dialog.showModal()
  })
}

function closeInspector() {
  state.selected = null
  inspector.hidden = true
  inspector.replaceChildren()
  document.querySelectorAll('.tile.sel').forEach(t => t.classList.remove('sel'))
}

function openInspector(item, body) {
  state.selected = item.id
  document.querySelectorAll('.tile').forEach(t => t.classList.toggle('sel', t.dataset.id === item.id))
  inspector.replaceChildren(el('div', { style: 'position:relative;display:flex;flex-direction:column;gap:16px;flex:1' },
    el('button', { type: 'button', class: 'icon x', 'aria-label': 'Details schließen', onclick: closeInspector }, icon('close')), ...body))
  inspector.hidden = false
}

async function removeAsset(item, after) {
  if (!await confirmDialog('Löschen?', `„${item.title}“ wird aus dem Atelier gelöscht. Das lässt sich nicht rückgängig machen.`, 'Löschen')) return
  try {
    await api('/assets/' + item.id, 'DELETE')
    closeInspector(); toast('Gelöscht.'); refreshCounts(); after()
  } catch (error) { toast(error.message, true) }
}

function loading(columns = 4) {
  return el('div', { class: 'masonry', 'aria-busy': 'true', 'aria-label': 'Lädt' }, Array.from({ length: columns * 2 }, (_, i) => el('div', { class: 'skel', style: `height:${[220, 160, 280, 190][i % 4]}px` })))
}

function emptyState(iconName, title, text, action) {
  return el('div', { class: 'state' }, icon(iconName), el('h2', {}, title), el('p', {}, text), action)
}

function errorState(error, retry) {
  return el('div', { class: 'state' }, el('h2', {}, 'Das hat nicht geklappt'), el('p', {}, error.message), el('button', { class: 'btn', onclick: retry }, 'Erneut versuchen'))
}

function header(title, sub, ...tools) {
  return [el('header', { class: 'head' }, el('h1', {}, title), ...tools.filter(t => !t?.classList?.contains('tools')), tools.find(t => t?.classList?.contains('tools'))), sub ? el('div', { class: 'sub' }, sub) : null].filter(Boolean)
}

/* Sammlung */
const filters = [['alle', 'Alle'], ['bilder', 'Bilder'], ['videos', 'Videos'], ['webseiten', 'Webseiten'], ['notizen', 'Notizen']]

/** Row of rating buttons (favourite / discard) for the inspector. */
function ratingButtons(item) {
  const set = async rating => {
    try { await api('/assets/rating', 'POST', { ids: [item.id], rating }); item.rating = rating; toast(rating === 1 ? 'Als Favorit markiert.' : rating === -1 ? 'Aussortiert.' : 'Bewertung entfernt.'); draw() } catch (error) { toast(error.message, true) }
  }
  const box = el('div', { class: 'row rating' })
  const draw = () => box.replaceChildren(
    el('button', { type: 'button', class: 'btn sm', 'aria-pressed': String(item.rating === 1), onclick: () => set(item.rating === 1 ? 0 : 1) }, icon('star'), 'Favorit'),
    el('button', { type: 'button', class: 'btn sm', 'aria-pressed': String(item.rating === -1), onclick: () => set(item.rating === -1 ? 0 : -1) }, icon('ban'), item.rating === -1 ? 'Wieder einblenden' : 'Aussortieren'))
  draw()
  return box
}

/** Loads a search result page by page into `target`; shared by Sammlung and Library. */
function searchList({ filters, library, bar, extra = () => ({}), onData, onError }) {
  const run = { items: [], result: null, offset: 0, token: 0 }
  async function load({ reset = true, silent = false } = {}) {
    const token = ++run.token
    if (reset) run.offset = 0
    try {
      const result = await api('/search?' + tags.searchParams(filters, { library, limit: 200, cursor: reset ? '' : run.offset, ...extra() }))
      if (token !== run.token) return
      run.result = result
      run.items = reset ? result.items : [...run.items, ...result.items]
      bar.update(result)
      onData(run, { silent })
    } catch (error) { if (token === run.token) onError(error) }
  }
  run.load = load
  run.more = () => { run.offset = run.result?.nextOffset ?? 0; return load({ reset: false }) }
  return run
}

function moreButton(run) {
  return run.result?.nextOffset ? el('div', { class: 'more' }, el('button', { type: 'button', class: 'btn', onclick: () => run.more() }, `Mehr laden (${run.result.total - run.items.length} weitere)`)) : null
}

async function renderSammlung() {
  await tags.loadVocabulary().catch(() => { /* Ohne Vokabular bleiben die Filter leer; die Suche selbst zeigt Fehler. */ })
  const filtersState = tags.readFilters()
  const picker = pickControls([])
  const tools = el('div', { class: 'tools' }, picker, uploadButton(),
    el('button', { type: 'button', class: 'btn sm', onclick: addLinkDialog }, icon('link'), 'Link einfügen'))
  const body = el('div', { class: 'scroll' }, loading())
  const gallery = el('div', {})
  const bar = tags.filterBar({ filters: filtersState, onChange: () => list.load(), onSave: () => saveSearchDialog(filtersState, 'sammlung') })
  const seg = el('div', { class: 'seg', role: 'group', 'aria-label': 'Art' })
  const drawTypes = () => seg.replaceChildren(...filters.map(([key, label]) => el('button', {
    type: 'button', 'aria-pressed': String(state.filter === key),
    onclick: () => { state.filter = key; drawTypes(); draw() },
  }, label)))
  drawTypes()
  view.replaceChildren(...header('Sammlung', 'Bilder aus der Zwischenablage mit ⌘V (Mac) oder Strg+V einfügen.', seg, tools), bar.el, body)
  let signature = ''
  let pollTimer
  const list = searchList({ filters: filtersState, library: 'clips', bar, extra: () => ({ limit: 500 }),
    onData: (run, { silent }) => {
      const next = run.items.map(item => item.id + item.tags.join()).join('|')
      if (!silent || next !== signature) { signature = next; body.replaceChildren(gallery); draw() }
      clearTimeout(pollTimer)
      if (run.items.some(item => !item.tag_source) && body.isConnected) pollTimer = setTimeout(() => list.load({ silent: true }), 2000)
    },
    onError: error => body.replaceChildren(errorState(error, () => list.load())) })
  function draw() {
    const items = list.items.filter(item => state.filter === 'alle' || kindOf(item) === state.filter)
    picking.visible = items
    drawPickBar()
    const pending = list.items.some(item => !item.tag_source)
    if (items.length) {
      put(gallery, pending ? el('p', { class: 'meta notice', role: 'status' }, 'Die Analyse läuft noch. Tags erscheinen als Vorschläge.') : null,
        el('div', { class: 'masonry' }, items.map(item => tile(item, openClip))), moreButton(list))
      setPicking(picking.on)
    } else if (tags.isActive(filtersState) || state.query) {
      gallery.replaceChildren(emptyState('inbox', 'Keine Treffer', state.query ? `Zu „${state.query}“ passt in der Sammlung nichts.` : 'Für diese Filter gibt es keine Einträge.',
        el('button', { class: 'btn', onclick: () => { filtersState.tags.clear(); filtersState.colors = []; filtersState.rating = ''; filtersState.untagged = false; filtersState.suggestions = false; tags.writeFilters(filtersState); if (state.query) clearSearch(); else list.load() } }, 'Filter zurücksetzen')))
    } else if (list.items.length) {
      gallery.replaceChildren(emptyState('inbox', 'Keine Treffer', 'In der Sammlung gibt es davon gerade nichts.',
        el('button', { class: 'btn', onclick: () => { state.filter = 'alle'; drawTypes(); draw() } }, 'Alle zeigen')))
    } else {
      gallery.replaceChildren(emptyState('inbox', 'Noch nichts gesammelt', 'Füge ein Bild ein, ziehe eine Datei hinein oder sichere einen Link.',
        el('button', { class: 'btn primary', onclick: addLinkDialog }, 'Link einfügen')))
    }
  }
  await list.load()
}

function inspectMedia(item) {
  const preview = media(item, { full: true })
  const hero = withFullscreen(item, el('div', { class: 'hero' }, preview))
  if (!item.media_type || item.size == null) return [hero]
  const dimensions = el('span', {})
  const showDimensions = () => {
    const width = preview.naturalWidth || preview.videoWidth
    const height = preview.naturalHeight || preview.videoHeight
    dimensions.textContent = width && height ? ' · ' + width + ' × ' + height + ' px' : ''
  }
  preview.addEventListener('load', showDimensions, { once: true })
  preview.addEventListener('loadedmetadata', showDimensions, { once: true })
  showDimensions()

  const image = canEditImage(item)
  const video = item.media_type.startsWith('video/')
  const destination = '/assets/' + item.id
  const save = body => api(destination + '/image-edit', 'POST', body)
  const actions = el('div', { class: 'media-edit-actions' })
  const status = el('span', { class: 'meta', role: 'status' })

  async function edit(work, waiting) {
    const locationBefore = location.hash
    for (const child of actions.children) child.disabled = true
    status.textContent = waiting
    try {
      const updated = await work()
      if (!updated) return
      editedMedia.set(item.id, (editedMedia.get(item.id) ?? item.size ?? 0) + 1)
      toast('Gespeichert · ' + formatSize(updated.size))
      if (location.hash === locationBefore && state.selected === item.id) {
        await route()
        if (location.hash === locationBefore && !state.selected) (updated.library === 'generation' ? openGeneration : openClip)(updated)
      }
    } catch (error) { toast(error.message, true) }
    finally {
      status.textContent = ''
      for (const child of actions.children) child.disabled = false
    }
  }
  if (image || video) actions.append(el('button', { type: 'button', class: 'btn sm', onclick: async () => {
    const effect = image ? 'Das ganze Bild bleibt erhalten. Atelier speichert die kleinere Version als WebP.' :
      'Atelier komprimiert das Video samt Ton. Auflösung und Bildqualität können sich dabei verringern.'
    if (!await confirmDialog('Datei verkleinern?', effect + ' Die kleinere Datei ersetzt die bisherige Version.', 'Verkleinern')) return
    await edit(() => image ? reduceImage(mediaUrl(item), save) : api(destination + '/compress-video', 'POST', { size: item.size }), 'Verkleinert …')
  } }, 'Verkleinern'))
  if (image) actions.append(el('button', { type: 'button', class: 'btn sm', onclick: () =>
    edit(() => cropImage(mediaUrl(item), item.title, { el, save }), 'Lädt Bild …') }, icon('cut'), 'Zuschneiden'))
  return [hero, el('section', { class: 'field' }, el('span', {}, 'Dateigröße'),
    el('div', { class: 'meta' }, formatSize(item.size), dimensions), actions.children.length ? actions : null, status)]
}

function openClip(item) {
  const domain = domainOf(item.source)
  openInspector(item, [
    ...inspectMedia(item),
    el('div', {}, el('h2', {}, item.title), el('div', { class: 'meta', style: 'margin-top:4px' }, [domain, dateLabel(item.created_at) + ', ' + timeLabel(item.created_at)].filter(Boolean).join(' · '))),
    item.description && item.description !== item.title ? el('div', { class: 'field' }, el('span', {}, 'Notiz'), el('div', { class: 'prompt' }, item.description)) : null,
    tags.tagEditor(item),
    ratingButtons(item),
    el('div', { class: 'field' }, el('span', {}, 'Projekte'), state.projects.length ? projectChips(item) : el('span', { class: 'meta' }, 'Lege links ein Projekt an, um Dinge zuzuordnen.')),
    el('div', { class: 'actions' },
      item.media_type?.startsWith('image/') || item.preview ? el('a', { class: 'btn primary', href: '#/playground?ref=' + item.id }, 'Als Referenz im Playground') : null,
      item.source ? el('a', { class: 'btn', href: item.source, target: '_blank', rel: 'noopener noreferrer' }, icon('open'), 'Original öffnen') : null,
      el('div', { class: 'row' },
        item.media_type ? el('a', { class: 'btn', href: mediaUrl(item), download: item.title }, icon('down'), 'Herunterladen') : null,
        el('button', { type: 'button', class: 'btn danger', onclick: () => removeAsset(item, route) }, icon('trash'), 'Löschen'))),
  ])
}

function addLinkDialog() {
  const url = el('input', { class: 'text-in', type: 'url', required: true, placeholder: 'https://…', autocomplete: 'off' })
  const title = el('input', { class: 'text-in', type: 'text', placeholder: 'Titel (sonst die Adresse)', autocomplete: 'off' })
  const dialog = el('dialog', {}, el('form', { method: 'dialog' },
    el('h2', {}, 'Link sichern'),
    el('label', { class: 'field' }, el('span', {}, 'Adresse'), url),
    el('label', { class: 'field' }, el('span', {}, 'Titel'), title),
    el('div', { class: 'row' }, el('button', { type: 'button', class: 'btn ghost', onclick: () => dialog.close('no') }, 'Abbrechen'), el('button', { class: 'btn primary', value: 'yes' }, 'Sichern'))))
  dialog.addEventListener('close', async () => {
    if (dialog.returnValue === 'yes' && url.value) {
      try {
        await api('/assets', 'POST', { library: 'clips', title: title.value.trim() || domainOf(url.value) || url.value, source: url.value })
        toast('In der Sammlung.'); refreshCounts(); if (currentRoute() === 'sammlung') renderSammlung()
      } catch (error) { toast(error.message, true) }
    }
    dialog.remove()
  })
  document.body.append(dialog)
  dialog.showModal()
}

/* Dateien hineinziehen */
let dragDepth = 0
const dropHint = el('div', { class: 'drop', hidden: true }, el('span', {}, 'Loslassen, um in die Sammlung zu legen'))
document.body.append(dropHint)
const hasFiles = event => [...(event.dataTransfer?.types ?? [])].includes('Files')
addEventListener('dragenter', e => { if (hasFiles(e)) { dragDepth++; dropHint.hidden = false } })
addEventListener('dragleave', e => { if (hasFiles(e) && --dragDepth <= 0) { dragDepth = 0; dropHint.hidden = true } })
addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault() })
addEventListener('drop', async e => {
  if (!hasFiles(e)) return
  dragDepth = 0; dropHint.hidden = true
  if (e.defaultPrevented) return
  e.preventDefault()
  const projectId = location.hash.match(/^#\/projekt\/([\w-]+)/)?.[1]
  if ((await uploadFiles(e.dataTransfer.files, { projectId })).length) route()
})

/* Bilder aus der Zwischenablage */
addEventListener('paste', async event => {
  const { clipboardData, target } = event
  if (!clipboardData || event.defaultPrevented || currentRoute() !== 'sammlung' || document.querySelector('dialog[open]')) return
  if (target instanceof HTMLElement && (target.isContentEditable || target.closest('input, textarea, select'))) return
  const images = [...clipboardData.files].filter(file => file.type.startsWith('image/'))
  if (!images.length) {
    for (const item of clipboardData.items) {
      if (item.kind !== 'file' || !item.type.startsWith('image/')) continue
      const file = item.getAsFile()
      if (file) images.push(file)
    }
  }
  if (!images.length) return
  event.preventDefault()
  const created = await uploadFiles(images, { clipboard: true })
  if (created.length && currentRoute() === 'sammlung') renderSammlung()
})

/**
 * Saves image and video files in the Sammlung (and the project, if given).
 * @param {FileList | File[]} list files from a drop or the file picker.
 * @param {{ projectId?: string, clipboard?: boolean }} options
 * @returns {Promise<object[]>} the created assets.
 */
async function uploadFiles(list, { projectId, clipboard = false } = {}) {
  const files = [...list].filter(f => /^(image|video)\//.test(f.type))
  if (!files.length) { toast('Nur Bilder und Videos lassen sich hochladen.', true); return [] }
  const created = []
  for (const file of files) {
    if (file.size > 12 * 1024 * 1024) { toast(`„${file.name}“ ist größer als 12 MB.`, true); continue }
    const media = await new Promise(resolve => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.readAsDataURL(file) })
    const filename = file.name.replace(/\.[^.]+$/, '')
    const title = clipboard && (!filename || /^image$/i.test(filename))
      ? 'Bild aus Zwischenablage · ' + new Date().toLocaleString('de-DE')
      : filename
    try { created.push({ ...(await api('/assets', 'POST', { library: 'clips', title, media, mediaType: file.type, projectId })), library: 'clips', title, media_type: file.type, created_at: new Date().toISOString() }) } catch (error) { toast(error.message, true) }
  }
  if (created.length) { toast(created.length === 1 ? 'Gesichert.' : `${created.length} Dateien gesichert.`); refreshCounts(); if (projectId) await loadProjects() }
  return created
}

/** A button that opens the file picker and uploads the chosen files. */
function uploadButton({ projectId, onDone, label = 'Hochladen', className = 'btn sm' } = {}) {
  const input = el('input', { type: 'file', accept: 'image/*,video/*', multiple: true, hidden: true, onchange: async () => {
    const created = await uploadFiles(input.files, { projectId })
    input.value = ''
    if (created.length) (onDone ?? route)(created)
  } })
  return el('span', { style: 'display:contents' }, input, el('button', { type: 'button', class: className, onclick: () => input.click() }, icon('upload'), label))
}

function isFashionReference(item) {
  return item.library === 'generation' && item.media_type?.startsWith('image/') &&
    /^Fashion-Referenz(?:$| · )/.test(item.title)
}

/* Library */
async function renderLibrary() {
  await tags.loadVocabulary().catch(() => { /* Siehe Sammlung. */ })
  const filtersState = tags.readFilters()
  const typeSel = el('select', { 'aria-label': 'Inhalt der Library' },
    el('option', { value: '' }, 'Alle Medien'), el('option', { value: 'fashion' }, 'Fashion-Referenzen'))
  const projectSel = el('select', { 'aria-label': 'Projekt' }, el('option', { value: '' }, 'Alle Projekte'), state.projects.map(p => el('option', { value: p.id }, p.title)))
  const tools = el('div', { class: 'tools library-filters' }, pickControls([]), el('label', { class: 'pill' }, typeSel, chev()), el('label', { class: 'pill' }, projectSel, chev()))
  const body = el('div', { class: 'scroll' }, loading(5))
  const bar = tags.filterBar({ filters: filtersState, onChange: () => list.load(), onSave: () => saveSearchDialog(filtersState, 'library') })
  view.replaceChildren(...header('Library', 'Alles, was du generiert hast. Ergebnisse eines Laufs liegen als Stapel zusammen.', tools), bar.el, body)
  const list = searchList({ filters: filtersState, library: 'generation', bar, extra: () => ({ project: projectSel.value, stack: filtersState.run ? '' : '1' }),
    onData: () => draw(), onError: error => body.replaceChildren(errorState(error, () => list.load())) })
  const open = item => {
    if (item.stackCount > 1 && !filtersState.run) { filtersState.run = item.run_id; tags.writeFilters(filtersState); list.load() } else openGeneration(item)
  }
  function draw() {
    const items = list.items.filter(item => !typeSel.value || isFashionReference(item))
    picking.visible = items; drawPickBar()
    if (!list.items.length) {
      const filtered = tags.isActive(filtersState) || state.query || projectSel.value
      return body.replaceChildren(emptyState('image', filtered ? 'Keine Treffer' : 'Noch nichts generiert', state.query ? `Zu „${state.query}“ gibt es in der Library nichts.` : filtered ? 'Für diese Auswahl gibt es keine Bilder.' : 'Alles, was du im Playground erzeugst, landet hier.',
        filtered ? el('button', { class: 'btn', onclick: () => { filtersState.tags.clear(); filtersState.colors = []; filtersState.rating = ''; filtersState.untagged = false; filtersState.suggestions = false; filtersState.run = ''; tags.writeFilters(filtersState); projectSel.value = ''; if (state.query) clearSearch(); else list.load() } }, 'Filter zurücksetzen')
          : state.pages?.some(page => page.id === 'playground') ? el('a', { class: 'btn primary', href: '#/playground' }, 'Zum Playground') : null))
    }
    if (!items.length) return body.replaceChildren(emptyState('image', 'Keine Treffer', 'Für diese Auswahl gibt es keine Bilder.', el('button', { class: 'btn', onclick: () => { typeSel.value = ''; draw() } }, 'Filter zurücksetzen')))
    const groups = new Map()
    for (const item of items) { const key = dateLabel(item.created_at); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(item) }
    put(body, [...groups].flatMap(([day, group]) => [el('div', { class: 'day' }, day), el('div', { class: 'grid' }, group.map(item => tile(item, open, { caption: isFashionReference(item) })))]), moreButton(list))
    setPicking(picking.on)
  }
  typeSel.onchange = draw
  projectSel.onchange = () => list.load()
  await list.load()
}

function openGeneration(item) {
  const gen = parseGeneration(item)
  const fashion = isFashionReference(item)
  openInspector(item, [
    ...inspectMedia(item),
    el('div', {}, el('h2', {}, fashion ? item.title : gen.model), el('div', { class: 'meta', style: 'margin-top:4px' }, [fashion && gen.model, gen.provider, dateLabel(item.created_at) + ', ' + timeLabel(item.created_at)].filter(Boolean).join(' · '))),
    el('div', { class: 'field' }, el('span', {}, 'Prompt'), el('div', { class: 'prompt' }, gen.prompt)),
    gen.refs ? el('div', { class: 'field' }, el('span', {}, 'Referenzen'), el('div', { class: 'prompt' }, gen.refs)) : null,
    tags.tagEditor(item),
    ratingButtons(item),
    el('div', { class: 'field' }, el('span', {}, 'Projekte'), state.projects.length ? projectChips(item) : el('span', { class: 'meta' }, 'Noch keine Projekte.')),
    el('div', { class: 'actions' },
      fashion && state.pages?.some(page => page.id === 'styler') && el('a', { class: 'btn primary', href: '#/styler?ref=' + encodeURIComponent(item.id) }, 'Im Styler verwenden'),
      item.media_type?.startsWith('image/') && el('a', { class: 'btn primary', href: '#/playground?ref=' + item.id }, 'Im Playground weiterarbeiten'),
      ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(item.media_type) && state.pages?.some(page => page.id === 'video-playground') &&
        el('a', { class: 'btn', href: '#/video-playground?ref=' + encodeURIComponent(item.id) }, 'Als Video animieren'),
      el('div', { class: 'row' },
        el('a', { class: 'btn', href: mediaUrl(item), download: item.media_type === 'model/gltf-binary' ? item.title + '.glb' : gen.model }, icon('down'), 'Herunterladen'),
        item.media_type?.startsWith('image/') && el('button', { type: 'button', class: 'btn', onclick: e => cutOut(item, e.currentTarget) }, icon('cut'), 'Freistellen')),
      el('button', { type: 'button', class: 'btn danger', onclick: () => removeAsset(item, route) }, icon('trash'), 'Löschen')),
  ])
}

async function cutOut(item, button) {
  const providers = await api('/providers').catch(() => [])
  const provider = providers.find(p => p.capabilities.includes('removeBackground') && p.secrets.every(s => s.configured))
  if (!provider) return toast('Kein Anbieter zum Freistellen eingerichtet. Unter „Anbieter“ einen Schlüssel eintragen.', true)
  button.disabled = true
  const label = button.lastChild.textContent
  button.lastChild.textContent = 'Stellt frei …'
  try {
    await api('/images/remove-background', 'POST', { provider: provider.id, assetId: item.id, title: item.title })
    toast('Freigestellt, liegt in der Library.'); refreshCounts(); renderLibrary()
  } catch (error) { toast(error.message, true) } finally { button.disabled = false; button.lastChild.textContent = label }
}

/* Projekt */
async function renderProject(id) {
  const project = state.projects.find(p => p.id === id)
  if (!project) { view.replaceChildren(emptyState('inbox', 'Projekt nicht gefunden', 'Vielleicht wurde es gelöscht.', el('a', { class: 'btn', href: '#/sammlung' }, 'Zur Sammlung'))); return }
  const snapshot = state.snapshots.find(s => s.id === project.snapshot)
  const body = el('div', { class: 'scroll' }, loading())
  view.replaceChildren(...header(project.title, [snapshot && snapshot.id !== 'blank' ? snapshot.title : '', project.due ? 'Termin ' + new Date(project.due).toLocaleDateString('de-DE') : ''].filter(Boolean).join(' · ') || null, el('div', { class: 'tools' }, pickControls([]), ...['moodboard','storyboard','schnitt'].filter(key=>state.pages.some(app=>app.id===key)).map(key=>el('a',{class:'btn sm',href:'#/'+key+'?project='+id},{moodboard:'Moodboard',storyboard:'Storyboard',schnitt:'Schnitt'}[key])), uploadButton({ projectId: id }))), body)
  try {
    const items = await api('/assets?project=' + id)
    if (!items.length) return body.replaceChildren(emptyState('inbox', 'Noch nichts im Projekt', 'Ordne Dinge aus der Sammlung oder der Library zu, oder zieh Dateien hierher.', el('a', { class: 'btn primary', href: '#/sammlung' }, 'Zur Sammlung')))
    picking.visible = items; drawPickBar()
    body.replaceChildren(el('div', { class: 'masonry' }, items.map(item => tile(item, item.library === 'generation' ? openGeneration : openClip))))
  } catch (error) { body.replaceChildren(errorState(error, () => renderProject(id))) }
}

function newProjectDialog() {
  const title = el('input', { class: 'text-in', required: true, placeholder: 'z. B. Musikvideo Red Rose', autocomplete: 'off' })
  const kind = el('select', { 'aria-label': 'Art' }, state.snapshots.map(s => el('option', { value: s.id }, s.title)))
  const dialog = el('dialog', {}, el('form', { method: 'dialog' },
    el('h2', {}, 'Neues Projekt'),
    el('label', { class: 'field' }, el('span', {}, 'Name'), title),
    state.snapshots.length ? el('label', { class: 'field' }, el('span', {}, 'Art'), el('span', { class: 'pill', style: 'align-self:flex-start' }, kind, chev())) : null,
    el('div', { class: 'row' }, el('button', { type: 'button', class: 'btn ghost', onclick: () => dialog.close('no') }, 'Abbrechen'), el('button', { class: 'btn primary', value: 'yes' }, 'Anlegen'))))
  dialog.addEventListener('close', async () => {
    if (dialog.returnValue === 'yes' && title.value.trim()) {
      try {
        const created = await api('/projects', 'POST', { title: title.value.trim(), snapshot: kind.value || 'blank' })
        await loadProjects(); location.hash = '#/projekt/' + created.id
      } catch (error) { toast(error.message, true) }
    }
    dialog.remove()
  })
  document.body.append(dialog)
  dialog.showModal()
  title.focus()
}

/* Anbieter */
async function renderProviders() {
  const body = el('div', { class: 'scroll' }, el('div', { class: 'skel', style: 'height:160px;max-width:720px' }))
  view.replaceChildren(...header('Anbieter', 'Bildmodelle und Freistellen. Schlüssel liegen im Credential-Speicher des Harness, nicht in der Datenbank.'), body)
  try {
    const list = await api('/providers')
    body.replaceChildren(el('div', { style: 'display:flex;flex-direction:column;gap:24px;max-width:720px' }, list.map(providerCard)))
  } catch (error) { body.replaceChildren(errorState(error, renderProviders)) }
}

function providerCard(provider) {
  const inputs = provider.settings.map(s => [s.key, el('input', { class: 'text-in', value: s.value ?? '', autocomplete: 'off' })])
  const secrets = provider.secrets.map(s => [s.key, el('input', { class: 'text-in', type: 'password', placeholder: s.configured ? 'Gespeichert, zum Ändern neu eingeben' : 'Noch nicht eingetragen', autocomplete: 'off' })])
  const models = el('div', { class: 'meta' })
  const ready = provider.secrets.every(s => s.configured)
  return el('section', { style: 'display:flex;flex-direction:column;gap:16px;padding:24px;border:1px solid var(--c-hair);border-radius:16px;background:var(--c-panel)' },
    el('div', {}, el('h2', { style: 'margin:0;font-size:20px;font-weight:600' }, provider.title), el('div', { class: 'meta', style: 'margin-top:4px' }, provider.description || ''), el('div', { class: 'meta', style: 'margin-top:4px;color:' + (ready ? 'var(--c-ink-2)' : 'var(--c-danger)') }, ready ? 'Eingerichtet' : 'Schlüssel fehlt')),
    ...provider.settings.map((s, i) => el('label', { class: 'field' }, el('span', {}, s.label), inputs[i][1])),
    ...provider.secrets.map((s, i) => el('label', { class: 'field' }, el('span', {}, s.label), secrets[i][1])),
    el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' },
      el('button', { type: 'button', class: 'btn', onclick: async () => {
        try {
          await api('/providers/' + provider.id, 'PUT', { settings: Object.fromEntries(inputs.map(([k, input]) => [k, input.value])), secrets: Object.fromEntries(secrets.filter(([, input]) => input.value).map(([k, input]) => [k, input.value])) })
          toast('Gespeichert.'); renderProviders()
        } catch (error) { toast(error.message, true) }
      } }, 'Speichern'),
      provider.capabilities.includes('models') ? el('button', { type: 'button', class: 'btn', onclick: async () => {
        models.textContent = 'Lädt …'
        try { models.textContent = (await api(`/providers/${provider.id}/models`)).map(m => m.title).join(' · ') || 'Keine Modelle gemeldet.' } catch (error) { models.textContent = error.message }
      } }, 'Modelle laden') : null),
    models)
}

/* Routing */
let activeLeave = null
/** Hub building blocks handed to page plugins that render a whole view (e.g. the Playground). */
const shared = { get $() { return $ }, openImage, uploadFiles, uploadButton, API, api, chev, get currentRoute() { return currentRoute }, dateLabel, el, errorState, fullscreenButton, header, icon, icons, loading, media, refreshCounts, state, tile, timeLabel, toast, view, withFullscreen }
const currentRoute = () => {
  const name = location.hash.match(/^#\/([\w-]+)/)?.[1]
  return name === 'influencer-video' ? 'video-playground' : name || 'sammlung'
}
function route() {
  const savedQuery = new URLSearchParams(location.hash.split('?')[1] ?? '').get('q')
  if (savedQuery !== null && savedQuery !== state.query) { state.query = savedQuery; search.value = savedQuery }
  closeInspector()
  if (picking.on) setPicking(false)
  activeLeave?.(); activeLeave = null
  const name = currentRoute()
  document.querySelectorAll('.side .navi[data-route]').forEach(a => { const on = a.dataset.route === name; a.classList.toggle('on', on); on ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current') })
  renderProjects()
  const page = state.pages?.find(app => app.id === name)
  if (page) {
    const body = el('div', { class: 'scroll' }, loading())
    if (page.view) return import(page.module).then(module => { activeLeave = module.leave; return module.renderView(shared) }).catch(error => { view.replaceChildren(...header(page.title), errorState(error, route)) })
    view.replaceChildren(...header(page.title), body)
    return import(page.module).then(module => module.render(body, { el, api, icon, media, withFullscreen, isFashionReference, toast, refreshCounts, uploadFiles, uploadButton, projects: state.projects, params: new URLSearchParams(location.hash.split('?')[1]) })).catch(error => body.replaceChildren(errorState(error, route)))
  }
  if (name === 'library') return renderLibrary()
  if (name === 'tags') return tags.renderTagManager()
  if (name === 'sortieren') return tags.renderSortieren()
  if (name === 'projekt') return renderProject(location.hash.split('/')[2])
  if (name === 'anbieter') return renderProviders()
  return renderSammlung()
}

async function setupInstanceSwitch() {
  const { mode } = await api('/instance')
  const nsfw = mode === 'nsfw'
  if (nsfw) document.title = 'Atelier · NSFW'
  if (!['127.0.0.1', 'localhost'].includes(location.hostname)) return
  if (location.port !== (nsfw ? '3081' : '3080')) return
  const link = $('#instance-switch')
  const label = nsfw ? 'NSFW → Standard' : 'Standard → NSFW'
  link.querySelector('span').textContent = label
  link.title = link.ariaLabel = label
  const target = new URL('/creativity-hub/#/sammlung', location.origin)
  target.port = nsfw ? '3080' : '3081'
  link.href = target.href
  link.hidden = false
}
setupInstanceSwitch().catch(() => {})

/** Light (warm paper) is the default; the switch stores the choice and tells open views such as Flows. */
function setupThemeSwitch() {
  const button = $('#theme-switch')
  const show = () => {
    const dark = document.documentElement.dataset.theme === 'dark'
    button.setAttribute('aria-pressed', String(dark))
    button.querySelector('.t').textContent = dark ? 'Hell' : 'Dunkel'
    button.title = dark ? 'Zum hellen Thema wechseln' : 'Zum dunklen Thema wechseln'
  }
  button.addEventListener('click', () => {
    const dark = document.documentElement.dataset.theme !== 'dark'
    if (dark) document.documentElement.dataset.theme = 'dark'
    else delete document.documentElement.dataset.theme
    try { localStorage.setItem('atelier-theme', dark ? 'dark' : 'light') } catch { /* Storage blocked: the choice lasts for this page only. */ }
    show()
    dispatchEvent(new CustomEvent('atelier-theme'))
  })
  show()
}
setupThemeSwitch()

const search = $('#search')
let searchTimer
search.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { state.query = search.value.trim(); if (!['sammlung', 'library'].includes(currentRoute())) location.hash = '#/sammlung'; else route() }, 200) })
function clearSearch() { search.value = ''; state.query = ''; route() }
addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); search.focus(); search.select() }
  if (e.key === 'Escape' && picking.on && !document.querySelector('dialog[open]')) return setPicking(false)
  if (e.key === 'Escape' && !inspector.hidden && !document.querySelector('dialog[open]')) closeInspector()
})
$('#new-project').addEventListener('click', newProjectDialog)
addEventListener('hashchange', route)

;(async () => {
  try { state.snapshots = await api('/snapshots') } catch { state.snapshots = [] /* Snapshots sind optional; ohne sie legt der Hub „blank“-Projekte an. */ }
  try {
    state.pages = (await api('/apps')).filter(app => app.page)
    $('#plugin-pages').replaceChildren(...state.pages.map(app => el('a', { class: 'navi', href: '#/' + app.id, 'data-route': app.id }, svg(`<path d="${app.icon}"/>`), el('span', { class: 't' }, app.title))))
  } catch (error) { toast(error.message, true) }
  try { await loadProjects() } catch (error) { toast(error.message, true) }
  renderSaved().catch(() => { /* Gespeicherte Suchen sind Zusatz; die Seitenleiste bleibt ohne sie benutzbar. */ })
  refreshCounts().catch(() => { /* Zähler sind Zusatzinfo; ein Fehler zeigt sich ohnehin in der Ansicht. */ })
  route()
})()
