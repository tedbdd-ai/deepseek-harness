// Schnitt: Zeitleiste mit Bildspur, Musik und Ton. Der Schnitt liegt in app_data(schnitt) des Projekts.
const PPS = 56 // Pixel pro Sekunde in der Zeitleiste
const fmt = seconds => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}.${Math.floor((seconds % 1) * 10)}`
const mediaUrl = id => '/creativity-hub/api/media/' + encodeURIComponent(id)

export async function render(container, context) {
  const { el, api, icon, toast, projects, params } = context
  const project = projects.find(p => p.id === params.get('project')) ?? projects[0]
  if (!project) return container.replaceChildren(el('div', { class: 'state' }, el('h2', {}, 'Noch kein Projekt'), el('p', {}, 'Der Schnitt gehört zu einem Projekt. Lege über das Plus neben „Projekte“ eines an.')))
  container.replaceChildren(el('div', { class: 'canvas-skeleton', role: 'status', 'aria-label': 'Schnitt lädt' }, el('span'), el('span'), el('span'), el('span')))
  let record, library, status
  try {
    ;[record, library, status] = await Promise.all([
      api(`/projects/${project.id}/apps/schnitt`), api('/assets'),
      fetch('/creativity-schnitt/api/status').then(r => r.json()).catch(() => ({ ffmpeg: false })),
    ])
  } catch (error) {
    return container.replaceChildren(el('div', { class: 'state' }, el('h2', {}, 'Das hat nicht geklappt'), el('p', {}, error.message), el('button', { class: 'btn', onclick: () => render(container, context) }, 'Erneut versuchen')))
  }

  const doc = { clips: [], audio: [], ...record.data }
  let revision = record.revision, timer, saving = Promise.resolve(), selected = null, playhead = 0, playing = false, undo = null
  const assetOf = id => library.find(item => item.id === id)
  const durations = new Map()
  const probe = (id, kind) => durations.get(id) ?? durations.set(id, new Promise(resolve => {
    const node = document.createElement(kind)
    node.preload = 'metadata'
    node.onloadedmetadata = () => resolve(node.duration)
    node.onerror = () => resolve(0)
    node.src = mediaUrl(id)
  })).get(id)
  const clipLength = clip => clip.out - clip.in
  const total = () => doc.clips.reduce((sum, clip) => sum + clipLength(clip), 0)
  const status$ = el('span', { class: 'meta', role: 'status' })

  function save() {
    status$.textContent = 'Speichert …'
    clearTimeout(timer)
    timer = setTimeout(() => {
      saving = saving.then(async () => {
        try {
          const result = await api(`/projects/${project.id}/apps/schnitt`, 'PUT', { revision, data: { clips: doc.clips, audio: doc.audio } })
          revision = result.revision
          status$.textContent = 'Gespeichert'
        } catch (error) { status$.textContent = 'Speichern prüfen'; toast(error.message, true) }
      })
    }, 400)
  }
  const change = () => { save(); draw() }
  function offerUndo(label, restore) {
    undo = { label, restore }
    draw()
    setTimeout(() => { if (undo?.label === label) { undo = null; draw() } }, 10000)
  }

  async function addClip(assetId) {
    const length = await probe(assetId, 'video')
    if (!length) return toast('Dieses Video lässt sich nicht lesen.', true)
    doc.clips.push({ id: crypto.randomUUID(), assetId, in: 0, out: Math.round(length * 10) / 10 || length, volume: 1 })
    selected = doc.clips.at(-1).id
    change()
  }
  // Takes the current result of every Video node on the project's Flows canvas, in reading order (rows left to right).
  async function importFlow() {
    try {
      const [flow, response] = await Promise.all([api(`/projects/${project.id}/apps/flow`), fetch(`/creativity-flows/api/projects/${project.id}/state`)])
      const state = await response.json()
      if (!response.ok) throw new Error(state.error || 'Flows antwortet nicht.')
      const known = new Set(doc.clips.map(clip => clip.assetId))
      const nodes = (flow.data.nodes ?? []).filter(node => node.type === 'video').sort((a, b) => (a.y - b.y) || (a.x - b.x))
      const fresh = nodes.map(node => state.nodes[node.id]?.outputs?.video?.[0]).filter(id => id && !known.has(id))
      if (!fresh.length) return toast('Im Flow gibt es keine neuen fertigen Videos.')
      for (const id of fresh) await addClip(id)
      toast(fresh.length === 1 ? '1 Clip aus dem Flow übernommen.' : `${fresh.length} Clips aus dem Flow übernommen.`)
    } catch (error) { toast(error.message, true) }
  }
  async function addAudio(assetId) {
    const length = await probe(assetId, 'audio')
    doc.audio.push({ id: crypto.randomUUID(), assetId, start: 0, volume: 1, length: length || 0 })
    selected = doc.audio.at(-1).id
    change()
  }

  function pickDialog(kind) {
    const wanted = kind === 'video' ? item => item.media_type?.startsWith('video/') : item => item.media_type?.startsWith('audio/')
    const items = library.filter(wanted)
    const list = el('div', { class: 'similar-grid' }, items.map(item => el('button', { type: 'button', class: 'similar-item', title: item.title, onclick: () => { dialog.close(); kind === 'video' ? addClip(item.id) : addAudio(item.id) } },
      kind === 'video' ? context.media(item) : el('div', { class: 'link-card' }, icon('wave')), el('small', { class: 'meta' }, item.title.slice(0, 40)))))
    const upload = kind === 'audio' ? el('label', { class: 'btn' }, icon('upload'), 'Audiodatei hochladen', el('input', { type: 'file', accept: 'audio/mpeg,audio/wav,.mp3,.wav', hidden: true, onchange: async event => {
      const file = event.target.files[0]
      if (!file) return
      const type = /\.wav$/i.test(file.name) ? 'audio/wav' : /\.mp3$/i.test(file.name) ? 'audio/mpeg' : ''
      if (!type) return toast('Atelier nimmt MP3 und WAV an.', true)
      try {
        const bytes = new Uint8Array(await file.arrayBuffer())
        let binary = ''
        for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
        const created = await api('/assets', 'POST', { library: 'clips', title: file.name, media: btoa(binary), mediaType: type, projectId: project.id })
        library.unshift({ id: created.id, title: file.name, media_type: type })
        dialog.close(); await addAudio(created.id)
      } catch (error) { toast(error.message, true) }
    } })) : null
    const dialog = el('dialog', { class: 'wide', 'aria-label': kind === 'video' ? 'Clip hinzufügen' : 'Audio hinzufügen' }, el('form', { method: 'dialog' },
      el('h2', {}, kind === 'video' ? 'Clip hinzufügen' : 'Audio hinzufügen'),
      items.length ? list : el('p', { class: 'meta' }, kind === 'video' ? 'In Sammlung und Library gibt es noch kein Video. Erzeuge eines im Video Playground.' : 'Es gibt noch keine Audiodatei. Lade MP3 oder WAV hoch.'),
      el('div', { class: 'row' }, upload, el('button', { class: 'btn' }, 'Schließen'))))
    dialog.addEventListener('close', () => dialog.remove(), { once: true })
    document.body.append(dialog)
    dialog.showModal()
  }

  /* Vorschau: Videoclips nacheinander, Audiospuren daneben */
  const video = el('video', { class: 'cut-video', playsinline: true, 'aria-label': 'Vorschau' })
  const sounds = []
  function locate(t) {
    let at = 0
    for (const clip of doc.clips) { if (t < at + clipLength(clip) || clip === doc.clips.at(-1)) return { clip, offset: Math.min(Math.max(t - at, 0), clipLength(clip)), start: at }; at += clipLength(clip) }
    return null
  }
  function show(t) {
    playhead = Math.min(Math.max(t, 0), total())
    const spot = locate(playhead)
    if (!spot) return video.removeAttribute('src')
    const src = mediaUrl(spot.clip.assetId)
    if (!video.src.endsWith(src)) video.src = src
    video.volume = Math.min(spot.clip.volume, 1)
    video.currentTime = spot.clip.in + spot.offset
    drawPlayhead()
  }
  function stop() {
    playing = false
    video.pause()
    for (const sound of sounds.splice(0)) { clearTimeout(sound.timer); sound.node.pause() }
    draw()
  }
  function play() {
    if (!doc.clips.length) return
    if (playhead >= total() - 0.05) show(0)
    playing = true
    const origin = playhead
    video.play().catch(() => stop())
    for (const track of doc.audio) {
      const node = new Audio(mediaUrl(track.assetId))
      node.volume = Math.min(track.volume, 1)
      const sound = { node, timer: undefined }
      if (origin >= track.start) { node.currentTime = origin - track.start; node.play().catch(() => {}) } else sound.timer = setTimeout(() => node.play().catch(() => {}), (track.start - origin) * 1000)
      sounds.push(sound)
    }
    draw()
  }
  video.addEventListener('timeupdate', () => {
    if (!playing) return
    const spot = locate(playhead)
    if (!spot) return stop()
    const local = video.currentTime - spot.clip.in
    if (local >= clipLength(spot.clip) - 0.03) {
      const next = spot.start + clipLength(spot.clip)
      if (next >= total() - 0.03) { playhead = total(); return stop() }
      show(next); video.play().catch(() => stop()); return
    }
    playhead = spot.start + Math.max(local, 0)
    drawPlayhead()
  })

  const root = el('div', { class: 'cut' })
  const ruler = () => el('div', { class: 'cut-ruler', 'aria-hidden': 'true' }, Array.from({ length: Math.ceil(Math.max(total(), 10)) + 1 }, (_, s) => el('span', { style: `left:${s * PPS}px` }, s % 5 === 0 ? fmt(s) : '')))
  function block(item, left, width, label, track) {
    return el('button', { type: 'button', class: 'cut-block ' + track + (selected === item.id ? ' sel' : ''), style: `left:${left}px;width:${Math.max(width, 24)}px`, title: label,
      'aria-pressed': String(selected === item.id), onclick: () => { selected = item.id; draw() } }, el('span', {}, label))
  }
  function drawPlayhead() {
    const head = root.querySelector('.cut-playhead')
    if (head) head.style.left = playhead * PPS + 'px'
    const clock = root.querySelector('.cut-clock')
    if (clock) clock.textContent = `${fmt(playhead)} / ${fmt(total())}`
  }
  const field = (label, control) => el('label', { class: 'field' }, el('span', {}, label), control)

  function inspectorFor(item, kind) {
    const number = (key, step, min, max) => el('input', { class: 'text-in', type: 'number', step, min, max, value: String(Math.round(item[key] * 100) / 100), onchange: event => {
      const value = Number(event.target.value)
      if (!Number.isFinite(value)) return
      item[key] = value
      if (kind === 'clip') { item.in = Math.max(item.in, 0); if (item.out <= item.in) item.out = item.in + 0.1 }
      change()
    } })
    const remove = () => {
      const before = JSON.stringify({ clips: doc.clips, audio: doc.audio })
      doc[kind === 'clip' ? 'clips' : 'audio'] = doc[kind === 'clip' ? 'clips' : 'audio'].filter(entry => entry.id !== item.id)
      selected = null; change()
      offerUndo(kind === 'clip' ? 'Clip entfernt.' : 'Audiospur entfernt.', () => { Object.assign(doc, JSON.parse(before)); selected = item.id; change() })
    }
    const split = () => {
      const spot = locate(playhead)
      if (!spot || spot.clip.id !== item.id || spot.offset < 0.1 || clipLength(item) - spot.offset < 0.1) return toast('Setze den Abspielkopf in den Clip, nicht an den Rand.', true)
      const cut = item.in + spot.offset
      const second = { ...item, id: crypto.randomUUID(), in: cut }
      item.out = cut
      doc.clips.splice(doc.clips.indexOf(item) + 1, 0, second)
      selected = second.id; change()
    }
    const move = delta => { const i = doc.clips.indexOf(item), j = i + delta; if (j < 0 || j >= doc.clips.length) return; doc.clips.splice(j, 0, doc.clips.splice(i, 1)[0]); change() }
    const asset = assetOf(item.assetId)
    return el('aside', { class: 'cut-inspector' }, el('strong', {}, asset?.title ?? 'Datei fehlt'),
      kind === 'clip' ? [field('Anfang (s)', number('in', 0.1, 0)), field('Ende (s)', number('out', 0.1, 0)),
        el('div', { class: 'row' }, el('button', { type: 'button', class: 'btn sm', onclick: split }, icon('cut'), 'Am Abspielkopf teilen'),
          el('button', { type: 'button', class: 'btn sm', disabled: doc.clips.indexOf(item) === 0 || null, onclick: () => move(-1) }, 'Früher'),
          el('button', { type: 'button', class: 'btn sm', disabled: doc.clips.indexOf(item) === doc.clips.length - 1 || null, onclick: () => move(1) }, 'Später'))
      ] : field('Start (s)', number('start', 0.1, 0)),
      field('Lautstärke', el('input', { type: 'range', min: 0, max: 1, step: 0.05, value: String(Math.min(item.volume, 1)), 'aria-label': 'Lautstärke', onchange: event => { item.volume = Number(event.target.value); save() } })),
      kind === 'clip' ? el('a', { class: 'btn sm', href: '#/video-playground?ref=' + encodeURIComponent(item.assetId), title: 'Öffnet den Video Playground mit diesem Clip. Wähle dort „Verlängern“.' }, icon('wand'), 'Mit KI verlängern', el('span', { class: 'kbd' }, 'kostenpflichtig')) : null,
      el('button', { type: 'button', class: 'btn sm danger', onclick: remove }, icon('trash'), kind === 'clip' ? 'Clip entfernen' : 'Spur entfernen'))
  }

  async function exportCut() {
    try {
      await saving
      const button = root.querySelector('[data-export]')
      button.disabled = true; button.lastChild.textContent = 'Rendert …'
      const result = await fetch('/creativity-schnitt/api/export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: project.id }) })
      const body = await result.json()
      if (!result.ok) throw new Error(body.error)
      toast('Exportiert. Du findest den Schnitt in der Library und im Projekt.')
      library.unshift({ id: body.id, title: 'Schnitt', media_type: 'video/mp4' })
    } catch (error) { toast(error.message, true) } finally { draw() }
  }

  function draw() {
    const empty = !doc.clips.length
    const item = [...doc.clips, ...doc.audio].find(entry => entry.id === selected)
    const kind = item && doc.clips.includes(item) ? 'clip' : 'audio'
    let at = 0
    const clipBlocks = doc.clips.map(clip => { const left = at * PPS; at += clipLength(clip); return block(clip, left, clipLength(clip) * PPS, assetOf(clip.assetId)?.title ?? 'Datei fehlt', 'bild') })
    const track = (name, content, label) => el('div', { class: 'cut-track' }, el('span', { class: 'cut-track-name' }, label), el('div', { class: 'cut-lane', style: `width:${Math.max(total(), 10) * PPS + 80}px`, 'data-track': name }, content))
    const put = (...kids) => root.replaceChildren(...kids.filter(kid => kid !== null && kid !== undefined && kid !== false))
    put(
      el('div', { class: 'cut-bar' },
        el('select', { class: 'text-in', 'aria-label': 'Projekt', onchange: event => { location.hash = '#/schnitt?project=' + event.target.value } }, projects.map(p => el('option', { value: p.id, selected: p.id === project.id ? true : null }, p.title))),
        el('button', { type: 'button', class: 'btn sm', onclick: () => pickDialog('video') }, icon('plus'), 'Clip'),
        el('button', { type: 'button', class: 'btn sm', onclick: importFlow }, icon('film'), 'Aus dem Flow übernehmen'),
        el('button', { type: 'button', class: 'btn sm', onclick: () => pickDialog('audio') }, icon('plus'), 'Musik oder Ton'),
        status$,
        el('button', { type: 'button', class: 'btn' + (empty ? '' : ' primary'), 'data-export': true, disabled: empty || !status.ffmpeg || null, title: status.ffmpeg ? '' : 'Zum Exportieren braucht Atelier FFmpeg.', onclick: exportCut }, icon('down'), 'Exportieren')),
      el('p', { class: 'canvas-note meta' }, 'Die Bildspur spielt die Clips nacheinander ab. Teile, kürze und sortiere sie; Musik und Ton liegen darunter und starten zu der Zeit, die du einstellst.'),
      undo ? el('p', { class: 'canvas-note', role: 'status' }, undo.label, el('button', { type: 'button', class: 'btn sm', onclick: () => { const run = undo.restore; undo = null; run() } }, 'Rückgängig')) : null,
      !status.ffmpeg ? el('p', { class: 'canvas-note err', role: 'alert' }, 'FFmpeg fehlt. Die Vorschau funktioniert, der Export nicht.') : null,
      empty ? el('div', { class: 'state' }, icon('film'), el('h2', {}, 'Noch kein Schnitt'), el('p', {}, 'Hole die fertigen Videos aus dem Flow oder füge einen Clip aus Sammlung und Library hinzu.'),
        el('button', { class: 'btn primary', onclick: importFlow }, icon('film'), 'Aus dem Flow übernehmen')) :
        el('div', { class: 'cut-main' },
          el('div', { class: 'cut-stage' }, video, el('div', { class: 'cut-controls' },
            el('button', { type: 'button', class: 'icon', 'aria-label': playing ? 'Anhalten' : 'Abspielen', onclick: () => playing ? stop() : play() }, icon(playing ? 'pause' : 'play')),
            el('span', { class: 'meta cut-clock' }, `${fmt(playhead)} / ${fmt(total())}`))),
          item ? inspectorFor(item, kind) : el('aside', { class: 'cut-inspector' }, el('p', { class: 'meta' }, 'Wähle einen Clip oder eine Audiospur in der Zeitleiste, um sie zu bearbeiten.'))),
      empty ? null : el('div', { class: 'cut-timeline', onclick: event => {
        const lane = event.target.closest('.cut-lane'); if (!lane || event.target.closest('.cut-block')) return
        stop(); show((event.clientX - lane.getBoundingClientRect().left) / PPS)
      } },
      el('div', { class: 'cut-track' }, el('span', { class: 'cut-track-name' }), el('div', { class: 'cut-lane', style: `width:${Math.max(total(), 10) * PPS + 80}px` }, ruler())),
      track('bild', clipBlocks, 'Bild'),
      track('musik', doc.audio.map(entry => block(entry, entry.start * PPS, (entry.length || 10) * PPS, assetOf(entry.assetId)?.title ?? 'Audio', 'musik')), 'Musik und Ton'),
      el('div', { class: 'cut-playhead', style: `left:${playhead * PPS}px` })))
    if (!empty && !video.src) show(playhead)
  }
  container.replaceChildren(root)
  draw()
  const leave = new MutationObserver(() => { if (!container.isConnected) { leave.disconnect(); stop() } })
  leave.observe(document.body, { childList: true, subtree: true })
}
