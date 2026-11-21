/**
 * Browser module of the Playground plugin, loaded by the hub as a page (`#/playground`).
 * The hub passes its shared building blocks through `renderView(ctx)`; the plugin owns this UI.
 */
let $, openImage, uploadButton, uploadFiles, API, api, chev, currentRoute, dateLabel, el, errorState, fullscreenButton, header, icon, icons, loading, media, refreshCounts, state, tile, timeLabel, toast, view, withFullscreen

/** Called by the hub on every visit; renders the whole view. */
export function renderView(ctx) {
  ;({ '$': $, openImage, uploadButton, uploadFiles, API, api, chev, currentRoute, dateLabel, el, errorState, fullscreenButton, header, icon, icons, loading, media, refreshCounts, state, tile, timeLabel, toast, view, withFullscreen } = ctx)
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
    setPrompt(removeReferenceMarks(pg.prompt, labels))
    if (pg.studio.appearance) pg.studio.appearance = removeReferenceMarks(pg.studio.appearance, labels)
    pg.scenes = pg.scenes?.map(scene => removeReferenceMarks(scene, labels))
    for (const draft of pg.scrabbleUndo ?? []) {
      draft.prompt = removeReferenceMarks(draft.prompt, labels)
      draft.scenes = draft.scenes?.map(scene => removeReferenceMarks(scene, labels))
    }
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
  const used = new Set([...(pg.prompt + '\n' + (pg.studio.appearance ?? '')).matchAll(referenceMark)].map(match => Number(match[1])))
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
const selectedModels = () => pg.models.filter(model => pg.modelIds.includes(model.id))
const usesModelCount = models => models.length === 1 && models[0].variants[taskNow()]?.model === 'kling-4-0/image'
const parameterLabels = { aspect_ratio: 'Seitenverhältnis', image_size: 'Bildformat', resolution: 'Auflösung', mode: 'Modus',
  count: 'Bildanzahl', skill: 'Typ', length: 'Länge' }
const optionLabel = (field, value) => ({
  mode: { default: 'Einzelbilder', series: 'Zusammenhängende Serie' },
  skill: { ecommerce: 'Produktseite', webpage: 'Webdesign' },
  length: { short: 'Kurz', medium: 'Mittel', long: 'Lang' },
  resolution: { '1k': '1K', '2k': '2K', '4k': '4K', '8k': '8K' },
}[field.key]?.[value] ?? value)
const minutes = ms => { const s = Math.round(ms / 1000); return s < 60 ? `${s} s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} min` }
const ago = iso => { const s = (Date.now() - new Date(iso)) / 1000; return s < 60 ? 'gerade eben' : s < 3600 ? `vor ${Math.round(s / 60)} Minuten` : dateLabel(iso) + ', ' + timeLabel(iso) }
const icons2 = {
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
  const query = new URLSearchParams(location.hash.split('?')[1] || '')
  // Links with `refs` (comma separated asset ids), `prompt` and `project` prefill the composer, nothing runs.
  for (const ref of [query.get('ref'), ...(query.get('refs') || '').split(',')]) {
    if (ref && pg.refs.length < 16 && !pg.refs.includes(ref)) pg.refs.push(ref)
  }
  if (query.get('prompt')) pg.prompt = query.get('prompt').slice(0, 4000)
  if (query.get('project') && state.projects.some(p => p.id === query.get('project'))) { pg.projectId = query.get('project'); store('project', pg.projectId) }
  const feed = el('div', { class: 'pg-feed' }, el('div', { class: 'skel', style: 'height:220px' }))
  const projectSel = el('select', { 'aria-label': 'Ziel-Projekt', onchange: e => { pg.projectId = e.target.value; store('project', pg.projectId) } },
    el('option', { value: '' }, 'Kein Projekt'), state.projects.map(p => el('option', { value: p.id, selected: p.id === pg.projectId || null }, p.title)))
  const tools = el('div', { class: 'tools' }, el('label', { class: 'pill' }, el('span', { class: 'meta' }, 'Ziel'), projectSel, chev()), el('button', { type: 'button', class: 'btn sm', onclick: modelsDialog }, 'Modelle verwalten'))
  const studio = el('div', { class: 'photo-studio' },
    el('div', { class: 'studio-grid photo-grid' }, composer(), feed))
  view.replaceChildren(...header('Foto Playground', null, tools), el('div', { class: 'scroll studio-scroll' }, studio))
  try {
    const [models, runs, instance] = await Promise.all([pgApi('/models'), pgApi('/runs'), api('/instance')])
    pg.models = models
    pg.runs = runs
    pg.nsfw = instance.mode === 'nsfw'
    pg.modelIds = pg.modelIds.filter(id => pg.models.some(m => m.id === id))
    pg.modelId = pg.modelIds[0] ?? null
    if (!pg.modelId) selectModel(pg.models[0]?.id)
    drawFeed(feed)
    redrawComposer()
  } catch (error) { feed.replaceChildren(errorState(error, renderPlayground)) }
}

function photoStatus(run) {
  const pending = run.results.filter(result => result.status === 'running').length
  const failed = run.results.filter(result => result.status === 'failed').length
  const images = run.results.reduce((sum, result) => sum + result.assetIds.length, 0)
  if (failed || pending) return [`${images} ${images === 1 ? 'Bild' : 'Bilder'}`, pending && `${pending} in Arbeit`, failed && `${failed} fehlgeschlagen`].filter(Boolean).join(' · ')
  return images ? `${images} ${images === 1 ? 'Bild' : 'Bilder'}` : 'Fehlgeschlagen'
}

function selectPhotoRun(runId) {
  pg.photoRun = runId
  pg.photoAsset = undefined
  pg.photoView = 'preview'
  drawFeed()
}

function drawFeed(feed = $('.pg-feed')) {
  if (!feed) return
  const run = pg.runs.find(item => item.id === pg.photoRun) ?? pg.runs[0]
  const results = run?.results ?? []
  const candidates = results.flatMap(result => result.assetIds.map(id => ({ result, id })))
  const active = candidates.find(item => item.id === pg.photoAsset) ?? candidates[0]
  const waiting = results.some(result => result.status === 'running')
  const error = results.find(result => result.status === 'failed')
  const tabs = el('div', { class: 'studio-modes', role: 'group', 'aria-label': 'Ausgabeansicht' },
    [['preview', 'Vorschau'], ['data', 'Auftragsdaten']].map(([value, label]) => el('button', {
      type: 'button', class: 'btn sm', 'aria-pressed': String((pg.photoView ?? 'preview') === value),
      disabled: value === 'data' && !run, onclick: () => { pg.photoView = value; drawFeed() },
    }, label)))
  const details = pg.photoView === 'data' && run
  const stage = el('div', { class: 'studio-stage photo-stage', 'aria-busy': waiting || null })
  if (details) {
    stage.append(el('pre', { class: 'photo-data' }, JSON.stringify({
      auftrag: run.id, eingabe: run.prompt, referenzen: run.referenceIds,
      ergebnisse: results.map(item => ({
        modell: item.title, anbieter: item.provider, status: item.status,
        prompt: item.sentPrompt ?? run.prompt, parameter: item.settings,
        bilder: item.assetIds, credits: item.credits, fehler: item.error,
      })),
    }, null, 2)))
  } else if (active) {
    const url = `${API}/media/${active.id}`
    const image = el('img', { src: url, alt: active.result.title + ' · Ergebnis', draggable: false,
      onclick: () => openImage(url, active.result.title),
      onerror: () => stage.replaceChildren(el('p', { class: 'meta' }, 'Dieses Bild ist nicht mehr gespeichert.')) })
    stage.append(image)
  } else {
    const message = !pg.models.length ? 'Importiere ein Modell, um Bilder zu erstellen.' :
      waiting ? 'Die Bilder werden erstellt …' : error?.error ?? 'Deine Bilder erscheinen hier nach der Generierung.'
    stage.append(el('div', { class: 'photo-empty' }, icon('image'), el('p', { role: 'status' }, message)))
  }
  const actions = active && !details ? photoActions(run, active) : !active && !waiting && error ?
    el('div', { class: 'photo-actions' }, el('button', { type: 'button', class: 'btn sm', onclick: () => restoreRun(run) }, 'Eingabe übernehmen')) : null
  const retryable = results.filter(result => result.status === 'failed' && result.retry !== false && typeof result.sentPrompt === 'string').length
  const failures = error && el('div', { class: 'photo-actions' },
    el('details', {}, el('summary', {}, photoStatus(run)), results.map((result, i) => result.status === 'failed' &&
      el('p', {}, `Aufnahme ${i + 1} · ${result.title} · ${result.error}`))),
    retryable > 0 && !waiting && el('button', { type: 'button', class: 'btn sm', disabled: pg.retrying?.has(run.id),
      onclick: () => retryFailed(run.id) }, retryable === 1 ? '1 Aufnahme erneut versuchen' : retryable + ' Aufnahmen erneut versuchen'))
  const images = candidates.length > 1 && !details ? el('div', { class: 'photo-thumbs', 'aria-label': 'Bilder im Auftrag' },
    candidates.map(({ id, result }, index) => el('button', { type: 'button', class: 'photo-thumb',
      'aria-label': `Bild ${index + 1} auswählen · ${result.title}`, 'aria-pressed': String(id === active?.id),
      onclick: () => { pg.photoAsset = id; drawFeed() } },
    el('img', { src: `${API}/media/${id}`, alt: '', loading: 'lazy' })))) : null
  const history = pg.runs.length ? el('section', { class: 'studio-panel photo-history', 'aria-label': 'Bildverlauf' },
    el('header', { class: 'studio-panel-head' }, el('h2', {}, 'Bildverlauf'), el('span', { class: 'meta' }, `${pg.runs.length} ${pg.runs.length === 1 ? 'Auftrag' : 'Aufträge'}`)),
    el('div', { class: 'studio-renders' }, pg.runs.map(item => {
      const sample = item.results.flatMap(result => result.assetIds)[0]
      return el('button', { type: 'button', class: 'studio-render photo-run', 'aria-pressed': String(item.id === run?.id),
        onclick: () => selectPhotoRun(item.id), title: item.title || item.prompt },
      sample ? el('img', { class: 'photo-run-image', src: `${API}/media/${sample}`, alt: '', loading: 'lazy' }) :
        el('span', { class: 'photo-run-image' }, icon('image')),
      el('span', { class: 'studio-caption' }, item.title || item.prompt || item.results[0]?.title || 'Bildauftrag'),
      el('span', { class: 'meta' }, photoStatus(item), ' · ', timeLabel(item.createdAt)))
    }))) : null
  const monitor = el('section', { class: 'studio-panel photo-monitor', 'aria-label': 'Bildausgabe' },
    el('header', { class: 'studio-panel-head' }, el('h2', {}, 'Ausgabe'), tabs), stage, failures, actions, images)
  const scrollOffsets = [...feed.querySelectorAll('.photo-thumbs, .studio-renders')].map(div => [div.className, div.scrollLeft])
  feed.replaceChildren(...[monitor, history].filter(Boolean))
  for (const [className, scrollLeft] of scrollOffsets) {
    const strip = feed.getElementsByClassName(className)[0]
    if (strip) strip.scrollLeft = scrollLeft
  }
  clearTimeout(pg.timer)
  if (pg.runs.some(item => item.results.some(result => result.status === 'running'))) pg.timer = setTimeout(pollRuns, 2500)
}

function photoActions(run, { result, id }) {
  const url = `${API}/media/${id}`
  const query = new URLSearchParams({ ref: id })
  if (run.projectId) query.set('project', run.projectId)
  return el('div', { class: 'photo-actions' },
    el('span', { class: 'meta photo-output-label' }, [result.title, result.provider, result.credits == null ? '' : result.credits + ' Credits'].filter(Boolean).join(' · ')),
    el('button', { type: 'button', class: 'btn sm', onclick: () => openImage(url, result.title) }, icon('expand'), 'Vollbild'),
    el('a', { class: 'btn sm', href: url, download: result.title }, icon('down'), 'Download'),
    el('button', { type: 'button', class: 'btn sm', onclick: () => editResult(run, result, id) }, 'Als Referenz bearbeiten'),
    el('button', { type: 'button', class: 'btn sm', onclick: () => assignDialog(id) }, 'Ins Projekt'),
    state.pages?.some(page => page.id === 'video-playground') && el('a', { class: 'btn sm', href: '#/video-playground?' + query }, 'Animieren'),
    el('button', { type: 'button', class: 'btn sm', onclick: () => restoreRun(run) }, 'Eingabe übernehmen'))
}

function restoreRun(run) {
  pg.params = run.params ?? {}
  pg.modelParams = structuredClone(run.modelParams ?? {})
  pg.studio = structuredClone(run.studio ?? {})
  pg.studio.referenceLabels ??= Object.fromEntries(run.referenceIds.map((id, index) => [id, index + 1]))
  pg.count = run.count ?? 1
  pg.scrabbleUndo = null
  pg.scenes = pg.studio.prompts?.slice()
  setPrompt(run.prompt)
  pg.refs = [...run.referenceIds]
  const ids = [...new Set(run.results.map(item => item.modelId))].filter(id => pg.models.some(model => model.id === id))
  if (ids.length) {
    pg.modelIds = ids
    pg.modelId = ids[0]
    store('models', ids)
  }
  redrawComposer()
  $('#pg-prompt')?.focus()
}

async function pollRuns() {
  if (currentRoute() !== 'playground') return
  try { pg.runs = await pgApi('/runs'); assetCache.clear(); drawFeed(); refreshCounts() } catch { pg.timer = setTimeout(pollRuns, 5000) /* Netzfehler: später erneut. */ }
}

function editResult(run, result, id) {
  const appearance = run.studio?.appearance ?? ''
  const usedMarks = new Set([...appearance.matchAll(referenceMark)].map(([, label]) => label))
  pg.studio = { ...run.studio, roles: undefined, referenceLabels: { [id]: 1 },
    appearance: usedMarks.size <= 1 ? appearance.replace(referenceMark, '@Bild1') : '' }
  pg.modelParams = structuredClone(run.modelParams ?? {})
  pg.params = run.params ?? {}
  pg.refs = [id]
  pg.scrabbleUndo = null
  pg.scenes = null
  pg.prompt = /@Bild[1-9]\d*\b/i.test(run.prompt) ? 'Bearbeite @Bild1. ' : 'Bearbeite @Bild1. ' + run.prompt
  if (pg.models.some(model => model.id === result.modelId)) selectModel(result.modelId)
  redrawComposer()
  $('#pg-prompt')?.focus()
}

async function retryFailed(id) {
  pg.retrying ??= new Set()
  if (pg.retrying.has(id)) return
  pg.retrying.add(id)
  drawFeed()
  try {
    const updated = await pgApi('/runs/' + encodeURIComponent(id) + '/retry', 'POST', {})
    pg.runs = pg.runs.map(item => item.id === id ? updated : item)
  } catch (error) { toast(error.message, true) }
  finally { pg.retrying.delete(id); drawFeed() }
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
      model.replaceChildren(...options.filter(o => !o.modal || o.modal === 'image').map(o => el('option', { value: o.id }, o.title)))
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
    el('label', { class: 'field' }, el('span', {}, 'URL der Modellseite'), el('div', { style: 'display:flex;gap:8px' }, url, addBtn)),
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
    el('option', { value: '' }, 'Modellstandard' + (field.default == null ? '' : ' · ' + optionLabel(field, field.default))),
    options.map(value => el('option', { value }, field.type === 'boolean' ? (value === 'true' ? 'Ein' : 'Aus') : optionLabel(field, value))))
    : el('input', { class: 'text-in', type: field.type === 'text' ? 'text' : 'number', placeholder: field.default ?? 'Modellstandard', min: field.min, max: field.max, step: field.type === 'integer' ? 1 : 'any' })
  input.value = value ?? ''
  input.setAttribute('aria-label', parameterLabels[field.key] ?? field.label)
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
      return el('label', { class: 'field' }, el('span', {}, parameterLabels[f.key] ?? f.label), input, f.description && el('small', { class: 'meta' }, f.description))
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

function quickModelSettings(model, variant, onChange) {
  if (!variant) return []
  const key = paramKey(model)
  const values = pg.modelParams[key] ?? pg.params
  const adjustable = variant.fields.filter(field => !['prompt', 'image', 'images'].includes(field.type))
  const kling = variant.model === 'kling-4-0/image'
  const long = variant.model === 'kling-4-0/long-image'
  const series = values.mode === 'series'
  const defaults = long ? { skill: pg.refs.length ? 'ecommerce' : 'webpage' } : {}
  const quick = adjustable.filter(field => ['aspect_ratio', 'image_size', 'resolution'].includes(field.key) ||
    (kling && ['mode', 'count'].includes(field.key)) || (long && (field.key === 'skill' ||
      (field.key === 'length' && (values.skill ?? defaults.skill) !== 'webpage'))))
  const quickKeys = new Set(quick.map(field => field.key))
  const other = adjustable.filter(field => !quickKeys.has(field.key) && Object.hasOwn(values, field.key))
  return [
    ...quick.map(field => {
      const count = kling && field.key === 'count'
      const input = parameterInput(count ? { ...field, min: series ? 2 : 1, max: series ? 10 : 9 } : field,
        values[field.key] ?? defaults[field.key] ?? (count ? (series ? 2 : 1) : undefined))
      input.addEventListener('change', () => {
        const updated = { ...(pg.modelParams[key] ?? pg.params) }
        if (!input.value) delete updated[field.key]
        else updated[field.key] = parameterValue(field, input)
        if (count && input.value) {
          updated.count = Math.max(Number(input.min), Math.min(Number(input.max), Math.round(updated.count)))
          input.value = updated.count
        }
        if (kling && field.key === 'mode') {
          const inSeries = updated.mode === 'series'
          updated.count = Math.max(inSeries ? 2 : 1, Math.min(inSeries ? 10 : 9, updated.count ?? 1))
        }
        pg.modelParams[key] = updated
        // In a comparison the format is shared, so every model frames the same picture.
        for (const other of pg.models.filter(m => m.id !== model.id && pg.modelIds.includes(m.id))) {
          const fields = other.variants[taskNow()]?.fields ?? []
          const mapped = sharedFormat(field.key, updated[field.key], fields)
          const target = { ...(pg.modelParams[other.id] ?? {}) }
          for (const name of ['aspect_ratio', 'image_size']) if (field.key === 'aspect_ratio' || field.key === 'image_size') delete target[name]
          if (mapped) target[mapped[0]] = mapped[1]
          else if (field.key === 'resolution' && fields.some(f => f.key === field.key && (f.type !== 'enum' || f.options.includes(String(updated[field.key]))))) target[field.key] = updated[field.key]
          pg.modelParams[other.id] = target
        }
        store('modelParams', pg.modelParams)
        onChange()
        if (['mode', 'skill'].includes(field.key)) redrawComposer()
      })
      return el('label', { class: 'field' }, el('span', {}, parameterLabels[field.key] ?? field.label), input)
    }),
    other.length && el('span', { class: 'meta pg-extra-params' }, other.map(field => {
      const value = values[field.key]
      return `${field.label} · ${typeof value === 'boolean' ? (value ? 'Ein' : 'Aus') : value}`
    }).join(' · ')),
  ].filter(Boolean)
}

function setPrompt(prompt) {
  pg.prompt = prompt
  if (pg.scenes?.length) pg.scenes[0] = prompt
}

function activeScenes() {
  return pg.prompt.trim() && pg.count > 1 && !usesModelCount(selectedModels()) && pg.scenes?.length === pg.count ? pg.scenes : undefined
}

function studioForRun() {
  const { referenceLabels, roles, appearance } = pg.studio
  return { referenceLabels, prompts: activeScenes(), ...(pg.nsfw && { roles, appearance }) }
}

function scrabbleInput() {
  const { roles, appearance } = pg.studio
  const models = selectedModels().filter(model => model.variants[taskNow()])
  return { referenceIds: pg.refs, words: pg.words ?? '', labels: pg.studio.referenceLabels,
    prompt: pg.prompt, modelIds: models.map(model => model.id),
    modelParams: Object.fromEntries(models.map(model => [model.id, pg.modelParams[paramKey(model)] ?? pg.params])), ...(pg.nsfw && { roles, appearance }) }
}

async function rollScrabble() {
  if (pg.scrabbleBusy) return
  const input = scrabbleInput()
  if (!input.modelIds.length) return toast('Wähle ein passendes Bildmodell.', true)
  const draft = { prompt: pg.prompt, scenes: pg.scenes?.slice() }
  const stateBefore = JSON.stringify([input, draft])
  pg.scrabbleBusy = true
  updateScrabbleButton()
  try {
    const answer = await pgApi('/scrabble', 'POST', { ...input, previous: draft.scenes })
    if (JSON.stringify([scrabbleInput(), { prompt: pg.prompt, scenes: pg.scenes }]) !== stateBefore) {
      if (currentRoute() === 'playground') toast('Eingabe geändert. Würfle erneut, um daraus einen Bildprompt zu schreiben.')
      return
    }
    if (currentRoute() !== 'playground') return
    if (draft.prompt.trim()) {
      const accepted = await reviewDraft(draft.prompt, answer.prompts[0])
      if (!accepted || currentRoute() !== 'playground') return
      if (JSON.stringify([scrabbleInput(), { prompt: pg.prompt, scenes: pg.scenes }]) !== stateBefore) {
        toast('Die Eingabe hat sich geändert. Erstelle einen neuen Vorschlag.')
        return
      }
    }
    pg.scrabbleUndo ??= []
    pg.scrabbleUndo.push(draft)
    if (pg.scrabbleUndo.length > 20) pg.scrabbleUndo.shift()
    pg.scenes = answer.prompts
    setPrompt(answer.prompts[0])
    if (currentRoute() === 'playground') {
      redrawComposer()
      $('#pg-prompt')?.focus()
    }
  } catch (error) {
    if (currentRoute() === 'playground') toast(error.message, true)
  } finally {
    pg.scrabbleBusy = false
    updateScrabbleButton()
  }
}

function updateScrabbleButton() {
  const button = $('.pg-scrabble')
  if (!button) return
  button.disabled = pg.scrabbleBusy
  button.textContent = pg.scrabbleBusy ? 'Schreibt …' : 'Scrabble'
}

function undoScrabble() {
  const last = pg.scrabbleUndo?.pop()
  if (!last) return
  pg.scenes = last.scenes
  setPrompt(last.prompt)
  redrawComposer()
  $('#pg-prompt')?.focus()
}

function sceneEditors() {
  const scenes = activeScenes()
  if (!scenes) return null
  return el('details', { class: 'pg-scenes meta' },
    el('summary', {}, scenes.length === 2 ? 'Prompt für Bild 2' : 'Prompts für Bilder 2 bis ' + scenes.length),
    scenes.slice(1).map((scene, i) => el('label', { class: 'field' }, el('span', {}, 'Prompt für Bild ' + (i + 2)),
      el('textarea', { class: 'text-in', rows: 3, maxlength: 2000, oninput: e => { pg.scenes[i + 1] = e.target.value } }, scene))))
}

function reviewDraft(original, suggestion) {
  return new Promise(resolve => {
    const dialog = el('dialog', { 'aria-label': 'Scrabble-Vorschlag' }, el('form', { method: 'dialog' },
      el('h2', {}, 'Scrabble-Vorschlag'),
      el('details', {}, el('summary', {}, 'Dein Original'), el('p', { style: 'white-space:pre-wrap' }, original)),
      el('p', { style: 'white-space:pre-wrap' }, suggestion),
      el('div', { class: 'row' }, el('button', { class: 'btn', value: 'cancel' }, 'Original behalten'),
        el('button', { class: 'btn primary', value: 'apply' }, 'Vorschlag übernehmen'))))
    dialog.addEventListener('close', () => { dialog.remove(); resolve(dialog.returnValue === 'apply') }, { once: true })
    document.body.append(dialog)
    dialog.showModal()
  })
}

function guideDetails(model) {
  const guide = model.guides?.[taskNow()]
  if (!guide) return null
  return el('details', { class: 'pg-scenes meta' },
    el('summary', {}, 'Prompt-Hilfe · ' + model.title),
    el('p', {}, guide.tip),
    guide.schemaHint && el('p', {}, el('strong', {}, 'Aus dem Eingabeschema · '), guide.schemaHint),
    guide.source && el('a', { href: guide.source, target: '_blank', rel: 'noopener noreferrer' }, 'Modell-Dokumentation'))
}

async function pickReferences() {
  const items = [...await api('/assets?library=clips'), ...await api('/assets?library=generation')].filter(i => i.media_type?.startsWith('image/') || i.preview)
  for (const item of items) assetCache.set(item.id, item)
  const chosen = new Set(pg.refs)
  const grid = el('div', { class: 'pick-grid' }, items.map(item => withFullscreen(item, el('button', { type: 'button', class: 'pick' + (chosen.has(item.id) ? ' on' : ''), 'aria-pressed': String(chosen.has(item.id)), 'aria-label': item.title, onclick: e => {
    chosen.has(item.id) ? chosen.delete(item.id) : chosen.add(item.id)
    e.currentTarget.classList.toggle('on'); e.currentTarget.setAttribute('aria-pressed', String(chosen.has(item.id)))
  } }, media(item)))))
  const dialog = el('dialog', { 'aria-label': 'Referenzen wählen' }, el('form', { method: 'dialog' },
    el('div', { style: 'display:flex;align-items:center;gap:12px' }, el('h2', { style: 'margin-right:auto' }, 'Referenzen wählen'),
      // Files from the Mac land in the Sammlung and are attached at once.
      uploadButton({ label: 'Vom Mac hochladen', onDone: created => { dialog.close(); updateReferences([...new Set([...pg.refs, ...created.filter(a => a.media_type?.startsWith('image/')).map(a => a.id)])].slice(0, 16)) } })),
    items.length ? grid : el('p', {}, 'In Sammlung und Library gibt es noch keine Bilder.'),
    el('div', { class: 'row' }, el('button', { class: 'btn ghost', value: 'no' }, 'Abbrechen'), el('button', { class: 'btn primary', value: 'yes' }, 'Übernehmen'))))
  dialog.addEventListener('close', () => { if (dialog.returnValue === 'yes') { updateReferences([...chosen].slice(0, 16)) } dialog.remove() })
  document.body.append(dialog); dialog.showModal()
}

function composer() { return el('section', { class: 'studio-panel studio-composer pg-composer', id: 'pg-composer', role: 'form', 'aria-label': 'Neuer Lauf' }) }

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
  setPrompt(prompt.value)
}

