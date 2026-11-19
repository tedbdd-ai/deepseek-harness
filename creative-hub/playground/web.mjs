/**
 * Browser module of the Playground plugin, loaded by the hub as a page (`#/playground`).
 * The hub passes its shared building blocks through `renderView(ctx)`; the plugin owns this UI.
 */
let $, openImage, API, api, chev, currentRoute, dateLabel, el, errorState, fullscreenButton, header, icon, icons, loading, media, refreshCounts, state, tile, timeLabel, toast, view, withFullscreen

/** Called by the hub on every visit; renders the whole view. */
export function renderView(ctx) {
  ;({ '$': $, openImage, API, api, chev, currentRoute, dateLabel, el, errorState, fullscreenButton, header, icon, icons, loading, media, refreshCounts, state, tile, timeLabel, toast, view, withFullscreen } = ctx)
  Object.assign(icons, icons2)
  return renderPlayground()
}

/** Called by the hub when the user leaves the page. */
export function leave() { clearTimeout(pg.timer) }

const PG = '/creativity-playground/api'
const pgApi = (path, method, body) => fetch(PG + path, { method: method || 'GET', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined })
  .then(async r => { const text = await r.text(); const data = text ? JSON.parse(text) : null; if (!r.ok) throw new Error(data?.error || `Der Playground antwortet mit ${r.status}.`); return data })
const stored = key => { try { return JSON.parse(localStorage.getItem('atelier:' + key)) } catch { return null /* Speicher gesperrt oder leer: Standardwerte. */ } }
const store = (key, value) => { try { localStorage.setItem('atelier:' + key, JSON.stringify(value)) } catch { /* Ohne Browser-Speicher geht die Auswahl beim Neuladen verloren. */ } }
/** Folds parameters saved per mode (older key `["<model>","text"|"edit","<variant>"]`) into one entry per model. */
function migrateParams(saved) {
  const merged = {}
  for (const [key, values] of Object.entries(saved)) {
    let id = key
    try { const parsed = JSON.parse(key); if (Array.isArray(parsed)) id = parsed[0] } catch { /* Schon ein Modellschlüssel. */ }
    merged[id] = { ...merged[id], ...values }
  }
  return merged
}
const pg = { models: [], runs: [], modelId: stored('models')?.[0] ?? null, modelIds: stored('models') ?? [], refs: [], studio: {}, modelParams: migrateParams(stored('modelParams') ?? {}), prompt: '', params: stored('params') ?? {}, count: 1, projectId: stored('project') ?? '', timer: null }
function selectModel(id) {
  pg.modelIds = id ? [id] : []
  pg.modelId = id ?? null
  store('models', pg.modelIds)
}

/** Adds or removes a model from the comparison; the first selected model is the primary one. */
function toggleModel(id) {
  pg.modelIds = pg.modelIds.includes(id) ? pg.modelIds.filter(m => m !== id) : [...pg.modelIds, id]
  pg.modelId = pg.modelIds[0] ?? null
  store('models', pg.modelIds)
}

const referenceMark = /@Bild([1-9]\d*)\b/gi

function removeReferenceMarks(text, labels) {
  return text.split('\n').flatMap(line => {
    const withoutEmptyListEntries = line.replace(/@Bild[1-9]\d*\b(?:[ \t]*[,;][ \t]*@Bild[1-9]\d*\b)+/gi, list => {
      const entries = [...list.matchAll(referenceMark)]
      if (entries.every(([, number]) => !labels.has(Number(number)))) return list
      return entries.filter(([, number]) => !labels.has(Number(number))).map(([mark]) => mark).join(', ')
    })
    const updated = withoutEmptyListEntries.replace(referenceMark, (mark, number) => labels.has(Number(number)) ? '' : mark)
    if (updated === line) return [line]
    const cleaned = updated.replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+([,.;!?])/g, '$1').trimEnd()
    return /^\s*(?:Bildquellen:\s*)?$/.test(cleaned) ? [] : [cleaned]
  }).join('\n')
}

function updateReferences(ids) {
  const next = new Set(ids)
  const removed = pg.refs.filter(id => !next.has(id))
  const labels = new Set(removed.map(id => pg.studio.referenceLabels?.[id]))
  if (removed.length) {
    pg.prompt = removeReferenceMarks(pg.prompt, labels)
    for (const id of removed) {
      delete pg.studio.roles?.[id]
      delete pg.studio.referenceLabels?.[id]
    }
  }
  pg.refs = ids
  redrawComposer()
}

function syncReferenceLabels() {
  const previous = pg.studio.referenceLabels ?? {}
  const used = new Set([...pg.prompt.matchAll(referenceMark)].map(match => Number(match[1])))
  const labels = Object.fromEntries(Object.entries(previous).filter(([id, number]) => pg.refs.includes(id) || used.has(number)))
  const reserved = new Set([...used, ...Object.values(labels)])
  let next = 1
  for (const id of pg.refs) {
    if (previous[id]) {
      labels[id] = previous[id]
      continue
    }
    while (reserved.has(next)) next++
    labels[id] = next
    reserved.add(next++)
  }
  pg.studio.referenceLabels = labels
}

const assetCache = new Map()
async function assetById(id) {
  if (!assetCache.has(id)) {
    const [clips, gens] = await Promise.all([api('/assets?library=clips'), api('/assets?library=generation')])
    for (const item of [...clips, ...gens]) assetCache.set(item.id, item)
  }
  return assetCache.get(id)
}
// Parameters belong to the model, not to the mode: a format chosen for text-to-image also applies once an image is attached.
const paramKey = m => m.id
const taskNow = () => pg.refs.length ? 'edit' : 'text'
const minutes = ms => { const s = Math.round(ms / 1000); return s < 60 ? `${s} s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} min` }
const ago = iso => { const s = (Date.now() - new Date(iso)) / 1000; return s < 60 ? 'gerade eben' : s < 3600 ? `vor ${Math.round(s / 60)} Minuten` : dateLabel(iso) + ', ' + timeLabel(iso) }
const icons2 = {
  lock: '<rect width="16" height="11" x="4" y="11" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  unlock: '<rect width="16" height="11" x="4" y="11" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.5-2"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-1"/>',
  folder: '<path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9l-.8-1.2A2 2 0 0 0 7.9 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/><path d="M12 10v6"/><path d="M9 13h6"/>',
  variant: '<path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/>',
  retry: '<path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  clip: '<path d="m21.4 11-8.6 8.6a6 6 0 0 1-8.5-8.5l8.6-8.6a4 4 0 0 1 5.7 5.7l-8.6 8.6a2 2 0 0 1-2.8-2.8l8-8"/>',
  edit: '<path d="M12 20h9"/><path d="M16.4 3.6a2 2 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  text: '<path d="M4 7V4h16v3"/><path d="M9 20h6"/><path d="M12 4v16"/>',
  sliders: '<path d="M4 21v-7"/><path d="M4 10V3"/><path d="M12 21v-9"/><path d="M12 8V3"/><path d="M20 21v-5"/><path d="M20 12V3"/><path d="M2 14h4"/><path d="M10 8h4"/><path d="M18 16h4"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
}

