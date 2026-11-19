/**
 * Styler: virtual try-on as a template of the Playground. Image 1 is a Fashion-Referenz (a studio
 * shot of the wearer), every further image supplies one garment. Runs go through the Playground
 * plugin, so model choice, parameters, history, errors and costs behave as there.
 */
import { categories, materials, fashionReference, tryOnPrompt, cards, consistency } from './prompts.mjs'

const PG = '/creativity-playground/api'
const pgApi = (path, method = 'GET', body) => fetch(PG + path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined })
  .then(async r => { const text = await r.text(); const data = text ? JSON.parse(text) : null; if (!r.ok) throw new Error(data?.error || `Der Playground antwortet mit ${r.status}.`); return data })
const remember = (key, value) => { try { localStorage.setItem('atelier:styler:' + key, JSON.stringify(value)) } catch { /* Ohne Browser-Speicher gilt die Auswahl nur bis zum Neuladen. */ } }
const recall = key => { try { return JSON.parse(localStorage.getItem('atelier:styler:' + key)) } catch { return null /* Speicher gesperrt: Standardwert. */ } }

export async function render(container, { el, api, media, withFullscreen, isFashionReference, toast, refreshCounts, projects, params, uploadButton }) {
  const [clips, generated, models] = await Promise.all([api('/assets?library=clips'), api('/assets?library=generation'), pgApi('/models').catch(() => [])])
  const images = [...clips, ...generated].filter(a => a.media_type?.startsWith('image/') || (!a.media_type && a.preview))
  const editors = models.filter(m => m.variants?.edit)
  const state = {
    person: null,
    reference: generated.find(item => item.id === params.get('ref') && isFashionReference(item)) ?? null,
    pieces: new Map(),
    modelId: editors.some(m => m.id === recall('model')) ? recall('model') : editors[0]?.id ?? null,
    projectId: recall('project') ?? '',
    busy: false,
    runs: [],
  }

  const modelSel = el('select', { class: 'text-in', 'aria-label': 'Modell', onchange: e => { state.modelId = e.target.value; remember('model', state.modelId); draw() } },
    editors.map(m => el('option', { value: m.id, selected: m.id === state.modelId || null }, `${m.title} · ${m.providerTitle}`)))
  const projectSel = el('select', { class: 'text-in', 'aria-label': 'Ziel-Projekt', onchange: e => { state.projectId = e.target.value; remember('project', state.projectId) } },
    el('option', { value: '' }, 'Nur Library'), projects.map(p => el('option', { value: p.id, selected: p.id === state.projectId || null }, p.title)))
  const body = el('div', { class: 'styler' })
  const history = el('section', { class: 'styler-history', 'aria-label': 'Letzte Anproben' })
  container.replaceChildren(body, history)

  /** Picker with search; `filter` narrows the candidates for the slot. */
  function choose(title, candidates, onSelect, empty) {
    const search = el('input', { class: 'text-in', type: 'search', placeholder: 'Suchen', 'aria-label': 'Bilder durchsuchen' })
    const grid = el('div', { class: 'pick-grid' })
    const fill = () => {
      const q = search.value.trim().toLowerCase()
      const list = candidates.filter(item => !q || (item.title + ' ' + (item.description ?? '')).toLowerCase().includes(q))
      grid.replaceChildren(...(list.length ? list.map(item => withFullscreen(item, el('button', { type: 'button', class: 'styler-choice', onclick: () => { dialog.close(); onSelect(item); draw() } },
        el('span', { class: 'pick' }, media(item)), el('span', { class: 'meta' }, item.title)))) : [el('p', { class: 'meta' }, q ? 'Keine Treffer.' : empty)]))
    }
    search.oninput = fill
    const dialog = el('dialog', { class: 'pg-editor styler-picker', 'aria-label': title, style: 'width:min(880px, calc(100vw - 32px))' },
      el('form', { method: 'dialog' }, el('div', { style: 'display:flex;align-items:center;gap:12px' }, el('h2', { style: 'margin-right:auto' }, title),
        uploadButton?.({ label: 'Vom Mac hochladen', onDone: created => { const image = created.find(a => a.media_type?.startsWith('image/')); if (!image) return; images.unshift(image); dialog.close(); onSelect(image); draw() } })),
        search, grid, el('div', { class: 'row' }, el('button', { class: 'btn ghost' }, 'Abbrechen'))))
    dialog.onclose = () => dialog.remove()
    document.body.append(dialog)
    fill()
    dialog.showModal()
    search.focus()
  }

  const thumb = item => withFullscreen(item, el('span', { class: 'styler-thumb' }, media(item)))
  const reason = text => el('p', { class: 'meta styler-reason' }, text)

  async function startRun({ prompt, referenceIds, roles, aspect, title, onDone }) {
    if (state.busy) return
    const model = editors.find(m => m.id === state.modelId)
    if (!model) return toast('Füge im Playground ein Modell hinzu, das Bilder bearbeiten kann.', true)
    state.busy = true
    draw()
    try {
      const aspectField = model.variants.edit.fields.find(f => f.key === 'aspect_ratio' && f.options?.includes(aspect))
      const run = await pgApi('/runs', 'POST', {
        prompt, modelIds: [model.id], referenceIds, count: 1, title, template: 'styler',
        studio: { roles, referenceLabels: Object.fromEntries(referenceIds.map((id, i) => [id, i + 1])) },
        modelParams: aspectField ? { [model.id]: { aspect_ratio: aspect } } : {},
        projectId: state.projectId || undefined,
      })
      state.runs.unshift(run)
      drawHistory()
      const done = await waitFor(run.id)
      const result = done.results[0]
      if (result.status === 'done') {
        const asset = (await api('/assets?library=generation')).find(a => a.id === result.assetIds[0])
        if (asset) { images.unshift(asset); onDone?.(asset) }
        toast(title + ' ist fertig und liegt in der Library.')
        await refreshCounts()
      } else toast(result.error, true)
    } catch (error) { toast(error.message, true) }
    finally { state.busy = false; draw(); drawHistory() }
  }

  async function waitFor(id) {
    for (;;) {
      await new Promise(resolve => setTimeout(resolve, 2500))
      const run = (await pgApi('/runs')).find(r => r.id === id)
      if (!run) throw new Error('Der Lauf ist nicht mehr im Verlauf.')
      state.runs = state.runs.map(r => r.id === id ? run : r)
      drawHistory()
      if (run.results.every(r => r.status !== 'running')) return run
    }
  }

  function drawHistory() {
    const own = state.runs.filter(r => r.template === 'styler').slice(0, 12)
    history.replaceChildren(...(own.length ? [el('h2', {}, 'Letzte Anproben'), el('div', { class: 'styler-results' }, own.map(run => {
      const result = run.results[0] ?? {}
      const pic = result.status === 'done' && result.assetIds?.[0]
        ? el('a', { class: 'styler-result', href: '#/playground?ref=' + result.assetIds[0], title: 'Im Playground weiterarbeiten' }, el('img', { src: '/creativity-hub/api/media/' + result.assetIds[0], alt: run.title || 'Anprobe', loading: 'lazy' }))
        : el('div', { class: 'styler-result ' + (result.status === 'running' ? 'pg-wait' : 'pg-fail') }, el('span', {}, result.status === 'running' ? `Läuft bei ${result.provider}…` : result.error))
      return el('figure', { class: 'pg-fig' }, pic, el('figcaption', {}, el('span', { class: 'm' }, run.title || 'Anprobe'), el('span', { class: 'meta' }, [result.title, result.credits ? result.credits + ' Credits' : ''].filter(Boolean).join(' · '))))
    }))] : []))
  }

  function draw() {
    const model = editors.find(m => m.id === state.modelId)
    const step = (n, title, done, ...content) => el('section', { class: 'styler-step' + (done ? ' done' : ''), 'aria-label': title },
      el('h2', {}, el('span', { class: 'n', 'aria-hidden': 'true' }, String(n)), title), ...content)

    // Schritt 1: Fashion-Referenz
    const makeFromPerson = el('button', { type: 'button', class: 'btn', disabled: state.busy || !state.person || !model || null, onclick: () => startRun({
      prompt: fashionReference, referenceIds: [state.person.id], roles: { [state.person.id]: 'Identität' }, aspect: '9:16',
      title: 'Fashion-Referenz · ' + state.person.title, onDone: asset => { state.reference = asset },
    }) }, 'Fashion-Referenz erstellen')
    const references = images.filter(isFashionReference)
    const step1 = step(1, 'Fashion-Referenz', !!state.reference,
      el('p', { class: 'meta' }, 'Ein Studio-Ganzkörperbild der Person, an dem anprobiert wird. Einmal erstellen, dann immer wieder nutzen.'),
      el('div', { class: 'styler-row' },
        state.reference && thumb(state.reference),
        el('button', { type: 'button', class: 'btn' + (state.reference ? '' : ' primary'), disabled: state.busy || null, onclick: () => choose('Fashion-Referenz wählen', references, item => { state.reference = item }, 'Noch keine Fashion-Referenz. Erstelle unten eine aus einem Personenfoto.') }, state.reference ? 'Andere wählen' : 'Fashion-Referenz wählen')),
      el('details', { class: 'styler-more', open: !references.length || null },
        el('summary', {}, 'Neu aus einem Personenfoto'),
        el('div', { class: 'styler-row' },
          state.person && thumb(state.person),
          el('button', { type: 'button', class: 'btn', disabled: state.busy || null, onclick: () => choose('Personenfoto wählen', images.filter(i => !isFashionReference(i)), item => { state.person = item }, 'Lege zuerst ein Foto in die Sammlung.') }, state.person ? 'Anderes Foto' : 'Personenfoto wählen'),
          makeFromPerson),
        !model ? reason('Füge im Playground ein Modell hinzu, das Bilder bearbeiten kann.') : !state.person ? reason('Wähle ein Foto, auf dem die Person gut zu sehen ist.') : null),
      state.reference && el('details', { class: 'styler-more' },
        el('summary', {}, 'Weitere Ansichten der Referenz'),
        el('div', { class: 'styler-row' }, Object.entries(cards).map(([key, [title, aspect, prompt]]) => el('button', { type: 'button', class: 'btn sm', disabled: state.busy || !model || null, onclick: () => startRun({
          prompt: prompt + '\n' + consistency, referenceIds: [state.reference.id], roles: { [state.reference.id]: 'Ausgangsbild' }, aspect, title: title + ' · ' + state.reference.title,
        }) }, title)))))

    // Schritt 2: Kleidung
    const blocked = new Set([...state.pieces.keys()].flatMap(id => categories.find(c => c.id === id).excludes))
    const garments = images.filter(i => !isFashionReference(i) && i.id !== state.reference?.id)
    const step2 = step(2, 'Kleidung', state.pieces.size > 0,
      el('div', { class: 'styler-garments' }, categories.map(category => {
        const piece = state.pieces.get(category.id)
        const off = blocked.has(category.id) && !piece
        return el('div', { class: 'styler-garment' + (piece ? ' set' : '') },
          piece ? thumb(piece.item) : el('span', { class: 'styler-thumb empty', 'aria-hidden': 'true' }),
          el('div', { class: 'styler-garment-body' },
            el('b', {}, category.id),
            off ? el('span', { class: 'meta' }, 'Ersetzt durch ' + [...state.pieces.keys()].find(k => categories.find(c => c.id === k).excludes.includes(category.id))) :
              piece ? el('label', { class: 'pill' }, el('select', { 'aria-label': `Material ${category.id}`, onchange: e => { piece.material = e.target.value } },
                Object.entries(materials).map(([key, m]) => el('option', { value: key, selected: key === piece.material || null }, m.label)))) : el('span', { class: 'meta' }, 'Leer')),
          el('div', { class: 'styler-garment-actions' },
            el('button', { type: 'button', class: 'btn sm', disabled: off || state.busy || null, onclick: () => choose(category.id + ' wählen', garments, item => {
              state.pieces.set(category.id, { item, material: /latex|rubber|gummi/i.test(item.title + ' ' + (item.description ?? '')) ? 'latex' : 'auto' })
              for (const other of category.excludes) state.pieces.delete(other)
            }, 'Lege Kleidungsfotos in die Sammlung.') }, piece ? 'Wechseln' : 'Wählen'),
            piece && el('button', { type: 'button', class: 'icon', 'aria-label': `${category.id} entfernen`, disabled: state.busy || null, onclick: () => { state.pieces.delete(category.id); draw() } },
              Object.assign(document.createElementNS('http://www.w3.org/2000/svg', 'svg'), { innerHTML: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>' }))))
      })))
    step2.querySelectorAll('.icon svg').forEach(s => s.setAttribute('viewBox', '0 0 24 24'))

    // Schritt 3: Anprobe
    const ordered = categories.filter(c => state.pieces.has(c.id)).map(c => ({ category: c.id, ...state.pieces.get(c.id) }))
    const missing = !model ? 'Füge im Playground ein Modell hinzu, das Bilder bearbeiten kann.' : !state.reference ? 'Wähle zuerst eine Fashion-Referenz (Schritt 1).' : !ordered.length ? 'Wähle mindestens ein Kleidungsstück (Schritt 2).' : state.busy ? 'Ein Auftrag läuft gerade.' : ''
    const tryOn = el('button', { type: 'button', class: 'btn primary', disabled: !!missing || null, onclick: () => {
      const ids = [state.reference.id, ...ordered.map(p => p.item.id)]
      startRun({
        prompt: tryOnPrompt(ordered.map(({ category, material }) => ({ category, material }))), referenceIds: ids,
        roles: Object.fromEntries([[state.reference.id, 'Ausgangsbild'], ...ordered.map(p => [p.item.id, 'Kleidung'])]),
        aspect: 'auto', title: 'Anprobe · ' + ordered.map(p => p.item.title).join(' + ').slice(0, 120),
      })
    } }, 'Anprobieren')
    const step3 = step(3, 'Anprobe', false,
      el('div', { class: 'styler-row' }, el('label', { class: 'field' }, el('span', {}, 'Modell'), modelSel), el('label', { class: 'field' }, el('span', {}, 'Ziel'), projectSel)),
      el('div', { class: 'styler-row' }, tryOn, missing ? reason(missing) : el('span', { class: 'meta' }, 'Kosten zeigt der Anbieter nach dem Lauf. Das Ergebnis landet in der Library.')))

    body.replaceChildren(step1, step2, step3)
  }

  state.runs = (await pgApi('/runs').catch(() => [])).filter(r => r.template === 'styler')
  draw()
  drawHistory()
}