function referenceRole(id, alias) {
  const roles = [['', 'Rolle frei'], ['Ausgangsbild', 'Ausgangsbild'], ['Identität', 'Person'], ['Kleidung', 'Kleidung'],
    ['Pose', 'Pose'], ['Ort', 'Ort'], ['Stil', 'Stil'], ['Komposition', 'Bildausschnitt'], ['Licht', 'Licht']]
  const select = el('select', { class: 'text-in pg-ref-role', 'aria-label': 'Rolle für ' + alias,
    title: 'Legt im gesendeten Prompt fest, wofür dieses Bild verwendet wird.',
    onchange: event => {
      pg.studio.roles ??= {}
      if (event.target.value) pg.studio.roles[id] = event.target.value
      else delete pg.studio.roles[id]
    } }, roles.map(([value, label]) => el('option', { value }, label)))
  select.value = pg.studio.roles?.[id] ?? ''
  return select
}

function subjectDirection() {
  const input = el('input', { class: 'text-in', type: 'text', maxlength: 700,
    placeholder: 'z. B. @Bild1, kurze schwarze Haare, Sommersprossen',
    title: 'Diese Vorgabe wird beim Rendern unverändert übernommen.',
    oninput: event => { pg.studio.appearance = event.target.value } })
  input.value = pg.studio.appearance ?? ''
  return el('div', { class: 'pg-direction' },
    el('label', { class: 'field' }, el('span', {}, 'Aussehen der Person'), input))
}

