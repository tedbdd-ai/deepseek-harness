const base = '/creativity-hub'
const $ = id => document.getElementById(id)
const status = message => { $('status').textContent = message }
let projects = []
let currentProject = null
let view = 'clips'
let editor
let listVersion = 0
let viewVersion = 0
let boardModule

async function api(path, method = 'GET', body) {
  const response = await fetch(base + '/api/' + path, {
    method,
    ...(body && { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error || 'Anfrage fehlgeschlagen.')
  return result
}

function element(tag, content, className) {
  const node = document.createElement(tag)
  if (content) node.textContent = content
  if (className) node.className = className
  return node
}

function card(asset) {
  const article = element('article')
  if (asset.media_type || asset.preview) {
    const media = element(asset.media_type?.startsWith('video/') ? 'video' : 'img')
    media.src = asset.media_type ? base + '/api/media/' + asset.id : asset.preview
    if (media.tagName === 'VIDEO') { media.controls = true; media.preload = 'metadata' }
    else { media.alt = ''; media.loading = 'lazy'; media.referrerPolicy = 'no-referrer' }
    article.append(media)
  }
  const body = element('div', '', 'card-body')
  body.append(element('h3', asset.title))
  if (asset.source) {
    const link = element('a', new URL(asset.source).hostname, 'meta')
    link.href = asset.source
    link.target = '_blank'
    link.rel = 'noreferrer'
    body.append(link)
  }
  if (asset.description) body.append(element('p', asset.description))
  if (projects.length) {
    const select = element('select')
    select.setAttribute('aria-label', asset.title + ' einem Projekt zuordnen')
    select.append(new Option('Projekt zuweisen …', ''))
    for (const project of projects) select.append(new Option(project.title, project.id))
    select.addEventListener('change', async () => {
      if (!select.value) return
      try {
        await api('assign', 'POST', { id: asset.id, projectId: select.value })
        status('Dem Projekt zugeordnet.')
      } catch (error) { status(error.message) }
      select.value = ''
    })
    body.append(select)
  }
  article.append(body)
  return article
}

async function showAssets() {
  const version = ++listVersion
  const params = new URLSearchParams({ q: $('search').value })
  if (view === 'project') params.set('project', currentProject.id)
  else params.set('library', view)
  const entries = await api('assets?' + params)
  if (version !== listVersion) return
  $('assets').replaceChildren(...(entries.length ? entries.map(card) : [element('p', 'Keine Einträge.', 'empty')]))
}

async function showProjects() {
  projects = await api('projects')
  $('projects').replaceChildren(...projects.map(project => {
    const button = element('button', project.title)
    button.dataset.project = project.id
    button.onclick = () => showView('project', project.id).catch(error => status(error.message))
    return button
  }))
}

async function showView(kind, id) {
  const version = ++viewVersion
  const nextProject = kind === 'project' ? await api('projects/' + id) : null
  if (version !== viewVersion) return
  view = kind
  editor?.unmount()
  editor = null
  $('board-editor').hidden = $('save-board').hidden = true
  $('open-board').hidden = false
  $('board-preview').replaceChildren()
  currentProject = nextProject
  $('project-detail').hidden = kind !== 'project'
  $('notes').value = currentProject?.notes ?? ''
  $('view-title').textContent = currentProject?.title ?? (kind === 'clips' ? 'Clips' : 'Generation Library')
  $('new-asset').textContent = kind === 'generation' ? 'Datei importieren' : 'Clip hinzufügen'
  $('search').value = ''
  for (const button of document.querySelectorAll('nav button')) {
    button.setAttribute('aria-pressed', String(button.dataset.view === kind || (Boolean(id) && button.dataset.project === id)))
  }
  status('')
  await showAssets()
  showBoardPreview().catch(error => status(error.message))
}

function openAsset(data = {}) {
  const form = $('asset-form')
  form.reset()
  form.querySelector('.form-status').textContent = ''
  form.dataset.library = view === 'generation' ? 'generation' : 'clips'
  form.dataset.project = currentProject?.id ?? ''
  const clip = form.dataset.library === 'clips'
  $('asset-title').textContent = clip ? 'Clip hinzufügen' : 'Datei importieren'
  $('asset-file').hidden = clip
  form.elements.source.required = clip
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
  try { await submit(new FormData(form), form) } catch (error) { feedback.textContent = error.message }
  finally { button.disabled = false }
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

async function showBoardPreview() {
  const project = currentProject
  if (!project) return
  if (!project.scene.elements.length) {
    $('board-preview').replaceChildren(element('p', 'Das Storyboard ist leer.', 'empty'))
    return
  }
  const module = await loadBoard()
  const preview = await module.preview(project.scene)
  if (currentProject === project) $('board-preview').replaceChildren(preview)
}

$('open-board').onclick = async () => {
  const project = currentProject
  $('open-board').disabled = true
  try {
    const module = await loadBoard()
    if (project !== currentProject) return
    $('board-editor').hidden = $('save-board').hidden = false
    $('open-board').hidden = true
    editor = module.mount($('board-editor'), project.scene)
  } catch (error) { status(error.message) }
  finally { $('open-board').disabled = false }
}

async function saveProject(changes, success) {
  const project = currentProject
  if (!project) return
  try {
    const saved = await api('projects/' + project.id, 'PUT', { revision: project.revision, ...changes })
    if (currentProject?.id === project.id) {
      currentProject = saved
      status(success)
      await showBoardPreview()
    }
  } catch (error) { status(error.message) }
}

$('save-board').onclick = () => {
  const scene = editor?.scene()
  if (scene) saveProject({ scene }, 'Storyboard gespeichert.')
}
$('notes-form').onsubmit = event => {
  event.preventDefault()
  saveProject({ notes: $('notes').value }, 'Notiz gespeichert.')
}
$('new-asset').onclick = () => openAsset()
$('new-project').onclick = () => {
  $('project-form').reset()
  $('project-form').querySelector('.form-status').textContent = ''
  $('project-dialog').showModal()
}
$('project-form').onsubmit = event => submitForm(event, async data => {
  const project = await api('projects', 'POST', { title: data.get('title') })
  $('project-dialog').close()
  await showProjects()
  await showView('project', project.id)
})
$('asset-form').onsubmit = event => submitForm(event, async (data, form) => {
  const payload = Object.fromEntries(['title', 'source', 'preview', 'description'].map(key => [key, data.get(key)]))
  payload.library = form.dataset.library
  const file = data.get('file')
  if (payload.library === 'generation' && file.size) {
    if (file.size > 12 * 1024 * 1024) throw new Error('Die Datei ist größer als 12 MB.')
    payload.mediaType = file.type
    payload.media = await new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result.split(',')[1])
      reader.onerror = () => reject(new Error('Die Datei konnte nicht gelesen werden.'))
      reader.readAsDataURL(file)
    })
  }
  if (form.dataset.project) payload.projectId = form.dataset.project
  await api('assets', 'POST', payload)
  $('asset-dialog').close()
  status('Gespeichert.')
  await showAssets()
})
for (const button of document.querySelectorAll('[data-view]')) button.onclick = () => showView(button.dataset.view).catch(error => status(error.message))
for (const button of document.querySelectorAll('[data-close]')) button.onclick = () => button.closest('dialog').close()
$('search').oninput = () => showAssets().catch(error => status(error.message))

async function start() {
  if (location.hash.startsWith('#clip=')) {
    const clip = JSON.parse(decodeURIComponent(location.hash.slice(6)))
    history.replaceState(null, '', location.pathname + location.search)
    openAsset(clip)
  }
  await showProjects()
  await showAssets()
}
start().catch(error => status(error.message))
