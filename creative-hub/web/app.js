/**
 * Atelier client: Seitenleiste, Sammlung, Library, Projekte und Anbieter.
 * Spricht nur mit der Hub-API unter /creativity-hub/api; Routen sind Hash-Routen (#/sammlung, #/projekt/<id> …).
 */
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
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
  wand: '<path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72"/><path d="m14 7 3 3"/>',
  chev: '<path d="m7 15 5 5 5-5"/><path d="m7 9 5-5 5 5"/>',
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
  const [clips, gens] = await Promise.all([api('/assets?library=clips'), api('/assets?library=generation')])
  $('#count-clips').textContent = clips.length || ''
  $('#count-generation').textContent = gens.length || ''
}

const mediaUrl = item => item.media_type ? `${API}/media/${item.id}` : (item.preview || '')
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

function tile(item, onOpen, { caption = true, onDelete = () => removeAsset(item, route) } = {}) {
  const kind = kindOf(item)
  const domain = domainOf(item.source)
  // Delete straight from the grid: the button appears on the image on hover or focus.
  const remove = el('button', { type: 'button', class: 'icon tile-delete', 'aria-label': `„${item.title}“ löschen`, title: 'Löschen', onclick: e => { e.stopPropagation(); onDelete() } }, icon('trash'))
  const framed = withFullscreen(item, el('button', { type: 'button', class: 'tile' + (state.selected === item.id ? ' sel' : ''), 'data-id': item.id, 'aria-label': item.title, onclick: () => onOpen(item) },
    el('span', { class: 'pic' }, media(item), (kind === 'videos' || kind === 'webseiten') && mediaUrl(item) ? el('span', { class: 'kind' }, kindLabel[kind]) : null),
    caption ? el('span', { class: 'title' }, item.title) : null,
    caption && domain ? el('span', { class: 'src' }, el('span', { class: 'dot', style: `background:${sourceDot(domain)}` }), domain) : null))
  const frame = framed.classList?.contains('image-frame') ? framed : el('div', { class: 'image-frame' }, framed)
  frame.append(remove)
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

async function renderSammlung() {
  const seg = el('div', { class: 'seg', role: 'group', 'aria-label': 'Art' }, filters.map(([key, label]) => el('button', { type: 'button', 'aria-pressed': String(state.filter === key), onclick: () => { state.filter = key; renderSammlung() } }, label)))
  const tools = el('div', { class: 'tools' }, uploadButton(), el('button', { type: 'button', class: 'btn sm', onclick: addLinkDialog }, icon('link'), 'Link einfügen'))
  const body = el('div', { class: 'scroll' }, loading())
  view.replaceChildren(...header('Sammlung', null, seg, tools), body)
  try {
    const all = await api('/assets?library=clips&q=' + encodeURIComponent(state.query))
    const items = all.filter(item => state.filter === 'alle' || kindOf(item) === state.filter)
    if (!all.length) {
      body.replaceChildren(state.query
        ? emptyState('inbox', 'Nichts gefunden', `Zu „${state.query}“ gibt es in der Sammlung nichts.`, el('button', { class: 'btn', onclick: clearSearch }, 'Suche löschen'))
        : emptyState('inbox', 'Noch nichts gesammelt', 'Mit dem Clipper in Safari sicherst du Bilder, Reels und ganze Seiten mit einem Klick hierher. Du kannst auch Dateien hier hineinziehen.', el('button', { class: 'btn primary', onclick: addLinkDialog }, 'Link einfügen')))
      return
    }
    if (!items.length) {
      body.replaceChildren(emptyState('inbox', `Keine ${filters.find(f => f[0] === state.filter)[1]}`, 'In der Sammlung gibt es davon gerade nichts.', el('button', { class: 'btn', onclick: () => { state.filter = 'alle'; renderSammlung() } }, 'Alle zeigen')))
      return
    }
    body.replaceChildren(el('div', { class: 'masonry' }, items.map(item => tile(item, openClip))))
  } catch (error) { body.replaceChildren(errorState(error, renderSammlung)) }
}

function openClip(item) {
  const domain = domainOf(item.source)
  openInspector(item, [
    withFullscreen(item, el('div', { class: 'hero' }, media(item, { full: true }))),
    el('div', {}, el('h2', {}, item.title), el('div', { class: 'meta', style: 'margin-top:4px' }, [domain, dateLabel(item.created_at) + ', ' + timeLabel(item.created_at)].filter(Boolean).join(' · '))),
    item.description && item.description !== item.title ? el('div', { class: 'field' }, el('span', {}, 'Notiz'), el('div', { class: 'prompt' }, item.description)) : null,
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
    el('div', { class: 'row' }, el('button', { class: 'btn ghost', value: 'no', formnovalidate: true }, 'Abbrechen'), el('button', { class: 'btn primary', value: 'yes' }, 'Sichern'))))
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
  e.preventDefault(); dragDepth = 0; dropHint.hidden = true
  const projectId = location.hash.match(/^#\/projekt\/([\w-]+)/)?.[1]
  if ((await uploadFiles(e.dataTransfer.files, { projectId })).length) route()
})

/**
 * Saves image and video files in the Sammlung (and the project, if given).
 * @param {FileList | File[]} list files from a drop or the file picker.
 * @param {{ projectId?: string }} options
 * @returns {Promise<object[]>} the created assets.
 */
async function uploadFiles(list, { projectId } = {}) {
  const files = [...list].filter(f => /^(image|video)\//.test(f.type))
  if (!files.length) { toast('Nur Bilder und Videos lassen sich hochladen.', true); return [] }
  const created = []
  for (const file of files) {
    if (file.size > 12 * 1024 * 1024) { toast(`„${file.name}“ ist größer als 12 MB.`, true); continue }
    const media = await new Promise(resolve => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.readAsDataURL(file) })
    const title = file.name.replace(/\.[^.]+$/, '')
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
  const typeSel = el('select', { 'aria-label': 'Inhalt der Library' },
    el('option', { value: '' }, 'Alle Medien'), el('option', { value: 'fashion' }, 'Fashion-Referenzen'))
  const modelSel = el('select', { 'aria-label': 'Modell' }, el('option', { value: '' }, 'Alle Modelle'))
  const projectSel = el('select', { 'aria-label': 'Projekt' }, el('option', { value: '' }, 'Alle Projekte'), state.projects.map(p => el('option', { value: p.id }, p.title)))
  const tools = el('div', { class: 'tools library-filters' }, el('label', { class: 'pill' }, typeSel, chev()), el('label', { class: 'pill' }, modelSel, chev()), el('label', { class: 'pill' }, projectSel, chev()))
  const body = el('div', { class: 'scroll' }, loading(5))
  view.replaceChildren(...header('Library', 'Alles, was du generiert hast', tools), body)
  let all
  try { all = await api('/assets?library=generation&q=' + encodeURIComponent(state.query)) } catch (error) { body.replaceChildren(errorState(error, renderLibrary)); return }
  const models = [...new Set(all.map(item => parseGeneration(item).model))].sort()
  modelSel.append(...models.map(m => el('option', { value: m }, m)))
  const draw = () => {
    const items = all.filter(item => (!typeSel.value || isFashionReference(item)) && (!modelSel.value || parseGeneration(item).model === modelSel.value) && (!projectSel.value || state.members.get(item.id)?.has(projectSel.value)))
    if (!all.length) return body.replaceChildren(emptyState('image', state.query ? 'Nichts gefunden' : 'Noch nichts generiert', state.query ? `Zu „${state.query}“ gibt es in der Library nichts.` : 'Alles, was du im Playground erzeugst, landet hier.', state.query ? el('button', { class: 'btn', onclick: clearSearch }, 'Suche löschen') : null))
    if (!items.length) return body.replaceChildren(emptyState('image', 'Keine Treffer', 'Für diese Auswahl gibt es keine Bilder.', el('button', { class: 'btn', onclick: () => { typeSel.value = ''; modelSel.value = ''; projectSel.value = ''; draw() } }, 'Filter zurücksetzen')))
    const groups = new Map()
    for (const item of items) { const key = dateLabel(item.created_at); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(item) }
    body.replaceChildren(...[...groups].flatMap(([day, list]) => [el('div', { class: 'day' }, day), el('div', { class: 'grid' }, list.map(item => tile(item, openGeneration, { caption: isFashionReference(item) })))]))
  }
  typeSel.onchange = modelSel.onchange = projectSel.onchange = draw
  draw()
}

function openGeneration(item) {
  const gen = parseGeneration(item)
  const fashion = isFashionReference(item)
  openInspector(item, [
    withFullscreen(item, el('div', { class: 'hero' }, media(item, { full: true }))),
    el('div', {}, el('h2', {}, fashion ? item.title : gen.model), el('div', { class: 'meta', style: 'margin-top:4px' }, [fashion && gen.model, gen.provider, dateLabel(item.created_at) + ', ' + timeLabel(item.created_at)].filter(Boolean).join(' · '))),
    el('div', { class: 'field' }, el('span', {}, 'Prompt'), el('div', { class: 'prompt' }, gen.prompt)),
    gen.refs ? el('div', { class: 'field' }, el('span', {}, 'Referenzen'), el('div', { class: 'prompt' }, gen.refs)) : null,
    el('div', { class: 'field' }, el('span', {}, 'Projekte'), state.projects.length ? projectChips(item) : el('span', { class: 'meta' }, 'Noch keine Projekte.')),
    el('div', { class: 'actions' },
      fashion && state.pages?.some(page => page.id === 'styler') && el('a', { class: 'btn primary', href: '#/styler?ref=' + encodeURIComponent(item.id) }, 'Im Styler verwenden'),
      item.media_type?.startsWith('image/') && el('a', { class: 'btn primary', href: '#/playground?ref=' + item.id }, 'Im Playground weiterarbeiten'),
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
  view.replaceChildren(...header(project.title, [snapshot && snapshot.id !== 'blank' ? snapshot.title : '', project.due ? 'Termin ' + new Date(project.due).toLocaleDateString('de-DE') : ''].filter(Boolean).join(' · ') || null, el('div', { class: 'tools' }, uploadButton({ projectId: id }))), body)
  try {
    const items = await api('/assets?project=' + id)
    if (!items.length) return body.replaceChildren(emptyState('inbox', 'Noch nichts im Projekt', 'Ordne Dinge aus der Sammlung oder der Library zu, oder zieh Dateien hierher.', el('a', { class: 'btn primary', href: '#/sammlung' }, 'Zur Sammlung')))
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
    el('div', { class: 'row' }, el('button', { class: 'btn ghost', value: 'no', formnovalidate: true }, 'Abbrechen'), el('button', { class: 'btn primary', value: 'yes' }, 'Anlegen'))))
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
const currentRoute = () => (location.hash.match(/^#\/([\w-]+)/)?.[1]) || 'sammlung'
function route() {
  closeInspector()
  activeLeave?.(); activeLeave = null
  const name = currentRoute()
  document.querySelectorAll('.side .navi[data-route]').forEach(a => { const on = a.dataset.route === name; a.classList.toggle('on', on); on ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current') })
  renderProjects()
  const page = state.pages?.find(app => app.id === name)
  if (page) {
    const body = el('div', { class: 'scroll' }, loading())
    if (page.view) return import(page.module).then(module => { activeLeave = module.leave; return module.renderView(shared) }).catch(error => { view.replaceChildren(...header(page.title), errorState(error, route)) })
    view.replaceChildren(...header(page.title), body)
    return import(page.module).then(module => module.render(body, { el, api, media, withFullscreen, isFashionReference, toast, refreshCounts, uploadFiles, uploadButton, projects: state.projects, params: new URLSearchParams(location.hash.split('?')[1]) })).catch(error => body.replaceChildren(errorState(error, route)))
  }
  if (name === 'library') return renderLibrary()
  if (name === 'projekt') return renderProject(location.hash.split('/')[2])
  if (name === 'anbieter') return renderProviders()
  return renderSammlung()
}

const search = $('#search')
let searchTimer
search.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { state.query = search.value.trim(); if (!['sammlung', 'library'].includes(currentRoute())) location.hash = '#/sammlung'; else route() }, 200) })
function clearSearch() { search.value = ''; state.query = ''; route() }
addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); search.focus(); search.select() }
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
  refreshCounts().catch(() => { /* Zähler sind Zusatzinfo; ein Fehler zeigt sich ohnehin in der Ansicht. */ })
  route()
})()