function referencePanel(tray) {
  const input = el('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true })
  const drop = el('button', { type: 'button', class: 'photo-drop', onclick: () => input.click() },
    icon('upload'), el('span', {}, 'Bilder ablegen oder auswählen'))
  const notice = el('span', { class: 'meta', role: 'status' })
  let uploading = false
  async function attach(files) {
    if (uploading) return
    const images = [...files].filter(file => file.type.startsWith('image/'))
    const available = 16 - pg.refs.length
    if (!available) return toast('Du kannst höchstens 16 Bilder anhängen.', true)
    if (!images.length) return toast('Wähle Bilddateien als Referenz.', true)
    uploading = drop.disabled = true
    notice.textContent = 'Lädt Bilder …'
    try {
      const created = await uploadFiles(images.slice(0, available))
      if (created.length && currentRoute() === 'playground') updateReferences([...new Set([...pg.refs, ...created.map(item => item.id)])].slice(0, 16))
    } catch (error) { toast(error.message, true) }
    finally { uploading = drop.disabled = false; notice.textContent = ''; input.value = '' }
  }
  drop.addEventListener('dragover', event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault() })
  drop.addEventListener('drop', event => {
    if (!event.dataTransfer.files.length) return
    event.preventDefault()
    void attach(event.dataTransfer.files)
  })
  input.addEventListener('change', () => void attach(input.files))
  return el('section', { class: 'photo-references' },
    el('div', { class: 'studio-ref-head' }, el('span', {}, 'Referenzbilder'),
      el('button', { type: 'button', class: 'btn sm', onclick: pickReferences }, 'Aus Atelier wählen')),
    input, drop, notice, tray)
}

