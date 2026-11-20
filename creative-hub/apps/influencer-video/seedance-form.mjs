import { referenceKinds, seedanceAspects, seedanceFormats, seedanceFrames, seedanceModes,
  seedanceResolutions, seedanceTasks } from './seedance-options.mjs'

const modes = [...seedanceModes, ['audio', 'Audio zu Video']]
const modeLabels = { text: 'Text', frames: 'Keyframes', references: 'Referenzen', audio: 'Audio' }
const referenceName = (kind, index) => '@' + kind[0].toUpperCase() + kind.slice(1) + (index + 1)

export function seedanceForm({ el, icon, select, field, choose, upload, media, withFullscreen, preview, update, insertMark, removeMark, initial, initialDuration, hotapi = false }) {
  const options = values => values.map(value => [value, value === 'adaptive' ? 'Adaptiv' : value])
  let mode = initial ? 'frames' : 'text'
  const task = select(hotapi ? seedanceTasks.filter(([id]) => id !== 'edit') : seedanceTasks)
  const direction = select([['after', 'Am Ende anhängen'], ['before', 'Am Anfang voranstellen']])
  const directionField = field('Anschluss', direction)
  const extensionHelp = el('p', { class: 'meta studio-note' })
  const durationLabel = el('span', {}, 'Dauer')
  const aspect = select(options(seedanceAspects))
  const duration = select([...(hotapi ? [] : [['-1', 'Automatisch']]), ...Array.from({ length: 27 }, (_, i) => [String(i + 4), (i + 4) + ' s'])])
  let requestedDuration = String(initialDuration ?? 5)
  const resolution = select(options(hotapi ? [...seedanceResolutions, '1080p'] : seedanceResolutions))
  const format = select(options(seedanceFormats))
  const check = (name, checked = false) => {
    const input = el('input', { type: 'checkbox', checked })
    return [input, el('label', { class: 'studio-toggle' }, input, el('span', {}, name))]
  }
  const [audio, audioField] = check('Ton erzeugen', !hotapi)
  const [lastFrame, lastFrameField] = check('Schlussbild für die nächste Einstellung speichern', true)
  const [webSearch, webSearchField] = check('Websuche')
  const [filter, filterField] = check('Inhaltsfilter', true)
  const refs = { image: [], video: [], audio: [] }
  const frames = { first: initial, last: undefined }
  const button = (label, onclick) => el('button', { type: 'button', class: 'btn sm', onclick }, label)
  const modeButtons = modes.map(([id, label]) => {
    const tab = button(modeLabels[id], () => { mode = id; refresh(); update() })
    tab.title = label
    return tab
  })
  const tabs = el('div', { class: 'studio-modes', role: 'group', 'aria-label': 'Seedance-Modus' }, modeButtons)
  const frameFields = el('section', { class: 'studio-keyframes', 'aria-label': 'Keyframes' },
    frameSlot('first', 'Startframe', 'Erforderlich'), frameSlot('last', 'Endframe', 'Optional'))

  function frameSlot(key, label, subtitle) {
    const previewBox = el('div', { class: 'studio-ref-visual' })
    const caption = el('span', { class: 'meta studio-caption' })
    const remove = button('Entfernen', () => set(undefined))
    const tile = el('div', { class: 'studio-ref-card', role: 'group', 'aria-label': label },
      el('div', { class: 'studio-ref-head' }, el('b', {}, label), el('span', { class: 'meta' }, subtitle)),
      previewBox, caption,
      el('div', { class: 'studio-ref-buttons' }, button('Wählen', () => choose(seedanceFrames, label + ' wählen', set)),
        upload(seedanceFrames, set, label + ' hochladen', { dropTarget: previewBox, compact: true }), remove))
    function set(item) {
      frames[key] = item
      const image = item ? withFullscreen(item, media(item)) : el('div', { class: 'studio-ref-empty' }, icon('image'), el('span', {}, 'Bild ablegen'))
      previewBox.replaceChildren(image)
      caption.textContent = item?.title ?? ''
      caption.title = item?.title ?? ''
      caption.hidden = !item
      remove.hidden = !item
      if (item && tile.isConnected) preview(item)
      if (tile.isConnected) update()
    }
    set(frames[key])
    return tile
  }

  function referenceSlot(kind, label, types, max) {
    const list = el('div', { class: 'studio-reference-grid' })
    const count = el('span', { class: 'studio-count' })
    const group = el('div', { class: 'studio-reference-group', role: 'group', 'aria-label': label + 'referenzen' })
    const actions = el('div', { class: 'studio-ref-buttons' })
    const add = item => {
      if (refs[kind].length >= max || refs[kind].some(ref => ref.id === item.id)) return
      refs[kind].push(item)
      draw()
      update()
    }
    const picker = button('Wählen', () => choose(types, label + ' wählen', add, refs[kind].map(item => item.id)))
    picker.setAttribute('aria-label', label + ' wählen')
    const uploadControl = upload(types, add, label + ' hochladen', { dropTarget: group, compact: true, capacity: () => max - refs[kind].length })
    const prefix = referenceName(kind, 0).slice(0, -1)
    group.append(el('div', { class: 'studio-ref-head' }, el('b', {}, label), count), list, actions)
    actions.append(picker, uploadControl)
    function draw() {
      count.textContent = refs[kind].length + '/' + max
      picker.hidden = uploadControl.hidden = refs[kind].length >= max
      list.replaceChildren(...refs[kind].map((item, index) => {
        const mark = referenceName(kind, index)
        const visual = kind === 'audio' ? icon('wave') : media(item)
        return el('div', { class: 'studio-ref-card', role: 'group', 'aria-label': mark },
          el('div', { class: 'studio-ref-head' }, button(mark, () => insertMark(mark)),
            kind === 'video' && index === 0 && el('small', { 'data-extension-source': '', hidden: task.value !== 'extend' }, 'Ausgangsclip')),
          el('button', { type: 'button', class: 'studio-ref-visual studio-reference-preview', 'aria-label': item.title + ' in der Vorschau öffnen',
            onclick: () => preview(item, mark) }, visual),
          el('span', { class: 'studio-caption meta', title: item.title }, item.title),
          button('Entfernen', () => {
            refs[kind].splice(index, 1)
            removeMark(prefix, index + 1)
            draw()
            update()
          }))
      }))
    }
    draw()
    return { group, draw }
  }

  const slots = Object.fromEntries(referenceKinds.map(args => [args[0], referenceSlot(...args)]))
  const taskField = field('Referenzaufgabe', task)
  const references = el('section', { class: 'studio-references', 'aria-label': 'Referenzen' },
    taskField, directionField, extensionHelp, ...Object.values(slots).map(slot => slot.group),
    el('span', { class: 'meta' }, 'Videos und Audios je 2–30 s. Insgesamt bis zu 30 s pro Medientyp.'))
  const settings = el('div', { class: 'pg-fields' },
    el('div', { class: 'studio-output', role: 'group', 'aria-label': 'Seedance-Ausgabe' },
      field('Auflösung', resolution), el('label', { class: 'field' }, durationLabel, duration), field('Seitenverhältnis', aspect)),
    audioField, lastFrameField,
    el('details', { class: 'styler-more' }, el('summary', {}, 'Weitere Einstellungen'),
      el('div', { class: 'pg-fields' }, field('Ausgabeformat', format), ...(hotapi ? [] : [webSearchField, filterField]))))

  const isReferences = () => mode === 'references' || mode === 'audio'
  const activeTask = () => mode === 'audio' ? 'reference' : mode === 'references' ? task.value : undefined
  const activeRefs = () => mode === 'audio' ? { audio: refs.audio } : mode === 'references' ? refs : {}
  function refresh() {
    const editing = activeTask() === 'edit'
    const extending = activeTask() === 'extend'
    modeButtons.forEach((tab, index) => tab.setAttribute('aria-pressed', String(modes[index][0] === mode)))
    directionField.hidden = !extending
    extensionHelp.hidden = !extending && activeTask() !== 'auto' && mode !== 'audio'
    extensionHelp.textContent = mode === 'audio'
      ? 'Nutze @Audio1 im Prompt, um Bewegung, Schnitt oder Stimmung auf den Ton abzustimmen.'
      : extending ? '@Video1 ist der Ausgangsclip. Atelier setzt beide Abschnitte zu einer Datei zusammen.'
        : 'Für einen zusammenhängenden Clip wähle „Referenzvideo verlängern“.'
    durationLabel.textContent = extending ? 'Zusätzliche Dauer' : 'Dauer'
    for (const label of references.querySelectorAll('[data-extension-source]')) label.hidden = !extending
    frameFields.hidden = mode !== 'frames'
    references.hidden = !isReferences()
    taskField.hidden = mode !== 'references'
    slots.image.group.hidden = slots.video.group.hidden = mode === 'audio'
    webSearchField.hidden = mode !== 'text'
    aspect.disabled = mode === 'frames' || editing || extending
    if (aspect.disabled) aspect.value = 'adaptive'
    duration.disabled = editing
    duration.value = editing ? '-1' : requestedDuration
  }
  task.onchange = () => { refresh(); update() }
  direction.onchange = audio.onchange = update
  duration.onchange = () => { requestedDuration = duration.value; update() }
  refresh()
  return {
    tabs,
    inputs: el('div', {}, frameFields, references),
    settings,
    get mode() { return mode },
    get needsPrompt() { return mode !== 'frames' },
    get hasInput() {
      if (mode === 'frames') return Boolean(frames.first)
      if (mode === 'text') return true
      return ['edit', 'extend'].includes(activeTask()) ? refs.video.length > 0 : Object.values(activeRefs()).some(items => items.length)
    },
    setExtension(item) {
      for (let i = refs.video.length; i > 0; i--) removeMark('@Video', i)
      refs.video.splice(0, refs.video.length, item)
      mode = 'references'
      task.value = 'extend'
      direction.value = 'after'
      slots.video.draw()
      refresh()
      update()
    },
    promptContext() {
      const references = Object.entries(activeRefs()).flatMap(([kind, items]) => items.map((item, index) => ({
        kind, id: item.id, title: item.title, mark: referenceName(kind, index),
      })))
      return { mode: isReferences() ? 'references' : mode, task: activeTask(), duration: Number(duration.value),
        audio: audio.checked, extensionDirection: activeTask() === 'extend' ? direction.value : undefined,
        startFrame: mode === 'frames' ? frames.first?.id : undefined,
        endFrame: mode === 'frames' ? frames.last?.id : undefined, references }
    },
    payload() {
      const data = { model: hotapi ? 'seedance-hotapi' : 'seedance', mode: isReferences() ? 'references' : mode, settings: {
        task: activeTask(), resolution: resolution.value, aspect: aspect.value, duration: Number(duration.value), format: format.value,
        audio: audio.checked, lastFrame: lastFrame.checked, webSearch: webSearch.checked, filter: filter.checked,
      } }
      if (mode === 'frames') Object.assign(data, { imageId: frames.first.id, endId: frames.last?.id })
      if (activeTask() === 'extend') data.extensionDirection = direction.value
      if (isReferences()) data.referenceIds = Object.fromEntries(Object.entries(activeRefs()).map(([kind, items]) => [kind, items.map(item => item.id)]))
      return data
    },
  }
}
