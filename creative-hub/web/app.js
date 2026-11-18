import * as ui from './ui.js'

const base = '/creativity-hub'
const { element } = ui
const $ = id => document.getElementById(id)
let statusTimer
const status = message => {
  $('status').textContent = message
  clearTimeout(statusTimer)
  if (message) statusTimer = setTimeout(() => { $('status').textContent = '' }, 4000)
}
const fail = error => status(error.message)

let ideas = []
let apps = []
let snapshots = []
let idea = null
let ideaTab = 'note'
let routeVersion = 0
let collection = 'clips'
let editor = null
let boardModule
let notesTimer
let saving = Promise.resolve()
let calendarMonth = new Date()
let kanbanShowDone = false
let sidebarApps = null
let editingApps = false
let rowsView = false
const references = new Map()
const blockCleanups = []

/** Kanban columns, in order; ids match `statuses` in store.mjs. */
const statusList = [
  { id: 'idee', title: 'Idee', color: '#8E8E93' },
  { id: 'arbeit', title: 'In Arbeit', color: '#F59E0B' },
  { id: 'review', title: 'Review', color: '#3B82F6' },
  { id: 'fertig', title: 'Fertig', color: '#22C55E' },
]
const statusOf = id => statusList.find(item => item.id === id) ?? statusList[0]