function redrawComposer() {
  const box = $('#pg-composer')
  if (!box) return
  syncReferenceLabels()
  const tray = el('div', { class: 'tray', 'aria-label': 'Bildreferenzen' })
  const prompt = el('textarea', { id: 'pg-prompt', rows: 7, placeholder: pg.refs.length ? 'Optional · Was soll entstehen oder sich ändern?' : 'Was soll entstehen?', 'aria-label': 'Prompt', oninput: e => setPrompt(e.target.value) })
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
      frame.append(item ? withFullscreen(item, thumb) : thumb,
        el('button', { type: 'button', class: 'btn sm pg-ref-mark', title: item?.title, 'aria-label': `${alias} in den Prompt einfügen${item ? ': ' + item.title : ''}`, onmousedown: e => { if (document.activeElement === prompt) e.preventDefault() }, onclick: () => insertReference(prompt, alias) }, alias))
      if (pg.nsfw) frame.append(referenceRole(id, alias))
    }).catch(error => toast(error.message, true))
  }
  const selection = el('span')
  const startLabel = pg.submitting ? 'Reicht ein …' : 'Generieren'
  const start = el('button', { type: 'button', class: 'btn primary', onclick: startRun, 'aria-label': startLabel,
    'aria-keyshortcuts': 'Meta+Enter Control+Enter' }, startLabel, el('span', { class: 'kbd', 'aria-hidden': 'true' }, '⌘↵'))
  const settings = el('button', { type: 'button', class: 'pill', onclick: settingsDialog }, icon('sliders'), el('span'))
  const status = el('span', { class: 'meta', style: 'flex:1;min-width:120px' })
  const modelFields = el('div', { class: 'pg-direction pg-model-params', 'aria-label': 'Modellparameter am Prompt', role: 'group' })
  const guides = el('div', { class: 'photo-guides' })
  function updateSelection() {
    const chosen = selectedModels()
    const capable = chosen.filter(m => m.variants[taskNow()])
    guides.replaceChildren(...capable.map(guideDetails).filter(Boolean))
    const skipped = chosen.filter(m => !m.variants[taskNow()])
    const model = capable[0] ?? chosen[0]
    const variant = model?.variants[taskNow()]
    const changed = model ? Object.keys((variant && pg.modelParams[paramKey(model)]) ?? pg.params).length : 0
    selection.textContent = chosen.length > 1 ? `${chosen.length} Modelle` : model?.title ?? 'Modell wählen'
    start.disabled = !capable.length || pg.submitting
    repeats.hidden = usesModelCount(capable)
    settings.lastElementChild.textContent = changed ? `Einstellungen (${changed})` : 'Einstellungen'
    modelFields.replaceChildren(...quickModelSettings(model, variant, () => {
      const count = Object.keys(pg.modelParams[paramKey(model)]).length
      settings.lastElementChild.textContent = count ? `Einstellungen (${count})` : 'Einstellungen'
    }))
    const names = list => list.map(m => m.title).join(', ')
    status.textContent = chosen.length && !capable.length
      ? (taskNow() === 'edit' ? `${names(skipped)} ${skipped.length === 1 ? 'bearbeitet' : 'bearbeiten'} keine Bilder. Entferne die Referenzen oder wähle ein anderes Modell.` : `${names(skipped)} ${skipped.length === 1 ? 'braucht' : 'brauchen'} ein Eingabebild. Hänge ein Bild an.`)
      : skipped.length ? `${names(skipped)} wird übersprungen.` : chosen.length > 1 ? `Vergleich: ${capable.length} Modelle, je ${pg.count}×. Kosten zeigt der Anbieter nach dem Lauf.` : ''
  }
  const repeats = el('div', { class: 'seg', role: 'group', 'aria-label': 'Anzahl je Modell' },
    [1, 2, 4].map(n => el('button', { type: 'button', 'aria-pressed': String(pg.count === n),
      onclick: () => { pg.count = n; redrawComposer() } }, n + '×')))
  updateSelection()
  prompt.addEventListener('keydown', e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); startRun() } })
  const words = el('input', { type: 'text', class: 'text-in', placeholder: 'Stichworte für Scrabble', maxlength: 300,
    'aria-label': 'Stichworte für Scrabble', value: pg.words ?? '', oninput: e => { pg.words = e.target.value },
    onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); rollScrabble() } } })
  box.replaceChildren(
    el('header', { class: 'studio-panel-head' }, el('h2', {}, 'Eingabe'),
      el('div', { class: 'photo-model-pick' }, ...modelPicker(selection, updateSelection))),
    el('div', { class: 'photo-composer-body' },
      el('label', { class: 'field', for: 'pg-prompt' }, el('span', {}, 'Prompt')),
      el('div', { class: 'pg-prompt-panel' }, el('div', { class: 'pg-input' }, prompt)),
      el('div', { class: 'photo-scrabble' }, words,
        el('button', { type: 'button', class: 'btn sm pg-scrabble', onclick: rollScrabble, disabled: pg.scrabbleBusy }, pg.scrabbleBusy ? 'Schreibt …' : 'Scrabble'),
        el('button', { type: 'button', class: 'icon', 'aria-label': 'Vorherigen Prompt wiederherstellen',
          disabled: !pg.scrabbleUndo?.length || null, onclick: undoScrabble }, icon('undo'))),
      guides, referencePanel(tray),
      pg.nsfw && subjectDirection(), sceneEditors(), modelFields),
    el('div', { class: 'photo-footer' },
      el('div', { class: 'pg-bar' }, repeats, settings),
      status, start))
}

async function startRun() {
  if (pg.submitting) return
  const capable = selectedModels().filter(model => model.variants[taskNow()])
  if (!pg.prompt.trim() && !pg.refs.length) return toast('Schreib einen Prompt oder hänge Referenzbilder an.', true)
  if (activeScenes()?.some(scene => !scene.trim())) return toast('Fülle alle Bildprompts aus.', true)
  if (!capable.length) return pg.models.length ? $('#pg-model-picker')?.showPopover() : modelsDialog()
  const count = usesModelCount(capable) ? 1 : pg.count
  pg.submitting = true
  redrawComposer()
  try {
    const run = await pgApi('/runs', 'POST', { prompt: pg.prompt, modelIds: capable.map(m => m.id), referenceIds: pg.refs,
      params: pg.params, studio: studioForRun(), modelParams: pg.modelParams, count, projectId: pg.projectId || undefined })
    pg.runs.unshift(run)
    selectPhotoRun(run.id)
  } catch (error) { toast(error.message, true) }
  finally { pg.submitting = false; redrawComposer() }
}