async function renderPlayground() {
  const ref = new URLSearchParams(location.hash.split('?')[1] || '').get('ref')
  if (ref && pg.refs.length < 16 && !pg.refs.includes(ref)) pg.refs.push(ref)
  const feed = el('div', { class: 'pg-feed' }, el('div', { class: 'skel', style: 'height:220px' }))
  const projectSel = el('select', { 'aria-label': 'Ziel-Projekt', onchange: e => { pg.projectId = e.target.value; store('project', pg.projectId) } },
    el('option', { value: '' }, 'Kein Projekt'), state.projects.map(p => el('option', { value: p.id, selected: p.id === pg.projectId || null }, p.title)))
  const tools = el('div', { class: 'tools' }, el('label', { class: 'pill' }, el('span', { class: 'meta' }, 'Ziel'), projectSel, chev()), el('button', { type: 'button', class: 'btn sm', onclick: modelsDialog }, 'Modelle verwalten'))
  view.replaceChildren(...header('Playground', null, tools), el('div', { class: 'pg' }, feed, composer()))
  try {
    ;[pg.models, pg.runs] = await Promise.all([pgApi('/models'), pgApi('/runs')])
    pg.modelIds = pg.modelIds.filter(id => pg.models.some(m => m.id === id))
    pg.modelId = pg.modelIds[0] ?? null
    if (!pg.modelId) selectModel(pg.models[0]?.id)
    drawFeed(feed)
    redrawComposer()
  } catch (error) { feed.replaceChildren(errorState(error, renderPlayground)) }
}

function drawFeed(feed = $('.pg-feed')) {
  if (!feed) return
  if (!pg.models.length) {
    const url = el('input', { class: 'text-in', type: 'url', placeholder: 'https://kie.ai/gpt-image-2-6', 'aria-label': 'Adresse der Modellseite' })
    feed.replaceChildren(el('div', { class: 'state' }, icon('wand'), el('h2', {}, 'Füge dein erstes Modell hinzu'),
      el('p', {}, 'Füge eine Modellseite von Kie.ai oder fal.ai ein. Unter „Modelle verwalten“ findest du auch die Kataloge deiner Anbieter.'),
      el('form', { style: 'display:flex;gap:8px;width:100%', onsubmit: async e => { e.preventDefault(); await addModel(url.value, e.submitter) } }, url, el('button', { class: 'btn primary', type: 'submit' }, 'Hinzufügen'))))
    return
  }
  if (!pg.runs.length) { feed.replaceChildren(el('div', { class: 'state' }, icon('wand'), el('h2', {}, 'Noch kein Lauf'), el('p', {}, 'Schreib einen Prompt und hänge bei Bedarf Bilder an. Scrabble würfelt Bildregie und Referenzrollen.'))); return }
  feed.replaceChildren(...pg.runs.map(runRow))
  clearTimeout(pg.timer)
  if (pg.runs.some(run => run.results.some(r => r.status === 'running'))) pg.timer = setTimeout(pollRuns, 2500)
}

async function pollRuns() {
  if (currentRoute() !== 'playground') return
  try { pg.runs = await pgApi('/runs'); assetCache.clear(); drawFeed(); refreshCounts() } catch { pg.timer = setTimeout(pollRuns, 5000) /* Netzfehler: später erneut. */ }
}

function runRow(run) {
  const credits = run.results.reduce((sum, r) => sum + (r.credits || 0), 0)
  const refs = el('div', { style: 'display:flex;gap:8px' })
  run.referenceIds.forEach(async id => { const item = await assetById(id); if (item) refs.append(withFullscreen(item, el('span', { class: 'ref-thumb' }, media(item)))) })
  const card = el('div', { class: 'pg-card' },
    el('div', { class: 'task' }, icon(run.task === 'edit' ? 'edit' : 'text'), run.task === 'edit' ? 'Bild bearbeiten' : 'Text zu Bild'),
    el('div', { class: 'meta' }, `${new Set(run.results.map(r => r.modelId)).size} Modell${new Set(run.results.map(r => r.modelId)).size === 1 ? '' : 'e'} · ${ago(run.createdAt)}`),
    el('p', { class: 'prompt' }, run.prompt),
    run.results.some(r => r.sentPrompt && r.sentPrompt !== run.prompt) ? el('details', {}, el('summary', {}, 'Gesendete Bildregie'), [...new Set(run.results.map(r => r.sentPrompt).filter(Boolean))].map(text => el('p', { class: 'direction-text' }, text))) : null,
    run.referenceIds.length ? refs : null,
    credits ? el('div', { class: 'meta', style: 'display:flex;justify-content:space-between' }, el('span', {}, 'Verbraucht'), el('span', { style: 'color:var(--c-ink)' }, `${credits} Credits`)) : null,
    el('div', { style: 'display:flex;gap:8px' },
      el('button', { type: 'button', class: 'icon', 'aria-label': 'Erneut ausführen', title: 'Erneut ausführen', onclick: () => rerun(run) }, icon('retry')),
      el('button', { type: 'button', class: 'icon', 'aria-label': 'In die Eingabe übernehmen', title: 'In die Eingabe übernehmen', onclick: () => { pg.params = run.params ?? {}; pg.modelParams = structuredClone(run.modelParams ?? {}); pg.studio = structuredClone(run.studio ?? {}); pg.studio.referenceLabels ??= Object.fromEntries(run.referenceIds.map((id, i) => [id, i + 1])); pg.count = run.count ?? 1; pg.scrabbleUndo = null; pg.prompt = run.prompt; pg.refs = [...run.referenceIds]; selectModel(run.results.find(r => pg.models.some(m => m.id === r.modelId))?.modelId ?? pg.modelId); redrawComposer() } }, icon('copy'))))
  const grid = el('div', { class: 'pg-results' })
  for (const result of run.results) {
    if (result.status === 'done') for (const id of result.assetIds) grid.append(resultTile(run, result, id))
    else grid.append(result.status === 'running'
      ? el('figure', { class: 'pg-fig' }, el('div', { class: 'pg-wait', 'aria-busy': 'true' }, el('span', {}, `Läuft bei ${result.provider} · ${minutes(Date.now() - new Date(run.createdAt))}`)), caption(result))
      : el('figure', { class: 'pg-fig' }, el('div', { class: 'pg-fail' }, el('b', {}, 'Nicht fertig geworden'), el('span', {}, result.error), result.detail && el('details', { class: 'meta' }, el('summary', {}, 'Antwort des Anbieters'), el('span', {}, result.detail)),
        result.retry === false
          ? el('button', { type: 'button', class: 'btn sm', onclick: () => { pg.prompt = run.prompt; pg.refs = [...run.referenceIds]; redrawComposer(); $('#pg-prompt')?.focus() } }, 'Prompt bearbeiten')
          : el('button', { type: 'button', class: 'btn sm', onclick: () => rerun(run, result.modelId) }, 'Erneut versuchen')), caption(result)))
  }
  return el('section', { class: 'pg-run', 'aria-label': run.prompt.slice(0, 60) }, card, grid)
}