/** Sidebar apps: hub views that can be shown or hidden, like Native Note's "Apps" section. */
const pageApps = [
  { id: 'mymind', title: 'Mymind', route: '#/mymind', icon: 'M12 3l2.4 5.6L20 11l-5.6 2.4L12 19l-2.4-5.6L4 11l5.6-2.4z' },
  { id: 'library', title: 'Library', route: '#/library', icon: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z' },
  { id: 'boards', title: 'Excalidraw', route: '#/boards', icon: 'M4 20l4-1L19 8l-3-3L5 16zM14 7l3 3' },
]

async function api(path, method = 'GET', body) {
  const response = await fetch(base + '/api/' + path, {
    method,
    ...(body && { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error || 'Anfrage fehlgeschlagen.')
  return result
}

const snapshotOf = id => snapshots.find(item => item.id === id) ?? { id, title: id, color: '#8E8E93', apps: [] }
const appOf = id => apps.find(app => app.id === id)
const today = () => new Date().toLocaleDateString('sv-SE')
const ago = iso => {
  if (!iso) return ''
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60000)
  if (minutes < 1) return 'gerade eben'
  if (minutes < 60) return `vor ${minutes} Min.`
  if (minutes < 1440) return `vor ${Math.round(minutes / 60)} Std.`
  return new Date(iso).toLocaleDateString('de-DE', { day: 'numeric', month: 'short' })
}
const dayLabel = day => new Date(day + 'T12:00').toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
const shortDay = day => new Date(day + 'T12:00').toLocaleDateString('de-DE', { day: 'numeric', month: 'short' })

function withIcons(root) {
  for (const node of root.querySelectorAll('[data-icon]')) if (!node.querySelector('svg')) node.prepend(ui.icon(node.dataset.icon))
}

function dot(color) {
  const node = element('i', '', 'dot')
  node.style.background = color
  return node
}

function sideLink(item) {
  const link = element('a', '', 'item')
  link.href = '#/idea/' + item.id
  link.append(dot(snapshotOf(item.snapshot).color), element('span', item.title, 'label'))
  if (idea?.id === item.id) link.setAttribute('aria-current', 'page')
  return link
}

function drawSidebar(route) {
  for (const link of document.querySelectorAll('#sidebar [data-route]')) {
    if (link.dataset.route === route) link.setAttribute('aria-current', 'page')
    else link.removeAttribute('aria-current')
  }
  const pinned = ideas.filter(item => item.pinned)
  $('pinned').replaceChildren(...pinned.map(sideLink))
  $('pinned-group').hidden = !pinned.length
  const shown = sidebarApps ?? pageApps.map(app => app.id)
  $('apps-edit').setAttribute('aria-pressed', String(editingApps))
  $('page-apps').replaceChildren(...pageApps.filter(app => editingApps || shown.includes(app.id)).map(app => {
    const on = shown.includes(app.id)
    const row = element('div', '', 'app-row' + (on ? '' : ' off'))
    const link = element('a', '', 'item')
    link.href = app.route
    link.append(ui.icon(app.icon), element('span', app.title, 'label'))
    if (route === app.id) link.setAttribute('aria-current', 'page')
    row.append(link)
    if (editingApps) row.append(ui.iconButton(on ? '−' : '+', (on ? 'Ausblenden: ' : 'Einblenden: ') + app.title, () => setSidebarApps(on ? shown.filter(id => id !== app.id) : [...shown, app.id])))
    return row
  }))
}

async function setSidebarApps(next) {
  sidebarApps = next
  drawSidebar(currentRoute())
  try { await api('sidebar', 'PUT', { apps: next }) } catch (error) { fail(error) }
}

const currentRoute = () => document.querySelector('#sidebar [aria-current="page"]')?.dataset.route ?? ''

const views = ['view-home', 'view-ideas', 'view-kanban', 'view-calendar', 'view-journal', 'view-feed', 'view-todo', 'view-boards', 'view-idea', 'view-collection', 'view-providers']
function show(view) {
  for (const id of views) $(id).hidden = id !== view
}

/** Saves fields of any idea from its summary, keeping `ideas` current. */
async function patchIdea(item, changes) {
  const saved = await api('projects/' + item.id, 'PUT', { revision: item.revision, ...changes })
  ideas = ideas.map(other => other.id === saved.id ? { ...other, ...saved } : other)
  return saved
}

function ideaRow(item) {
  const row = element('a', '', 'idea-row')
  row.href = '#/idea/' + item.id
  const snapshot = snapshotOf(item.snapshot)
  const state = statusOf(item.status)
  const meta = element('span', '', 'meta')
  meta.append(dot(snapshot.color), element('span', snapshot.title))
  const pill = element('span', state.title, 'pill')
  pill.prepend(dot(state.color))
  row.append(element('strong', item.title), meta, pill, element('span', item.due ? shortDay(item.due) : '', 'muted'), element('span', ago(item.updated_at), 'muted'))
  return row
}

// Home
async function openHome(version) {
  const [entries, journal] = await Promise.all([api('assets'), api('journal')])
  if (version !== routeVersion) return
  show('view-home')
  drawSidebar('home')
  const hour = new Date().getHours()
  $('home-greeting').textContent = hour < 11 ? 'Guten Morgen' : hour < 18 ? 'Hallo' : 'Guten Abend'
  $('home-recent').replaceChildren(...(ideas.length ? ideas.slice(0, 6).map(ideaRow) : [element('p', 'Noch keine Ideen. Leg mit „Neue Idee“ die erste an.', 'empty')]))
  $('home-journal').value = journal.find(entry => entry.day === today())?.text ?? ''
  $('home-journal').oninput = debounce(() => api('journal/' + today(), 'PUT', { text: $('home-journal').value }).catch(fail))
  const recent = entries.filter(asset => asset.media_type || asset.preview).slice(0, 12)
  $('home-assets').replaceChildren(...(recent.length ? recent.map(asset => ui.assetTile(asset)) : [element('p', 'Noch nichts gesammelt.', 'empty')]))
}

function debounce(fn, ms = 700) {
  let timer
  return () => { clearTimeout(timer); timer = setTimeout(fn, ms) }
}

// All ideas
function drawIdeas() {
  const terms = $('idea-search').value.toLocaleLowerCase().split(/\s+/).filter(Boolean)
  const visible = ideas.filter(item => terms.every(term => (item.title + ' ' + item.notes).toLocaleLowerCase().includes(term)))
  $('idea-grid').replaceChildren(...(visible.length ? visible.map(ideaRow) : [element('p', ideas.length ? 'Keine passende Idee.' : 'Noch keine Ideen. Leg mit „Neue Idee“ die erste an.', 'empty')]))
}

// Kanban
function kanbanCard(item) {
  const card = element('a', '', 'kanban-card')
  card.href = '#/idea/' + item.id
  card.draggable = true
  card.ondragstart = event => { event.dataTransfer.setData('text/plain', item.id); card.classList.add('dragging') }
  card.ondragend = () => card.classList.remove('dragging')
  const meta = element('span', '', 'meta')
  const snapshot = snapshotOf(item.snapshot)
  meta.append(dot(snapshot.color), element('span', snapshot.title))
  if (item.due) meta.append(element('span', '· ' + shortDay(item.due)))
  card.append(element('strong', item.title), meta)
  return card
}

function drawKanban() {
  const format = $('kanban-format').value
  const terms = $('kanban-search').value.toLocaleLowerCase().split(/\s+/).filter(Boolean)
  const visible = ideas.filter(item => (!format || item.snapshot === format) && terms.every(term => item.title.toLocaleLowerCase().includes(term)))
  $('kanban-sub').textContent = `Von der Idee bis fertig. Zieh eine Karte, um ihren Status zu ändern · ${visible.length}`
  const pinned = visible.filter(item => item.pinned)
  $('kanban-pinned').replaceChildren(...pinned.map(item => {
    const card = kanbanCard(item)
    card.append(element('span', '📌', 'pin-mark'))
    return card
  }))
  $('kanban-pinned').hidden = !pinned.length
  $('kanban-board').replaceChildren(...statusList.map(state => {
    const column = element('section', '', 'kanban-column')
    column.style.setProperty('--tone', state.color)
    const items = visible.filter(item => item.status === state.id)
    const head = element('header')
    head.append(dot(state.color), element('h2', state.title), element('span', String(items.length), 'muted'))
    const list = element('div', '', 'kanban-list')
    const collapsed = state.id === 'fertig' && !kanbanShowDone && items.length > 0
    if (collapsed) {
      const more = element('button', `Alle ${items.length} fertigen anzeigen ▾`, 'ghost')
      more.type = 'button'
      more.onclick = () => { kanbanShowDone = true; drawKanban() }
      list.append(more)
    } else list.append(...(items.length ? items.map(kanbanCard) : [element('p', 'Nichts hier', 'empty')]))
    column.ondragover = event => { event.preventDefault(); column.classList.add('drop') }
    column.ondragleave = () => column.classList.remove('drop')
    column.ondrop = async event => {
      event.preventDefault()
      column.classList.remove('drop')
      const item = ideas.find(other => other.id === event.dataTransfer.getData('text/plain'))
      if (!item || item.status === state.id) return
      try { await patchIdea(item, { status: state.id }); drawKanban() } catch (error) { fail(error) }
    }
    column.append(head, list)
    return column
  }))
}

function openKanban() {
  show('view-kanban')
  drawSidebar('kanban')
  const selected = $('kanban-format').value
  $('kanban-format').replaceChildren(new Option(`Alle Formate (${ideas.length})`, ''), ...snapshots.map(snapshot => new Option(`${snapshot.title} (${ideas.filter(item => item.snapshot === snapshot.id).length})`, snapshot.id)))
  $('kanban-format').value = selected
  drawKanban()
}

// Calendar
function drawCalendar() {
  const year = calendarMonth.getFullYear()
  const month = calendarMonth.getMonth()
  $('calendar-title').textContent = calendarMonth.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })
  const first = new Date(year, month, 1)
  const offset = (first.getDay() + 6) % 7
  const days = new Date(year, month + 1, 0).getDate()
  const cells = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map(name => element('span', name, 'weekday'))
  for (let index = 0; index < offset; index++) cells.push(element('div', '', 'day blank'))
  for (let day = 1; day <= days; day++) {
    const key = new Date(year, month, day).toLocaleDateString('sv-SE')
    const cell = element('div', '', 'day' + (key === today() ? ' today' : ''))
    cell.append(element('span', String(day), 'number'))
    for (const item of ideas.filter(other => other.due === key)) {
      const link = element('a', item.title, 'event')
      link.href = '#/idea/' + item.id
      link.style.setProperty('--tone', statusOf(item.status).color)
      cell.append(link)
    }
    cells.push(cell)
  }
  $('calendar-grid').replaceChildren(...cells)
}

// Journal
async function openJournal(version) {
  const entries = await api('journal')
  if (version !== routeVersion) return
  show('view-journal')
  drawSidebar('journal')
  const days = entries.some(entry => entry.day === today()) ? entries : [{ day: today(), text: '' }, ...entries]
  $('journal-list').replaceChildren(...days.map(entry => {
    const section = element('section', '', 'journal-entry')
    const area = element('textarea', '', 'journal-text')
    area.value = entry.text
    area.rows = entry.day === today() ? 8 : Math.min(12, Math.max(3, entry.text.split('\n').length + 1))
    area.placeholder = 'Was beschäftigt dich heute?'
    area.setAttribute('aria-label', 'Journal ' + dayLabel(entry.day))
    area.oninput = debounce(() => api('journal/' + entry.day, 'PUT', { text: area.value }).catch(fail))
    section.append(element('h2', (entry.day === today() ? 'Heute · ' : '') + dayLabel(entry.day)), area)
    return section
  }))
}

// Feed
const feedKinds = { idea: ['Idee', 'M4 6h16M4 12h16M4 18h16'], asset: ['Gesammelt', 'M12 3l2.4 5.6L20 11l-5.6 2.4L12 19l-2.4-5.6L4 11l5.6-2.4z'], journal: ['Journal', 'M6 3h11a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H6zM9 3v18'] }
async function openFeed(version) {
  const entries = await api('feed')
  if (version !== routeVersion) return
  show('view-feed')
  drawSidebar('feed')
  $('feed-list').replaceChildren(...(entries.length ? entries.map(entry => {
    const item = element('li', '', 'feed-item')
    const [label, path] = feedKinds[entry.kind] ?? ['', 'M12 5v14']
    const body = element('div')
    const head = element(entry.kind === 'idea' ? 'a' : entry.kind === 'journal' ? 'a' : 'span', '', 'feed-title')
    if (entry.kind === 'idea') head.href = '#/idea/' + entry.id
    if (entry.kind === 'journal') head.href = '#/journal'
    head.textContent = entry.kind === 'journal' ? 'Journal · ' + dayLabel(entry.title) : entry.title
    const detail = entry.kind === 'idea' ? statusOf(entry.detail).title : entry.kind === 'asset' ? (entry.detail === 'clips' ? 'in Mymind gesichert' : 'in der Library') : entry.detail
    body.append(head, element('p', detail, 'muted'))
    item.append(ui.icon(path), element('span', label, 'feed-kind'), body, element('time', ago(entry.at), 'muted'))
    return item
  }) : [element('li', 'Noch nichts passiert.', 'empty')]))
}

// Todo
async function openTodo(version) {
  const data = await api('todo')
  if (version !== routeVersion) return
  show('view-todo')
  drawSidebar('todo')
  let items = Array.isArray(data.items) ? data.items : []
  const save = () => api('todo', 'PUT', { items }).catch(fail)
  const draw = () => {
    const list = element('ul', '', 'checklist')
    list.append(...items.map((entry, index) => {
      const li = element('li', '', entry.done ? 'done' : '')
      const label = element('label')
      const box = element('input')
      box.type = 'checkbox'
      box.checked = entry.done
      box.onchange = () => { items = items.map((other, i) => i === index ? { ...other, done: box.checked } : other); save(); draw() }
      label.append(box, element('span', entry.text))
      li.append(label, ui.iconButton('×', entry.text + ' entfernen', () => { items = items.filter((_, i) => i !== index); save(); draw() }))
      return li
    }))
    const form = element('form', '', 'inline-add')
    const input = element('input')
    input.placeholder = 'Neue Aufgabe …'
    input.setAttribute('aria-label', 'Neue Aufgabe')
    form.append(input, element('button', 'Hinzufügen', 'primary small'))
    form.onsubmit = event => { event.preventDefault(); const text = input.value.trim(); if (!text) return; items = [...items, { text, done: false }]; save(); draw(); $('todo-body').querySelector('input:not([type])')?.focus() }
    $('todo-body').replaceChildren(form, list)
  }
  draw()
}

// Excalidraw boards
async function openBoards(version) {
  show('view-boards')
  drawSidebar('boards')
  const full = await Promise.all(ideas.map(item => api('projects/' + item.id)))
  if (version !== routeVersion) return
  const withBoard = full.filter(item => item.scene.elements.some(part => !part.isDeleted))
  const cards = withBoard.map(item => {
    const card = element('a', '', 'board-card')
    card.href = '#/idea/' + item.id + '/board'
    const frame = element('div', '', 'board-thumb')
    card.append(frame, element('strong', item.title), element('span', ago(item.updated_at), 'muted'))
    loadBoard().then(module => module.preview(item.scene)).then(preview => frame.replaceChildren(preview)).catch(() => frame.replaceChildren(element('span', 'Vorschau fehlt', 'muted')))
    return card
  })
  $('board-grid').replaceChildren(...(cards.length ? cards : [element('p', 'Noch keine Boards. Öffne eine Idee und klicke „Board bearbeiten“.', 'empty')]))
}

// One idea
function teardownIdea() {
  clearTimeout(notesTimer)
  editor?.unmount()
  editor = null
  while (blockCleanups.length) blockCleanups.pop()?.()
}

async function openIdea(id, version, openBoardEditor) {
  const next = await api('projects/' + id)
  if (version !== routeVersion) return
  const sameIdea = idea?.id === next.id
  teardownIdea()
  idea = next
  if (!sameIdea) ideaTab = 'note'
  show('view-idea')
  $('idea-title').value = idea.title
  $('idea-notes').value = idea.notes
  const snapshot = snapshotOf(idea.snapshot)
  $('idea-snapshot').replaceChildren(dot(snapshot.color), snapshot.title)
  $('idea-status').replaceChildren(...statusList.map(state => new Option(state.title, state.id)))
  $('idea-status').value = idea.status
  $('idea-due').value = idea.due
  drawPin()
  $('idea-saved').textContent = 'Gespeichert ' + ago(idea.updated_at)
  $('board-caption').textContent = idea.title + ' · ' + ago(idea.updated_at)
  $('board-editor').hidden = true
  $('board-actions').hidden = true
  drawSidebar('idea')
  drawTabs()
  growNotes()
  await Promise.all([drawBoardPreview(), drawBlocks()])
  if (openBoardEditor) $('board-open').click()
}

function drawTabs() {
  const tabs = [['note', 'Notiz'], ...idea.apps.map(id => [id, appOf(id)?.title ?? id]), ['details', 'Details']]
  if (!tabs.some(([id]) => id === ideaTab)) ideaTab = 'note'
  $('idea-tabs').replaceChildren(...tabs.map(([id, title]) => {
    const tab = element('button', title, 'tab')
    tab.type = 'button'
    tab.setAttribute('role', 'tab')
    tab.setAttribute('aria-selected', String(id === ideaTab))
    tab.onclick = () => { ideaTab = id; drawTabs(); showTab() }
    return tab
  }))
  const available = apps.filter(app => !idea.apps.includes(app.id))
  $('add-app').replaceChildren(new Option('Einblenden ▾', ''), ...available.map(app => new Option(app.title, app.id)))
  $('add-app').hidden = !available.length
  showTab()
}

function showTab() {
  $('tab-note').hidden = ideaTab !== 'note'
  $('tab-details').hidden = ideaTab !== 'details'
  for (const section of $('blocks').children) section.hidden = section.dataset.app !== ideaTab
  if (ideaTab === 'note') growNotes()
}

function drawPin() {
  $('idea-pin').textContent = idea.pinned ? '📌 Angepinnt · lösen' : 'Anpinnen'
}

function growNotes() {
  const notes = $('idea-notes')
  notes.style.height = 'auto'
  notes.style.height = notes.scrollHeight + 'px'
}

/** Serializes idea writes so every PUT carries the latest revision. */
function saveIdea(changes) {
  const target = idea
  saving = saving.then(async () => {
    if (idea?.id !== target.id) return
    const saved = await api('projects/' + idea.id, 'PUT', { revision: idea.revision, ...changes })
    if (idea?.id !== saved.id) return
    idea = { ...saved }
    ideas = ideas.map(item => item.id === saved.id ? { ...item, ...saved } : item)
    $('idea-saved').textContent = 'Gespeichert ' + ago(saved.updated_at)
  }).catch(fail)
  return saving
}

async function setApps(next) {
  await saveIdea({ apps: next })
  drawTabs()
  await drawBlocks()
}

function loadBoard() {
  boardModule ??= (async () => {
    const css = element('link')
    css.rel = 'stylesheet'
    css.href = base + '/board-editor/assets/board.css'
    document.head.append(css)
    return import(base + '/board-editor/assets/board.js')
  })().catch(() => { boardModule = undefined; throw new Error('Der Excalidraw-Editor muss zuerst gebaut werden. Siehe README.') })
  return boardModule
}

async function drawBoardPreview() {
  const current = idea
  if (!current.scene.elements.some(item => !item.isDeleted)) {
    $('board-preview').replaceChildren(element('p', 'Das Board ist leer. Skizziere hier Abläufe, Looks oder Lichtsetups.', 'empty'))
    return
  }
  const preview = await (await loadBoard()).preview(current.scene)
  if (idea?.id === current.id) $('board-preview').replaceChildren(preview)
}

async function drawBlocks() {
  while (blockCleanups.length) blockCleanups.pop()?.()
  const current = idea
  const sections = current.apps.map(id => {
    const app = appOf(id)
    const section = element('section', '', 'block')
    section.dataset.app = id
    const header = element('header')
    header.append(ui.icon(app?.icon ?? 'M12 5v14M5 12h14', 18), element('h2', app?.title ?? id),
      ui.iconButton('−', (app?.title ?? id) + ' aus dieser Idee ausblenden', () => setApps(idea.apps.filter(other => other !== id))))
    const body = element('div')
    section.append(header, body)
    if (app) renderApp(app, body, current).catch(error => body.replaceChildren(element('p', 'Die App konnte nicht geladen werden: ' + error.message, 'missing')))
    else {
      const missing = element('div', '', 'missing')
      missing.append(element('span', `Die App „${id}“ ist noch nicht installiert. Bitte Claude oder Codex, sie zu bauen:`))
      missing.append(element('pre', `Baue im Creativity Hub die App "${id}" als Plugin unter creative-hub/apps/${id}/ nach dem Muster von apps/checklist (host.mjs mit defineApp, block.js mit render).`))
      body.append(missing)
    }
    return section
  })
  if (idea?.id === current.id) { $('blocks').replaceChildren(...sections); showTab() }
}

async function renderApp(app, container, current) {
  let { data, revision } = await api(`projects/${current.id}/apps/${app.id}`)
  let queue = Promise.resolve()
  const module = await import(app.module)
  if (idea?.id !== current.id) return
  const save = next => {
    queue = queue.then(async () => {
      const saved = await api(`projects/${current.id}/apps/${app.id}`, 'PUT', { revision, data: next })
      revision = saved.revision
      data = saved.data
    }).catch(error => status(app.title + ': ' + error.message))
    return queue
  }
  const cleanup = await module.render(container, {
    idea: { id: current.id, title: current.title },
    data,
    save,
    api,
    status,
    ui,
  })
  if (typeof cleanup === 'function') blockCleanups.push(cleanup)
}

// Mymind and Library
function assetCard(asset) {
  const article = element('article', '', 'card')
  const media = ui.assetMedia(asset)
  if (media) article.append(media)
  const body = element('div', '', 'card-body')
  const head = element('header')
  head.append(element('h3', asset.title))
  if (collection === 'generation' && asset.media_type?.startsWith('image/')) {
    const pick = ui.iconButton('◎', asset.title + ' als Referenz verwenden', () => { toggleReference(asset); pick.setAttribute('aria-pressed', String(references.has(asset.id))) })
    pick.setAttribute('aria-pressed', String(references.has(asset.id)))
    pick.title = 'Als Referenz verwenden'
    head.append(pick)
  }
  head.append(ui.iconButton('×', asset.title + ' löschen', () => removeAsset(asset)))
  body.append(head)
  if (asset.description) body.append(element('p', asset.description))
  if (asset.source) {
    const link = element('a', new URL(asset.source).hostname, 'source')
    link.href = asset.source
    link.target = '_blank'
    link.rel = 'noreferrer'
    body.append(link)
  }
  const foot = element('footer')
  foot.append(element('time', ago(asset.created_at), 'muted'))
  if (ideas.length) {
    const select = element('select')
    select.setAttribute('aria-label', asset.title + ' einer Idee zuordnen')
    select.append(new Option('Zu Idee …', ''), ...ideas.map(item => new Option(item.title, item.id)))
    select.onchange = async () => {
      if (!select.value) return
      try {
        await api('assign', 'POST', { id: asset.id, projectId: select.value })
        status('Der Idee hinzugefügt.')
      } catch (error) { fail(error) }
      select.value = ''
    }
    foot.append(select)
  }
  body.append(foot)
  article.append(body)
  return article
}

async function removeAsset(asset) {
  if (!confirm(`„${asset.title}“ endgültig löschen? Das lässt sich nicht rückgängig machen.`)) return
  try {
    await api('assets/' + asset.id, 'DELETE')
    references.delete(asset.id)
    drawReferences()
    status('Gelöscht.')
    await drawAssets()
  } catch (error) { fail(error) }
}

function readFile(file) {
  if (file.size > 12 * 1024 * 1024) throw new Error('Die Datei ist größer als 12 MB.')
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result.split(',')[1])
    reader.onerror = () => reject(new Error('Die Datei konnte nicht gelesen werden.'))
    reader.readAsDataURL(file)
  })
}