const caption = (result, extra = '') => el('figcaption', {}, el('span', { class: 'm' }, result.title), el('span', { class: 'meta' }, [result.provider, result.ms ? minutes(result.ms) : '', result.credits ? result.credits + ' Credits' : '', extra].filter(Boolean).join(' · ')))

function resultTile(run, result, id) {
  const url = `${API}/media/${id}`
  const title = `${result.title}: ${run.prompt.slice(0, 80)}`
  // A result deleted from the Library stays in the run history; show that instead of a broken image.
  const pic = el('div', { class: 'tile-r' }, el('img', { src: url, alt: title, loading: 'lazy', onerror: e => { const box = e.target.closest('.pg-fig'); box?.replaceChildren(el('div', { class: 'pg-wait' }, el('span', {}, 'Aus der Library gelöscht')), caption(result)) } }))
  const actions = el('div', { class: 'tile-acts', role: 'group', 'aria-label': `${result.title}: Bildaktionen` },
      fullscreenButton(url, title),
      el('button', { type: 'button', class: 'icon', 'aria-label': 'In ein Projekt', title: 'In ein Projekt', onclick: () => assignDialog(id) }, icon('folder')),
      el('button', { type: 'button', class: 'icon', 'aria-label': 'Als Referenz verwenden', title: 'Als Referenz verwenden', onclick: () => { if (pg.refs.length >= 16 && !pg.refs.includes(id)) return toast('Du kannst höchstens 16 Bilder anhängen.', true); if (!pg.refs.includes(id)) pg.refs.push(id); redrawComposer(); toast('Als Referenz in der Eingabe.') } }, icon('image')),
      el('button', { type: 'button', class: 'icon', 'aria-label': 'Variante erzeugen', title: 'Variante erzeugen', onclick: () => { pg.studio = { ...run.studio, roles: { [id]: 'Ausgangsbild' }, referenceLabels: { [id]: 1 } }; pg.modelParams = structuredClone(run.modelParams ?? {}); pg.params = run.params ?? {}; pg.refs = [id]; pg.scrabbleUndo = null; pg.prompt = /@Bild[1-9]\d*\b/i.test(run.prompt) ? 'Bearbeite @Bild1. ' : 'Bearbeite @Bild1. ' + run.prompt; if (pg.models.some(m => m.id === result.modelId)) selectModel(result.modelId); redrawComposer(); $('#pg-prompt')?.focus() } }, icon('variant')),
      el('a', { class: 'icon', href: `${API}/media/${id}`, download: result.title, 'aria-label': 'Herunterladen', title: 'Herunterladen' }, icon('down')))
  const inProjects = [...(state.members.get(id) ?? [])].map(pid => state.projects.find(p => p.id === pid)?.title).filter(Boolean)
  // Actions overlay the image (hover or keyboard focus); a click on the image opens it large.
  pic.append(actions)
  pic.querySelector('img').addEventListener('click', () => openImage(url, title))
  return el('figure', { class: 'pg-fig' }, pic, caption(result, inProjects.length ? 'in ' + inProjects.join(', ') : ''))
}

async function rerun(run, modelId) {
  try {
    const created = await pgApi('/runs', 'POST', { prompt: run.prompt, modelIds: modelId ? [modelId] : [...new Set(run.results.map(r => r.modelId))], referenceIds: run.referenceIds, params: run.params, modelParams: run.modelParams, studio: studioForRun(run.studio), count: modelId ? 1 : run.count, projectId: run.projectId || undefined })
    pg.runs.unshift(created); drawFeed()
  } catch (error) { toast(error.message, true) }
}

function assignDialog(assetId) {
  const sel = el('select', { 'aria-label': 'Projekt' }, state.projects.map(p => el('option', { value: p.id, selected: p.id === pg.projectId || null }, p.title)))
  if (!state.projects.length) return toast('Lege zuerst links ein Projekt an.', true)
  const dialog = el('dialog', {}, el('form', { method: 'dialog' }, el('h2', {}, 'In ein Projekt'), el('span', { class: 'pill', style: 'align-self:flex-start' }, sel, chev()),
    el('div', { class: 'row' }, el('button', { class: 'btn ghost', value: 'no' }, 'Abbrechen'), el('button', { class: 'btn primary', value: 'yes' }, 'Zuordnen'))))
  dialog.addEventListener('close', async () => {
    if (dialog.returnValue === 'yes') {
      try { await api('/assign', 'POST', { id: assetId, projectId: sel.value }); if (!state.members.has(assetId)) state.members.set(assetId, new Set()); state.members.get(assetId).add(sel.value); toast('Im Projekt.'); drawFeed() } catch (error) { toast(error.message, true) }
    }
    dialog.remove()
  })
  document.body.append(dialog); dialog.showModal()
}

async function addModel(url, button) {
  if (!url.trim()) return
  if (button) { button.disabled = true; button.textContent = 'Liest …' }
  try {
    const added = []
    const errors = []
    for (const address of new Set(url.trim().split(/\s+/))) {
      try { added.push(...await pgApi('/models', 'POST', { url: address })) }
      catch (error) { errors.push(address + ' · ' + error.message) }
    }
    pg.models = await pgApi('/models')
    if (!pg.modelId && added.length) selectModel(added[0].id)
    toast(added.length === 1 ? `${added[0].title} ist im Playground.` : `${added.length} Modelle sind im Playground.`)
    drawFeed(); redrawComposer()
    if (errors.length) { toast(errors.join(' · '), true); return false }
    return added
  } catch (error) { toast(error.message, true) } finally { if (button) { button.disabled = false; button.textContent = 'Hinzufügen' } }
}

function modelLabel(model) {
  const modes = [model.variants.text && 'Text zu Bild', model.variants.edit && 'Bild bearbeiten']
  return [el('span', {}, model.title), el('span', { class: 'meta' }, [model.providerTitle, ...modes].filter(Boolean).join(' · '))]
}

function modelPicker(label, onSelection) {
  const list = el('div', { id: 'pg-model-picker', class: 'pg-model-picker pg-models', popover: 'auto', role: 'group', 'aria-label': 'Modelle wählen, mehrere für einen Vergleich' },
    pg.models.length ? pg.models.map(model => el('label', { class: 'pg-model' },
      el('input', { type: 'checkbox', checked: pg.modelIds.includes(model.id), onchange: () => {
        toggleModel(model.id)
        onSelection()
      } }),
      el('span', { class: 'pg-model-label' }, modelLabel(model))))
      : el('p', { class: 'meta' }, 'Füge unter „Modelle verwalten“ ein Modell hinzu.'))
  const trigger = el('button', { id: 'pg-model-trigger', type: 'button', class: 'pill', popovertarget: list.id },
    label, chev())
  list.addEventListener('beforetoggle', event => {
    if (event.newState !== 'open') return
    const rect = trigger.getBoundingClientRect()
    const width = Math.min(360, document.documentElement.clientWidth - 32)
    list.style.width = width + 'px'
    list.style.left = Math.min(rect.left, document.documentElement.clientWidth - width - 16) + 'px'
    list.style.bottom = window.innerHeight - rect.top + 8 + 'px'
    list.style.maxHeight = Math.max(48, Math.min(rect.top - 24, window.innerHeight / 2)) + 'px'
  })
  return [trigger, list]
}

function modelsDialog() {
  const list = el('div', { class: 'pg-models' })
  const draw = () => list.replaceChildren(...(pg.models.length ? pg.models.map(m => el('div', { class: 'pg-model' },
    el('div', { class: 'pg-model-label' }, modelLabel(m)),
    m.page && el('a', { class: 'icon', href: m.page, target: '_blank', rel: 'noopener noreferrer', 'aria-label': `${m.title} beim Anbieter öffnen`, title: 'Beim Anbieter öffnen' }, icon('open')),
    el('button', { type: 'button', class: 'icon', 'aria-label': `${m.title} entfernen`, title: 'Entfernen', onclick: async () => { try { await pgApi('/models/' + encodeURIComponent(m.id), 'DELETE'); pg.models = pg.models.filter(x => x.id !== m.id); if (pg.modelId === m.id) selectModel(pg.models[0]?.id); draw(); drawFeed(); redrawComposer() } catch (error) { toast(error.message, true) } } }, icon('trash'))))
    : [el('p', { class: 'meta', style: 'margin:0' }, 'Noch keine Modelle.')]))
  draw()
  const url = el('textarea', { class: 'text-in', rows: 2, placeholder: 'Eine Modelladresse pro Zeile', 'aria-label': 'Modelladressen' })
  const addBtn = el('button', { type: 'button', class: 'btn sm', onclick: async () => { if (await addModel(url.value, addBtn)) url.value = ''; draw() } }, 'Hinzufügen')
  const catalog = el('div', { class: 'pg-fields' })
  const provider = el('select', { class: 'text-in', 'aria-label': 'Bildanbieter' }, el('option', { value: '' }, 'Anbieter wählen'))
  const model = el('select', { class: 'text-in', 'aria-label': 'Katalogmodell' })
  const importBtn = el('button', { type: 'button', class: 'btn sm', disabled: true, onclick: async () => {
    importBtn.disabled = true
    try {
      const [added] = await pgApi('/models', 'POST', { provider: provider.value, modelId: model.value })
      pg.models = await pgApi('/models')
      if (!pg.modelId) selectModel(added.id)
      draw(); drawFeed(); redrawComposer()
    } catch (error) { toast(error.message, true) }
    finally { importBtn.disabled = !model.value }
  } }, 'Aus Katalog hinzufügen')
  provider.onchange = async () => {
    const id = provider.value
    model.replaceChildren()
    importBtn.disabled = true
    if (!id) return
    try {
      const options = await api('/providers/' + id + '/models')
      if (provider.value !== id) return
      model.replaceChildren(...options.map(o => el('option', { value: o.id }, o.title)))
      importBtn.disabled = !model.value
    } catch (error) { toast(error.message, true) }
  }
  api('/providers').then(providers => {
    const sources = providers.filter(p => p.capabilities.includes('models') && p.capabilities.includes('generate'))
    if (sources.length) {
      provider.append(...sources.map(p => el('option', { value: p.id }, p.title)))
      catalog.append(el('label', { class: 'field' }, el('span', {}, 'Anbieterkatalog'), provider), model, importBtn)
    }
  }).catch(error => toast(error.message, true))
  const dialog = el('dialog', { style: 'width:min(560px, calc(100vw - 32px))' }, el('form', { method: 'dialog' },
    el('h2', {}, 'Modelle'), list, catalog,
    el('label', { class: 'field' }, el('span', {}, 'Modellseiten von Kie.ai oder fal.ai'), el('div', { style: 'display:flex;gap:8px' }, url, addBtn)),
    el('div', { class: 'row' }, el('button', { class: 'btn primary', value: 'ok' }, 'Fertig'))))
  dialog.addEventListener('close', () => dialog.remove())
  document.body.append(dialog); dialog.showModal()
}

function editor(title, sections, save, reset) {
  const dialog = el('dialog', { class: 'pg-editor' }, el('form', { method: 'dialog' },
    el('h2', {}, title), sections, el('div', { class: 'row' },
      el('button', { class: 'btn ghost', value: 'reset', formnovalidate: true }, 'Zurücksetzen'),
      el('button', { class: 'btn primary', value: 'ok' }, 'Übernehmen'))))
  dialog.addEventListener('close', () => {
    if (dialog.returnValue === 'ok') save()
    if (dialog.returnValue === 'reset') reset()
    redrawComposer()
    dialog.remove()
  })
  document.body.append(dialog)
  dialog.showModal()
}

function parameterInput(field, value) {
  const options = field.type === 'boolean' ? ['true', 'false'] : field.options
  const input = options ? el('select', { class: 'text-in' },
    el('option', { value: '' }, 'Modellstandard' + (field.default == null ? '' : ' · ' + field.default)),
    options.map(value => el('option', { value }, field.type === 'boolean' ? (value === 'true' ? 'Ein' : 'Aus') : value)))
    : el('input', { class: 'text-in', type: field.type === 'text' ? 'text' : 'number', placeholder: field.default ?? 'Modellstandard', min: field.min, max: field.max, step: field.type === 'integer' ? 1 : 'any' })
  input.value = value ?? ''
  return input
}

function parameterValue(field, input) {
  if (field.type === 'boolean') return input.value === 'true'
  if (['number', 'integer'].includes(field.type)) return Number(input.value)
  return input.value
}

function settingsDialog() {
  const readers = []
  const sections = pg.models.filter(m => pg.modelIds.includes(m.id)).map(m => {
    const variant = m.variants[taskNow()]
    if (!variant) return el('p', {}, m.title + ' unterstützt diesen Bildmodus nicht.')
    const values = pg.modelParams[paramKey(m)] ?? pg.params
    const controls = []
    const fields = variant.fields.filter(f => !['prompt', 'image', 'images'].includes(f.type))
    readers.push([paramKey(m), controls])
    return el('section', { class: 'pg-fields' }, el('h3', {}, m.title + ' · ' + m.providerTitle), fields.length ? fields.map(f => {
      const input = parameterInput(f, values[f.key])
      controls.push([f, input])
      return el('label', { class: 'field' }, el('span', {}, f.label), input, f.description && el('small', { class: 'meta' }, f.description))
    }) : el('p', { class: 'meta' }, 'Keine weiteren Parameter.'))
  })
  const persist = () => store('modelParams', pg.modelParams)
  editor('Modelleinstellungen', sections.length ? sections : [el('p', {}, 'Wähle zuerst ein Modell.')], () => {
    for (const [id, controls] of readers) {
      pg.modelParams[id] = Object.fromEntries(controls.filter(([, input]) => input.value !== '').map(([f, input]) =>
        [f.key, parameterValue(f, input)]))
    }
    persist()
  }, () => { for (const [id] of readers) pg.modelParams[id] = {}; persist() })
}