/** Native Note's "Add a new idea" card: paste a link or write a note, or upload a file. */
function quickAdd() {
  const form = element('form', '', 'card add-card')
  const input = element('textarea')
  input.rows = 2
  input.placeholder = 'Link einfügen oder Notiz schreiben …'
  input.setAttribute('aria-label', 'Link oder Notiz')
  const file = element('input')
  file.type = 'file'
  file.accept = 'image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm'
  file.hidden = true
  const footer = element('footer')
  const upload = element('button', '⤒ Hochladen', 'ghost')
  upload.type = 'button'
  upload.onclick = () => file.click()
  file.onchange = async () => {
    const picked = file.files[0]
    if (!picked) return
    try {
      await api('assets', 'POST', { library: collection, title: picked.name.replace(/\.[^.]+$/, ''), media: await readFile(picked), mediaType: picked.type })
      status('Hochgeladen.')
      await drawAssets()
    } catch (error) { fail(error) }
    file.value = ''
  }
  footer.append(upload, element('button', 'Sichern', 'primary small'))
  form.append(element('span', collection === 'clips' ? 'Neue Idee sammeln' : 'Datei hinzufügen', 'muted'), input, file, footer)
  form.onsubmit = async event => {
    event.preventDefault()
    const value = input.value.trim()
    if (!value) return
    let url = ''
    try { url = new URL(value).protocol.startsWith('http') ? value : '' } catch { url = '' }
    try {
      await api('assets', 'POST', url
        ? { library: collection, title: new URL(url).hostname, source: url, ...(collection === 'generation' && /\.(png|jpe?g|webp|gif)(\?|$)/i.test(url) ? { preview: url } : {}) }
        : { library: 'clips', title: value.split('\n')[0].slice(0, 60), description: value })
      input.value = ''
      status('Gesichert.')
      await drawAssets()
    } catch (error) { fail(error) }
  }
  return form
}

async function drawAssets() {
  const version = routeVersion
  const entries = await api('assets?' + new URLSearchParams({ library: collection, q: $('search').value }))
  if (version !== routeVersion) return
  $('assets').classList.toggle('rows', rowsView)
  $('assets').replaceChildren(quickAdd(), ...entries.map(assetCard))
}

function toggleReference(asset) {
  if (references.has(asset.id)) references.delete(asset.id)
  else references.set(asset.id, asset)
  drawReferences()
}

function drawReferences() {
  $('composer-refs').replaceChildren(...[...references.values()].map(asset => {
    const chip = element('span', '', 'ref-chip')
    const thumb = ui.assetMedia(asset)
    if (thumb) { thumb.onclick = null; thumb.classList.remove('zoomable'); chip.append(thumb) }
    chip.append(element('span', asset.title), ui.iconButton('×', asset.title + ' als Referenz entfernen', () => { references.delete(asset.id); drawReferences(); drawAssets().catch(fail) }))
    return chip
  }))
}

let generators = []
async function setupComposer() {
  const providers = await api('providers')
  generators = providers.filter(provider => provider.capabilities.includes('generate'))
  $('composer').hidden = !generators.length
  if (!generators.length) return
  const chosen = $('composer-provider').value
  $('composer-provider').replaceChildren(...generators.map(provider => new Option(provider.title, provider.id)))
  if (generators.some(provider => provider.id === chosen)) $('composer-provider').value = chosen
  $('composer-idea').replaceChildren(new Option('Keine Ziel-Idee', ''), ...ideas.map(item => new Option(item.title, item.id)))
  await loadModels()
}