const directionFields = [
  ['angle', 'Kamerawinkel', ['Augenhöhe', 'Bodennähe', 'Vogelperspektive', 'Dreiviertelansicht', 'Seitenansicht']],
  ['lens', 'Objektiv', ['24 mm Weitwinkel', '35 mm Reportage', '50 mm Normalobjektiv', '85 mm Porträt', '100 mm Makro', '135 mm Tele']],
  ['light', 'Licht', ['Fensterlicht', 'Direktblitz', 'Golden Hour', 'Streiflicht', 'Neonlicht', 'Softbox']],
]

function directionFieldsInPrompt() {
  return el('div', { class: 'pg-direction', role: 'group', 'aria-label': 'Bildregie im Prompt' },
    directionFields.map(([key, label, options]) => {
      const listId = 'pg-direction-' + key
      const input = el('input', { class: 'text-in', list: listId, placeholder: 'Offen', maxlength: 500, title: pg.studio[key] || label,
        oninput: event => {
          pg.studio[key] = event.target.value
          pg.studio.locked = { ...pg.studio.locked, [key]: Boolean(event.target.value) }
          delete pg.studio.lookName
          event.target.title = event.target.value || label
        } })
      input.value = pg.studio[key] ?? ''
      return el('label', { class: 'field' }, el('span', {}, label), input,
        el('datalist', { id: listId }, options.map(value => el('option', { value }))))
    }))
}

const sizeNames = { '1:1': 'square_hd', '4:3': 'landscape_4_3', '16:9': 'landscape_16_9', '3:4': 'portrait_4_3', '9:16': 'portrait_16_9' }
/** Maps a chosen format onto another model's field: `aspect_ratio` or fal's `image_size`. */
function sharedFormat(key, value, fields) {
  if (value === undefined || (key !== 'aspect_ratio' && key !== 'image_size')) return null
  const ratio = key === 'aspect_ratio' ? value : Object.keys(sizeNames).find(r => sizeNames[r] === value)
  const aspect = fields.find(f => f.key === 'aspect_ratio')
  if (aspect && (aspect.type !== 'enum' || aspect.options.includes(String(ratio)))) return ['aspect_ratio', ratio]
  const size = fields.find(f => f.key === 'image_size')
  if (size && sizeNames[ratio] && size.options?.includes(sizeNames[ratio])) return ['image_size', sizeNames[ratio]]
  return null
}

/** Hints where prompt and reference roles disagree; each may carry a one-click fix. */
function promptRoleHints() {
  const hints = []
  const labelOf = id => pg.studio.referenceLabels?.[id]
  const people = pg.refs.filter(id => ['Identität', 'Ausgangsbild'].includes(pg.studio.roles?.[id]))
  if (people.length > 1) hints.push({ text: `${people.map(id => '@Bild' + labelOf(id)).join(' und ')} sind Personen: es erscheinen ${people.length} verschiedene Menschen.` })
  for (const id of pg.refs) {
    const mark = '@Bild' + labelOf(id)
    const near = new RegExp(`(outfit|trägt|tr[aä]gt|wears?|wearing|kleid|kleidung|anzug|mantel|cape|catsuit|garment)[^@\n]{0,40}${mark}\\b|${mark}\\b[^@\n]{0,15}(outfit|kleidung|garment)`, 'i')
    const role = pg.studio.roles?.[id] ?? 'Allgemein'
    if (near.test(pg.prompt) && role !== 'Kleidung') hints.push({ text: `Der Prompt nennt ${mark} als Kleidung, die Rolle ist „${role}“.`, fix: ['Rolle auf Kleidung', () => { pg.studio.roles = { ...pg.studio.roles, [id]: 'Kleidung' }; redrawComposer() }] })
  }
  return hints
}

function quickModelSettings(model, variant, onChange) {
  if (!variant) return []
  const key = paramKey(model)
  const values = pg.modelParams[key] ?? pg.params
  const adjustable = variant.fields.filter(field => !['prompt', 'image', 'images'].includes(field.type))
  const quick = adjustable.filter(field => ['aspect_ratio', 'image_size', 'resolution'].includes(field.key))
  const quickKeys = new Set(quick.map(field => field.key))
  const other = adjustable.filter(field => !quickKeys.has(field.key) && Object.hasOwn(values, field.key))
  return [
    ...quick.map(field => {
      const input = parameterInput(field, values[field.key])
      input.addEventListener('change', () => {
        const updated = { ...(pg.modelParams[key] ?? pg.params) }
        if (!input.value) delete updated[field.key]
        else updated[field.key] = parameterValue(field, input)
        pg.modelParams[key] = updated
        // In a comparison the format is shared, so every model frames the same picture.
        for (const other of pg.models.filter(m => m.id !== model.id && pg.modelIds.includes(m.id))) {
          const fields = other.variants[taskNow()]?.fields ?? []
          const mapped = sharedFormat(field.key, updated[field.key], fields)
          const target = { ...(pg.modelParams[other.id] ?? {}) }
          for (const name of ['aspect_ratio', 'image_size']) if (field.key === 'aspect_ratio' || field.key === 'image_size') delete target[name]
          if (mapped) target[mapped[0]] = mapped[1]
          else if (field.key !== 'aspect_ratio' && field.key !== 'image_size' && fields.some(f => f.key === field.key && (f.type !== 'enum' || f.options.includes(String(updated[field.key]))))) target[field.key] = updated[field.key]
          pg.modelParams[other.id] = target
        }
        store('modelParams', pg.modelParams)
        onChange()
      })
      return el('label', { class: 'field' }, el('span', {}, field.label), input)
    }),
    other.length && el('span', { class: 'meta pg-extra-params' }, other.map(field => {
      const value = values[field.key]
      return `${field.label} · ${typeof value === 'boolean' ? (value ? 'Ein' : 'Aus') : value}`
    }).join(' · ')),
  ].filter(Boolean)
}

const garmentParts = ['Kleidung: Oberteil', 'Kleidung: Unterteil', 'Kleidung: Jacke/Mantel', 'Kleidung: Einteiler', 'Kleidung: Schuhe', 'Kleidung: Accessoire', 'Material & Farbe', 'Muster & Details']
const referenceRoles = ['Allgemein', 'Ausgangsbild', 'Identität', 'Kleidung', ...garmentParts, 'Stil', 'Komposition', 'Ort', 'Licht', 'Pose']
const roleHints = {
  Allgemein: 'Bild wird so genutzt, wie der Prompt es sagt.',
  Ausgangsbild: 'Dieses Bild wird bearbeitet; alles, was du nicht änderst, bleibt.',
  Identität: 'Nur Gesicht, Haare und Körperbau dieser Person.',
  Kleidung: 'Das ganze Outfit: Schnitt, Material, Farbe. Nicht die Person.',
  'Kleidung: Oberteil': 'Nur das Oberteil aus diesem Bild.',
  'Kleidung: Unterteil': 'Nur Hose oder Rock aus diesem Bild.',
  'Kleidung: Jacke/Mantel': 'Nur Jacke, Mantel oder Cape aus diesem Bild.',
  'Kleidung: Einteiler': 'Nur Catsuit, Kleid oder Overall aus diesem Bild.',
  'Kleidung: Schuhe': 'Nur die Schuhe aus diesem Bild.',
  'Kleidung: Accessoire': 'Nur ein Accessoire: Handschuhe, Haube, Maske, Gürtel, Schmuck.',
  'Material & Farbe': 'Nur Material, Glanz und Farben, nicht der Schnitt.',
  'Muster & Details': 'Nur Besätze, Nähte, Schnallen, Rüschen oder Drucke.',
  Stil: 'Nur Bildstil, Farbpalette und Oberfläche.',
  Komposition: 'Nur Bildaufbau, Perspektive und Platzierung.',
  Ort: 'Nur Umgebung und Architektur.',
  Licht: 'Nur Lichtrichtung, Härte und Farbtemperatur.',
  Pose: 'Nur Körperhaltung, Geste und Blick.',
}

/** Coherent camera looks. */
const looks = [
  { name: 'Editorial Blitz', angle: 'Augenhöhe', lens: '35 mm Reportage', light: 'Direktblitz' },
  { name: 'Kino-Nacht', angle: 'Seitenansicht', lens: '50 mm Normalobjektiv', light: 'Neonlicht' },
  { name: 'Porträt im Fensterlicht', angle: 'Dreiviertelansicht', lens: '85 mm Porträt', light: 'Fensterlicht' },
  { name: 'Laufsteg von unten', angle: 'Bodennähe', lens: '24 mm Weitwinkel', light: 'Softbox' },
  { name: 'Golden Hour Street', angle: 'Augenhöhe', lens: '135 mm Tele', light: 'Golden Hour' },
  { name: 'Material-Detail', angle: 'Dreiviertelansicht', lens: '100 mm Makro', light: 'Streiflicht' },
  { name: 'Katalog Studio', angle: 'Augenhöhe', lens: '85 mm Porträt', light: 'Softbox' },
  { name: 'Überblick von oben', angle: 'Vogelperspektive', lens: '24 mm Weitwinkel', light: 'Direktblitz' },
]
/** Situations with the look that suits them (names match playground/direction.mjs). */
const situations = [
  ['Halloween-Party im Altbau', 'Editorial Blitz'], ['Backstage im Club', 'Kino-Nacht'], ['Nasse Straße bei Nacht', 'Kino-Nacht'],
  ['Hotellobby der 70er', 'Porträt im Fensterlicht'], ['Industriehalle im Nebel', 'Laufsteg von unten'], ['Fotostudio', 'Katalog Studio'],
  ['Dachterrasse zur blauen Stunde', 'Golden Hour Street'], ['Spiegelsaal', 'Porträt im Fensterlicht'], ['Laufsteg', 'Laufsteg von unten'],
  ['U-Bahnhof', 'Kino-Nacht'], ['Treppenhaus', 'Überblick von oben'], ['Galerie-Eröffnung', 'Editorial Blitz'],
]

function studioForRun(studio) {
  const active = { ...studio }
  for (const key of ['setting', 'pose', 'locked', 'lookName', 'roleLocked']) delete active[key]
  if (active.vary && pg.count > 1) active.remixes = Array.from({ length: pg.count }, (_, i) => i === 0 ? null : drawRecipe(studio)).map((recipe, i) => i === 0
    ? { roles: studio.roles, situation: studio.situation, angle: studio.angle, lens: studio.lens, light: studio.light }
    : { roles: recipe.roles, situation: recipe.situation, angle: studio.angle, lens: studio.lens, light: studio.light })
  else delete active.remixes
  delete active.looks
  return active
}

const shuffle = list => { const copy = [...list]; for (let i = copy.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [copy[i], copy[j]] = [copy[j], copy[i]] } return copy }
const pickOne = (list, avoid) => { const choices = list.filter(item => item !== avoid); return (choices.length ? choices : list)[Math.floor(Math.random() * (choices.length || list.length))] }

/**
 * A remix recipe: one person keeps the identity, every other image supplies exactly one different
 * garment part (or material, details, location), plus a situation and its look. Locked roles and
 * fields stay as they are. Narrow, non-overlapping jobs keep the combined outfit coherent.
 */
function drawRecipe(studio) {
  const roles = { ...studio.roles }
  const locked = id => studio.roleLocked?.[id]
  const person = pg.refs.find(id => ['Identität', 'Ausgangsbild'].includes(roles[id]) && locked(id)) ?? pg.refs.find(id => locked(id) && roles[id] === 'Identität') ?? pg.refs.find(id => !locked(id) && roles[id] === 'Identität') ?? pg.refs.find(id => !locked(id))
  // Main pieces first so every outfit has a body; extras after.
  const main = shuffle(['Kleidung: Oberteil', 'Kleidung: Unterteil', 'Kleidung: Jacke/Mantel', 'Kleidung: Einteiler'])
  const extra = shuffle(['Material & Farbe', 'Kleidung: Accessoire', 'Muster & Details', 'Kleidung: Schuhe'])
  const queue = [main[0], ...extra.slice(0, 1), ...main.slice(1).filter(r => !(main[0] === 'Kleidung: Einteiler' && /Oberteil|Unterteil/.test(r)) && !(r === 'Kleidung: Einteiler' && /Oberteil|Unterteil/.test(main[0]))), ...extra.slice(1), 'Ort']
  const taken = new Set(pg.refs.filter(locked).map(id => roles[id]))
  for (const id of pg.refs) {
    if (locked(id)) continue
    if (id === person) { roles[id] = 'Identität'; continue }
    const next = queue.find(role => !taken.has(role) && !(role === 'Kleidung: Einteiler' && [...taken].some(r => /Oberteil|Unterteil/.test(r))) && !(/Oberteil|Unterteil/.test(role) && taken.has('Kleidung: Einteiler')))
    roles[id] = next ?? 'Muster & Details'
    taken.add(roles[id])
  }
  const [situation, lookName] = studio.locked?.situation && studio.situation ? [studio.situation, studio.lookName] : pickOne(situations, situations.find(s => s[0] === studio.situation))
  const look = { ...(looks.find(l => l.name === lookName) ?? pickOne(looks)) }
  for (const [key] of directionFields) if (studio.locked?.[key] && studio[key]) look[key] = studio[key]
  return { roles, situation, look }
}