async function loadModels() {
  const provider = $('composer-provider').value
  $('composer-model').replaceChildren(new Option('Modelle laden …', ''))
  try {
    const models = await api(`providers/${provider}/models`)
    if ($('composer-provider').value !== provider) return
    $('composer-model').replaceChildren(...(models.length ? models.map(model => new Option(model.title, model.id)) : [new Option('Standardmodell', '')]))
  } catch (error) {
    $('composer-model').replaceChildren(new Option('Standardmodell', ''))
    fail(error)
  }
}

async function generate(event) {
  event.preventDefault()
  const prompt = $('composer-prompt').value.trim()
  if (!prompt) return status('Schreib zuerst einen Prompt.')
  const provider = generators.find(item => item.id === $('composer-provider').value)
  const count = Number($('composer-count').value)
  const model = $('composer-model').value
  if (!confirm(`${count} ${count === 1 ? 'Bild' : 'Bilder'} mit ${provider.title}${model ? ' · ' + model : ''}${references.size ? ' und ' + references.size + ' Referenzen' : ''} generieren? Der Anbieter berechnet die Anfragen nach seiner Preisliste.`)) return
  const button = $('composer-go')
  button.disabled = true
  status('Generiere …')
  try {
    const result = await api('images/generate', 'POST', { provider: provider.id, model, prompt, aspect: $('composer-aspect').value, count, referenceIds: [...references.keys()], ideaId: $('composer-idea').value })
    status(`${result.assets.length} ${result.assets.length === 1 ? 'Bild' : 'Bilder'} gesichert.${result.credits ? ' Verbraucht: ' + result.credits + ' Credits.' : ''}`)
    await drawAssets()
  } catch (error) { fail(error) } finally { button.disabled = false }
}

async function openCollection(kind, route) {
  collection = kind
  show('view-collection')
  $('search').placeholder = kind === 'clips' ? 'Durchsuche deinen Mind …' : 'Durchsuche Bilder und Videos …'
  $('search').value = ''
  $('new-asset').textContent = kind === 'clips' ? '🔖 Clip mit Details' : 'Datei mit Details'
  $('composer').hidden = kind !== 'generation'
  drawSidebar(route)
  await drawAssets()
  if (kind === 'generation') { drawReferences(); await setupComposer() }
}

/** Lightbox actions: remove the background or use the image as a reference. */
ui.setLightboxActions(asset => {
  if (!asset.media_type?.startsWith('image/') && !asset.preview) return []
  const actions = []
  const cutouts = generatorsWith('removeBackground')
  if (cutouts.length) {
    const cut = element('button', 'Freistellen', 'ghost')
    cut.type = 'button'
    cut.onclick = async () => {
      const provider = cutouts[0]
      if (!confirm(`„${asset.title}“ mit ${provider.title} freistellen? Der Anbieter berechnet den Auftrag nach seiner Preisliste.`)) return
      cut.disabled = true
      try {
        await api('images/remove-background', 'POST', { provider: provider.id, assetId: asset.id, title: asset.title, source: asset.source })
        status('Freigestellt und in der Library gesichert.')
        if (!$('view-collection').hidden) await drawAssets()
      } catch (error) { fail(error) } finally { cut.disabled = false }
    }
    actions.push(cut)
  }
  const ref = element('button', references.has(asset.id) ? 'Referenz entfernen' : 'Als Referenz', 'ghost')
  ref.type = 'button'
  ref.onclick = () => { toggleReference(asset); ref.textContent = references.has(asset.id) ? 'Referenz entfernen' : 'Als Referenz'; status('Referenzen: ' + references.size + ' · im Library-Composer') }
  actions.push(ref)
  return actions
})