/** Scrabble: rolls a remix recipe; locked roles, situation and camera fields stay. */
function rollScrabble() {
  if (!pg.refs.length) return toast('Hänge zuerst ein paar Bilder an. Scrabble mischt daraus Person, Outfit-Teile und Situation.', true)
  pg.scrabbleUndo ??= []
  pg.scrabbleUndo.push(structuredClone({ prompt: pg.prompt, roles: pg.studio.roles ?? {}, situation: pg.studio.situation, lookName: pg.studio.lookName, ...Object.fromEntries(directionFields.map(([key]) => [key, pg.studio[key]])) }))
  if (pg.scrabbleUndo.length > 20) pg.scrabbleUndo.shift()
  const recipe = drawRecipe(pg.studio)
  pg.studio.roles = recipe.roles
  pg.studio.situation = recipe.situation
  // With no prompt yet, Scrabble writes a starting point so a handful of images is enough.
  if (!pg.prompt.trim()) {
    const person = pg.refs.find(id => recipe.roles[id] === 'Identität')
    pg.prompt = person ? `Fashion-Editorial: @Bild${pg.studio.referenceLabels?.[person] ?? 1} in einem neuen Outfit aus den anderen Bildern.` : 'Fashion-Editorial in einem neuen Outfit aus den Bildern.'
  }
  // Camera fields stay as the user set them: technical camera specs made remixes look staged.
  redrawComposer()
  toast(`Remix: ${recipe.situation}. Gesperrtes bleibt.`)
}

function undoScrabble() {
  const last = pg.scrabbleUndo?.pop()
  if (!last) return
  pg.studio.roles = last.roles
  pg.prompt = last.prompt ?? pg.prompt
  for (const key of ['situation', 'lookName', ...directionFields.map(([k]) => k)]) { if (last[key] === undefined) delete pg.studio[key]; else pg.studio[key] = last[key] }
  if (!pg.scrabbleUndo.length) pg.scrabbleUndo = null
  redrawComposer()
  $('#pg-prompt')?.focus()
}

/** The recipe's situation and camera look as chips; a lock keeps a value through further throws. */
function lookChips() {
  const set = [['situation', 'Situation'], ...directionFields].filter(([key]) => pg.studio[key])
  if (!set.length) return null
  return el('div', { class: 'pg-look', role: 'group', 'aria-label': 'Situation und Kamera-Look' },
    pg.studio.lookName && el('span', { class: 'meta' }, pg.studio.lookName),
    set.map(([key, label]) => {
      const locked = pg.studio.locked?.[key] === true
      return el('span', { class: 'chip pg-look-chip' + (locked ? ' locked' : ''), title: label },
        el('button', { type: 'button', class: 'lock', 'aria-pressed': String(locked), 'aria-label': `${label} ${locked ? 'entsperren' : 'sperren'}`, title: locked ? 'Gesperrt: bleibt beim Würfeln' : 'Sperren: bleibt beim Würfeln',
          onclick: () => { pg.studio.locked = { ...pg.studio.locked, [key]: !locked }; redrawComposer() } }, icon(locked ? 'lock' : 'unlock')),
        el('span', {}, pg.studio[key]),
        el('button', { type: 'button', class: 'rm', 'aria-label': `${label} entfernen`, onclick: () => { delete pg.studio[key]; if (pg.studio.locked) delete pg.studio.locked[key]; if (![['situation'], ...directionFields].some(([k]) => pg.studio[k])) delete pg.studio.lookName; redrawComposer() } }, icon('close')))
    }))
}

function advancedDirection(open) {
  const vary = el('input', { type: 'checkbox', checked: pg.studio.vary === true,
    onchange: event => { pg.studio.vary = event.target.checked } })
  return el('details', { class: 'pg-advanced', open },
    el('summary', {}, 'Kamera und Licht'),
    directionFieldsInPrompt(),
    el('label', { class: 'pg-vary meta' }, vary, 'Bei 2× und 4× für jedes weitere Bild einen eigenen Remix würfeln'))
}

async function pickReferences() {
  const items = [...await api('/assets?library=clips'), ...await api('/assets?library=generation')].filter(i => i.media_type?.startsWith('image/') || i.preview)
  for (const item of items) assetCache.set(item.id, item)
  const chosen = new Set(pg.refs)
  const grid = el('div', { class: 'pick-grid' }, items.map(item => withFullscreen(item, el('button', { type: 'button', class: 'pick' + (chosen.has(item.id) ? ' on' : ''), 'aria-pressed': String(chosen.has(item.id)), 'aria-label': item.title, onclick: e => {
    chosen.has(item.id) ? chosen.delete(item.id) : chosen.add(item.id)
    e.currentTarget.classList.toggle('on'); e.currentTarget.setAttribute('aria-pressed', String(chosen.has(item.id)))
  } }, media(item)))))
  const dialog = el('dialog', { style: 'width:min(880px, calc(100vw - 32px))' }, el('form', { method: 'dialog' },
    el('h2', {}, 'Referenzen wählen'), items.length ? grid : el('p', {}, 'In Sammlung und Library gibt es noch keine Bilder.'),
    el('div', { class: 'row' }, el('button', { class: 'btn ghost', value: 'no' }, 'Abbrechen'), el('button', { class: 'btn primary', value: 'yes' }, 'Übernehmen'))))
  dialog.addEventListener('close', () => { if (dialog.returnValue === 'yes') { updateReferences([...chosen].slice(0, 16)) } dialog.remove() })
  document.body.append(dialog); dialog.showModal()
}

function composer() { return el('div', { class: 'pg-composer', id: 'pg-composer', role: 'form', 'aria-label': 'Neuer Lauf' }) }

function insertReference(prompt, alias) {
  let start = prompt.selectionStart
  const end = prompt.selectionEnd
  const partial = /(?:^|\s)(@(?:Bild)?)$/i.exec(prompt.value.slice(0, start))
  if (start === end && partial) start -= partial[1].length
  const before = prompt.value[start - 1]
  const after = prompt.value[end]
  const prefix = before && !/[\s(„]/.test(before) ? ' ' : ''
  const suffix = !after || !/[\s.,;:!?)”]/.test(after) ? ' ' : ''
  prompt.focus()
  prompt.setRangeText(prefix + alias + suffix, start, end, 'end')
  pg.prompt = prompt.value
}