let providerCache = []
const generatorsWith = capability => providerCache.filter(provider => provider.capabilities.includes(capability))

function openAsset(data = {}) {
  const form = $('asset-form')
  form.reset()
  form.querySelector('.form-status').textContent = ''
  form.dataset.library = collection
  const clip = collection === 'clips'
  $('asset-title').textContent = clip ? 'Clip hinzufügen' : 'Datei importieren'
  for (const key of ['title', 'source', 'preview', 'description']) form.elements[key].value = typeof data[key] === 'string' ? data[key] : ''
  $('asset-dialog').showModal()
}

async function submitForm(event, submit) {
  event.preventDefault()
  const form = event.currentTarget
  const button = form.querySelector('button.primary')
  button.disabled = true
  const feedback = form.querySelector('.form-status')
  feedback.textContent = ''
  try { await submit(new FormData(form), form) } catch (error) { feedback.textContent = error.message } finally { button.disabled = false }
}

// New idea
let pickedSnapshot = 'blank'
function openNewIdea() {
  $('idea-form').reset()
  $('idea-form').querySelector('.form-status').textContent = ''
  pickedSnapshot = snapshots[0]?.id ?? 'blank'
  drawSnapshots()
  $('idea-dialog').showModal()
}

function drawSnapshots() {
  $('snapshot-grid').replaceChildren(...snapshots.map(snapshot => {
    const button = element('button', '', 'snapshot')
    button.type = 'button'
    button.setAttribute('aria-pressed', String(snapshot.id === pickedSnapshot))
    const title = element('strong')
    title.append(dot(snapshot.color), snapshot.title)
    const tags = element('span', '', 'tags')
    tags.append(...snapshot.apps.map(id => element('em', appOf(id)?.title ?? id + ' (fehlt)')))
    if (!snapshot.apps.length) tags.append(element('em', 'Board'))
    button.append(title, element('span', snapshot.description), tags)
    button.onclick = () => { pickedSnapshot = snapshot.id; drawSnapshots() }
    return button
  }))
}

// Providers
const capabilityNames = { models: 'Modelle', generate: 'Generieren', removeBackground: 'Freistellen', search: 'Bildsuche' }

function providerCard(provider) {
  const card = element('section', '', 'provider')
  const header = element('header')
  const caps = element('span', '', 'caps')
  caps.append(...provider.capabilities.filter(cap => cap !== 'models').map(cap => element('em', capabilityNames[cap] ?? cap)))
  header.append(element('h2', provider.title), caps)
  card.append(header)
  if (provider.description) card.append(element('p', provider.description, 'muted'))
  const form = element('form')
  for (const field of provider.settings) {
    const label = element('label', field.label)
    const input = element('input')
    input.name = 'setting:' + field.key
    input.value = field.value
    input.placeholder = field.placeholder
    label.append(input)
    form.append(label)
  }
  for (const field of provider.secrets) {
    const label = element('label', field.label)
    const input = element('input')
    input.type = 'password'
    input.name = 'secret:' + field.key
    input.autocomplete = 'off'
    input.placeholder = field.configured ? 'gesetzt – zum Ändern neu eingeben' : 'nicht gesetzt'
    label.append(input, element('span', `${field.credential}${field.configured ? ' · gesetzt' + (field.source ? ' (' + field.source + ')' : '') : ' · fehlt'}`, 'secret-state'))
    form.append(label)
  }
  const footer = element('footer')
  const save = element('button', 'Speichern', 'primary small')
  footer.append(save)
  const models = element('div', '', 'models')
  if (provider.capabilities.includes('models')) {
    const load = element('button', 'Modelle laden', 'ghost')
    load.type = 'button'
    load.onclick = async () => {
      load.disabled = true
      try {
        const list = await api(`providers/${provider.id}/models`)
        models.replaceChildren(...(list.length ? list.map(model => element('code', model.id)) : [element('span', 'Keine Modelle gemeldet.', 'muted')]))
      } catch (error) { models.replaceChildren(element('span', error.message, 'form-status')) } finally { load.disabled = false }
    }
    footer.append(load)
  }
  form.append(footer, models)
  form.onsubmit = async event => {
    event.preventDefault()
    const settings = {}
    const secrets = {}
    for (const input of form.querySelectorAll('input')) {
      const [kind, key] = input.name.split(':')
      if (kind === 'setting') settings[key] = input.value
      else if (input.value) secrets[key] = input.value
    }
    try {
      const saved = await api('providers/' + provider.id, 'PUT', { settings, secrets })
      card.replaceWith(providerCard(saved))
      status(provider.title + ' gespeichert.')
    } catch (error) { fail(error) }
  }
  card.append(form)
  return card
}

async function openProviders() {
  show('view-providers')
  drawSidebar('providers')
  const list = await api('providers')
  providerCache = list
  $('provider-list').replaceChildren(...(list.length ? list.map(providerCard) : [element('p', 'Kein Anbieter-Plugin installiert.', 'empty')]))
}

// Router
async function route() {
  const version = ++routeVersion
  const hash = location.hash || '#/'
  try {
    const ideaMatch = /^#\/idea\/([0-9a-f-]{36})(\/board)?$/.exec(hash)
    if (ideaMatch) return await openIdea(ideaMatch[1], version, Boolean(ideaMatch[2]))
    teardownIdea()
    idea = null
    ideas = await api('projects')
    if (version !== routeVersion) return
    switch (hash) {
      case '#/ideas': show('view-ideas'); drawSidebar('ideas'); return drawIdeas()
      case '#/kanban': return openKanban()
      case '#/calendar': show('view-calendar'); drawSidebar('calendar'); return drawCalendar()
      case '#/journal': return await openJournal(version)
      case '#/feed': return await openFeed(version)
      case '#/todo': return await openTodo(version)
      case '#/boards': return await openBoards(version)
      case '#/mymind': case '#/inspiration': return await openCollection('clips', 'mymind')
      case '#/library': return await openCollection('generation', 'library')
      case '#/providers': return await openProviders()
      default: return await openHome(version)
    }
  } catch (error) { fail(error) }
}

$('idea-title').onchange = () => saveIdea({ title: $('idea-title').value }).then(() => drawSidebar('idea'))
$('idea-notes').oninput = () => {
  growNotes()
  clearTimeout(notesTimer)
  $('idea-saved').textContent = 'Ungespeichert …'
  const value = $('idea-notes').value
  notesTimer = setTimeout(() => saveIdea({ notes: value }), 800)
}
$('idea-status').onchange = () => saveIdea({ status: $('idea-status').value })
$('idea-due').onchange = () => saveIdea({ due: $('idea-due').value })
$('idea-pin').onclick = () => saveIdea({ pinned: !idea.pinned }).then(() => { drawPin(); drawSidebar('idea') })
$('add-app').onchange = () => { const id = $('add-app').value; if (id) { ideaTab = id; setApps([...idea.apps, id]) } }
$('board-open').onclick = async () => {
  const current = idea
  try {
    const module = await loadBoard()
    if (idea?.id !== current.id) return
    $('board-editor').hidden = false
    $('board-actions').hidden = false
    editor = module.mount($('board-editor'), idea.scene)
  } catch (error) { fail(error) }
}
const closeBoard = () => { editor?.unmount(); editor = null; $('board-editor').hidden = true; $('board-actions').hidden = true }
$('board-close').onclick = closeBoard
$('board-save').onclick = async () => {
  const scene = editor?.scene()
  if (!scene) return
  await saveIdea({ scene })
  status('Board gespeichert.')
  closeBoard()
  drawBoardPreview().catch(fail)
}
$('idea-search').oninput = drawIdeas
$('kanban-search').oninput = drawKanban
$('kanban-format').onchange = drawKanban
$('calendar-prev').onclick = () => { calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1); drawCalendar() }
$('calendar-next').onclick = () => { calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1); drawCalendar() }
$('calendar-today').onclick = () => { calendarMonth = new Date(); drawCalendar() }
$('search').oninput = () => drawAssets().catch(fail)
$('new-asset').onclick = () => openAsset()
$('view-grid').onclick = () => { rowsView = false; $('view-grid').setAttribute('aria-pressed', 'true'); $('view-rows').setAttribute('aria-pressed', 'false'); drawAssets().catch(fail) }
$('view-rows').onclick = () => { rowsView = true; $('view-grid').setAttribute('aria-pressed', 'false'); $('view-rows').setAttribute('aria-pressed', 'true'); drawAssets().catch(fail) }
$('composer').onsubmit = generate
$('composer-provider').onchange = () => loadModels()
$('apps-edit').onclick = () => { editingApps = !editingApps; drawSidebar(currentRoute()) }
for (const id of ['nav-new', 'ideas-new', 'kanban-new']) $(id).onclick = openNewIdea
$('nav-search').onclick = () => {
  if (!$('view-collection').hidden) return $('search').focus()
  if (location.hash !== '#/ideas') location.hash = '#/ideas'
  setTimeout(() => $('idea-search').focus(), 80)
}
document.addEventListener('keydown', event => {
  if ((event.metaKey || event.ctrlKey) && event.key === 'k') { event.preventDefault(); $('nav-search').click() }
})
for (const button of document.querySelectorAll('[data-close]')) button.onclick = () => button.closest('dialog').close()
$('idea-form').onsubmit = event => submitForm(event, async data => {
  const created = await api('projects', 'POST', { title: data.get('title'), snapshot: pickedSnapshot })
  $('idea-dialog').close()
  ideas = await api('projects')
  location.hash = '#/idea/' + created.id
})
$('asset-form').onsubmit = event => submitForm(event, async (data, form) => {
  const payload = Object.fromEntries(['title', 'source', 'preview', 'description'].map(key => [key, data.get(key)]))
  payload.library = form.dataset.library
  const file = data.get('file')
  if (file.size) { payload.mediaType = file.type; payload.media = await readFile(file) }
  await api('assets', 'POST', payload)
  $('asset-dialog').close()
  status('Gespeichert.')
  await drawAssets()
})
window.addEventListener('hashchange', route)

async function start() {
  withIcons(document)
  let clip
  if (location.hash.startsWith('#clip=')) {
    clip = JSON.parse(decodeURIComponent(location.hash.slice(6)))
    history.replaceState(null, '', location.pathname + '#/mymind')
  }
  let sidebar
  ;[apps, snapshots, ideas, sidebar, providerCache] = await Promise.all([api('apps'), api('snapshots'), api('projects'), api('sidebar'), api('providers')])
  sidebarApps = Array.isArray(sidebar.apps) ? sidebar.apps : null
  await route()
  if (clip) { collection = 'clips'; openAsset(clip) }
}
start().catch(fail)