function redrawComposer(showAdvanced = false) {
  const box = $('#pg-composer')
  if (!box) return
  const advancedOpen = showAdvanced || $('.pg-advanced', box)?.open
  syncReferenceLabels()
  const tray = el('div', { class: 'tray', 'aria-label': 'Bildreferenzen' })
  const prompt = el('textarea', { id: 'pg-prompt', rows: 2, placeholder: pg.refs.length ? 'Was soll entstehen oder sich ändern?' : 'Was soll entstehen?', 'aria-label': 'Prompt', oninput: e => { pg.prompt = e.target.value; drawHints() } })
  const hintBox = el('div', { class: 'pg-hints', role: 'status', 'aria-live': 'polite' })
  const drawHints = () => hintBox.replaceChildren(...promptRoleHints().map(h => el('div', { class: 'pg-hint' }, el('span', {}, h.text), h.fix && el('button', { type: 'button', class: 'btn sm', onclick: h.fix[1] }, h.fix[0]))))
  drawHints()
  prompt.value = pg.prompt
  for (const id of pg.refs) {
    const alias = '@Bild' + pg.studio.referenceLabels[id]
    const frame = el('div', { class: 'pg-ref' })
    tray.append(frame)
    assetById(id).then(item => {
      const thumb = el('span', { class: 'ref-thumb' }, item && media(item),
        el('button', { type: 'button', class: 'rm', 'aria-label': `${alias} entfernen`, onclick: () => {
          updateReferences(pg.refs.filter(ref => ref !== id))
        } }, icon('close')))
      const role = el('select', { class: 'pg-role', 'aria-label': `Rolle von ${alias}`, title: roleHints[pg.studio.roles?.[id] ?? 'Allgemein'], onchange: () => {
        pg.studio.roles = { ...pg.studio.roles, [id]: role.value }
        pg.studio.roleLocked = { ...pg.studio.roleLocked, [id]: true }
        role.title = roleHints[role.value]
        $('#pg-prompt')?.dispatchEvent(new Event('input'))
      } }, referenceRoles.map(r => el('option', { value: r }, r === 'Kleidung' ? 'Ganzes Outfit' : r.replace('Kleidung: ', ''))))
      role.value = pg.studio.roles?.[id] ?? 'Allgemein'
      if (pg.studio.roleLocked?.[id]) { role.classList.add('locked'); role.title = roleHints[role.value] + ' Von dir festgelegt: bleibt beim Würfeln.' }
      frame.append(item ? withFullscreen(item, thumb) : thumb, role,
        el('button', { type: 'button', class: 'btn sm pg-ref-mark', title: item?.title, 'aria-label': `${alias} in den Prompt einfügen${item ? ': ' + item.title : ''}`, onmousedown: e => { if (document.activeElement === prompt) e.preventDefault() }, onclick: () => insertReference(prompt, alias) }, alias))
    }).catch(error => toast(error.message, true))
  }
  const selection = el('span')
  const start = el('button', { type: 'button', class: 'btn primary', onclick: startRun }, 'Starten', el('span', { class: 'kbd' }, '⌘↵'))
  const settings = el('button', { type: 'button', class: 'pill', onclick: settingsDialog }, icon('sliders'), el('span'))
  const status = el('span', { class: 'meta', style: 'flex:1;min-width:120px' })
  const modelFields = el('div', { class: 'pg-direction pg-model-params', 'aria-label': 'Modellparameter am Prompt', role: 'group' })
  function updateSelection() {
    const chosen = pg.models.filter(m => pg.modelIds.includes(m.id))
    const capable = chosen.filter(m => m.variants[taskNow()])
    const skipped = chosen.filter(m => !m.variants[taskNow()])
    const model = capable[0] ?? chosen[0]
    const variant = model?.variants[taskNow()]
    const changed = model ? Object.keys((variant && pg.modelParams[paramKey(model)]) ?? pg.params).length : 0
    selection.textContent = chosen.length > 1 ? `${chosen.length} Modelle` : model?.title ?? 'Modell wählen'
    start.disabled = !capable.length
    settings.lastElementChild.textContent = changed ? `Einstellungen (${changed})` : 'Einstellungen'
    modelFields.replaceChildren(...quickModelSettings(model, variant, () => {
      const count = Object.keys(pg.modelParams[paramKey(model)]).length
      settings.lastElementChild.textContent = count ? `Einstellungen (${count})` : 'Einstellungen'
    }))
    const names = list => list.map(m => m.title).join(', ')
    status.textContent = chosen.length && !capable.length
      ? (taskNow() === 'edit' ? `${names(skipped)} ${skipped.length === 1 ? 'bearbeitet' : 'bearbeiten'} keine Bilder. Entferne die Referenzen oder wähle ein anderes Modell.` : `${names(skipped)} ${skipped.length === 1 ? 'braucht' : 'brauchen'} ein Eingabebild. Hänge ein Bild an.`)
      : skipped.length ? `${names(skipped)} wird übersprungen.` : chosen.length > 1 ? `Vergleich: ${capable.length} Modelle, je ${pg.count}×. Kosten zeigt der Anbieter nach dem Lauf.` : 'Kosten zeigt der Anbieter nach dem Lauf'
  }
  updateSelection()
  prompt.addEventListener('keydown', e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); startRun() } })
  box.replaceChildren(
    tray,
    el('div', { class: 'pg-prompt-panel' },
      el('div', { class: 'pg-input' }, prompt,
        el('button', { type: 'button', class: 'icon', 'aria-label': 'Referenz aus Sammlung oder Library anhängen', title: 'Referenz anhängen', onclick: pickReferences }, icon('clip'))),
      hintBox, lookChips(), modelFields, advancedDirection(advancedOpen)),
    el('div', { class: 'pg-bar' },
      el('span', { class: 'pill static', title: 'Verknüpfe Referenzen über ihre Bildmarke im Prompt.' }, icon(taskNow() === 'edit' ? 'edit' : 'text'), taskNow() === 'edit' ? 'Mit Bildreferenzen' : 'Text zu Bild'),
      ...modelPicker(selection, updateSelection),
      el('button', { type: 'button', class: 'pill', title: 'Mischt deine Bilder neu: eine Person, aus jedem anderen Bild ein Outfit-Teil, dazu eine zufällige Situation. Was du selbst festgelegt hast, bleibt.', onclick: rollScrabble }, icon('wand'), 'Scrabble'),
      el('button', { type: 'button', class: 'icon', 'aria-label': 'Letzten Wurf rückgängig machen', title: 'Letzten Wurf rückgängig', disabled: !pg.scrabbleUndo?.length || null, onclick: undoScrabble }, icon('undo')),
      settings,
      el('div', { class: 'seg', role: 'group', 'aria-label': 'Anzahl je Modell' }, [1, 2, 4].map(n => el('button', { type: 'button', 'aria-pressed': String(pg.count === n), onclick: () => { pg.count = n; redrawComposer() } }, n + '×'))),
      status,
      start))
}

async function startRun() {
  const capable = pg.models.filter(m => pg.modelIds.includes(m.id) && m.variants[taskNow()])
  if (!pg.prompt.trim()) return toast('Schreib zuerst einen Prompt.', true)
  if (!capable.length) return pg.models.length ? $('#pg-model-picker')?.showPopover() : modelsDialog()
  try {
    const run = await pgApi('/runs', 'POST', { prompt: pg.prompt, modelIds: capable.map(m => m.id), referenceIds: pg.refs, params: pg.params, studio: studioForRun(pg.studio), modelParams: pg.modelParams, count: pg.count, projectId: pg.projectId || undefined })
    pg.runs.unshift(run); drawFeed()
    $('.pg-feed')?.scrollTo({ top: 0, behavior: 'smooth' })
  } catch (error) { toast(error.message, true) }
}
