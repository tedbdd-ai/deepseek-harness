import { seedancePromptTools } from './seedance-prompt-tools.mjs'
import { seedanceForm } from './seedance-form.mjs'
import { seedanceFrames, seedancePromptLimit } from './seedance-options.mjs'
import { studioMonitor } from './studio-monitor.mjs'

const apiBase = '/creativity-influencer/api'
const pricing = 'https://kie.ai/pricing'
const logs = 'https://kie.ai/logs'
const isKeyframe = item => ['image/png', 'image/jpeg'].includes(item.media_type) || (!item.media_type && item.preview)

const cameraMoves = [
  ['static', 'Statische Kamera', 'Die Kamera bleibt auf einem Stativ. Bildausschnitt und Perspektive bleiben während der Einstellung konstant.'],
  ['push', 'Langsam heranfahren', 'Die Kamera fährt gleichmäßig auf die Person zu, von einer halbnahen Einstellung bis zu einer Nahaufnahme.'],
  ['pull', 'Langsam zurückfahren', 'Die Kamera fährt langsam zurück. Der Bildausschnitt öffnet sich von der Person zur Umgebung.'],
  ['track', 'Seitliche Begleitfahrt', 'Die Kamera fährt parallel zur Person mit und hält gleichbleibenden Abstand. Der Hintergrund zieht seitlich vorbei.'],
  ['orbit', 'Bogenfahrt', 'Die Kamera fährt in einem sanften Viertelkreis um die Person und hält sie währenddessen in der Bildmitte.'],
  ['pan', 'Horizontaler Schwenk', 'Die Kamera bleibt am selben Ort und schwenkt kontrolliert von links nach rechts, bis die Person mittig im Bild steht.'],
  ['tilt', 'Schwenk von unten nach oben', 'Die Kamera neigt sich gleichmäßig nach oben. Die Einstellung beginnt an den Schuhen und endet auf dem Gesicht.'],
  ['handheld', 'Leichte Handkamera', 'Die Kamera bleibt nah an der Person und folgt ihr mit kleinen, natürlichen Schwankungen aus der Hand.'],
]

const scenePresets = [
  ['walk', 'Laufsteg', 'Die Person geht einige ruhige Schritte nach vorne, hält kurz inne und verlagert das Gewicht auf ein Bein. Das Outfit bewegt sich natürlich mit.'],
  ['outfit', 'Outfit-Reveal', 'Die Person dreht den Oberkörper langsam in eine Dreiviertelansicht und streicht den Stoff am Ärmel glatt. Schnitt und Details des Outfits werden sichtbar.'],
  ['portrait', 'Blick in die Linse', 'Die Person blickt erst leicht zur Seite und wendet sich dann der Linse zu. Der Blick bleibt ruhig, der Ausdruck entspannt sich zu einem leichten Lächeln.'],
  ['product', 'Produkt zeigen', 'Die Person hebt das Produkt aus dem Keyframe auf Brusthöhe und dreht es langsam mit der Vorderseite zur Kamera. Die Front bleibt am Ende einen Moment sichtbar.'],
  ['unboxing', 'Unboxing', 'Die Person klappt die Verpackung aus dem Keyframe auf, hebt das Produkt heraus und hält es einen Moment mit beiden Händen sichtbar.'],
  ['lifestyle', 'Lifestyle-Moment', 'Die Person geht ein paar Schritte durch die Umgebung, bleibt stehen und schaut sich kurz um. Haare und Kleidung bewegen sich leicht mit.'],
  ['detail', 'Materialdetail', 'Die Person hält den Stoff aus dem Keyframe kurz zwischen den Fingern und bewegt ihn leicht ins Licht. Webstruktur und Falten bleiben sichtbar.'],
]

async function videoApi(path, payload, file) {
  const response = await fetch(apiBase + path, {
    method: payload || file ? 'POST' : 'GET',
    headers: file ? { 'Content-Type': file.type } : payload ? { 'Content-Type': 'application/json' } : {},
    body: file ?? (payload ? JSON.stringify(payload) : undefined),
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Der Videoauftrag konnte nicht verarbeitet werden.')
  return data
}

export async function render(container, { el, api, icon, media, withFullscreen, refreshCounts, projects, params }) {
  const [clips, library, providers, existing] = await Promise.all([
    api('/assets?library=clips'), api('/assets?library=generation'), api('/providers'), videoApi('/jobs'),
  ])
  if (!container.isConnected) return
  const storyProject = params.get('project')
  const shotId = params.get('shot')
  const record = shotId && await api('/projects/'+encodeURIComponent(storyProject)+'/apps/storyboard')
  const shot = record && record.data.shots?.find(item=>item.id===shotId)
  if (shotId && !shot) throw new Error('Diese Einstellung ist nicht mehr im Storyboard.')
  const assets = [...clips, ...library]
  const hotapi = providers.find(provider => provider.id === 'hotapi' && provider.capabilities.includes('startVideo'))
  const videoProvider = hotapi ?? providers.find(provider => provider.id === 'kie' && provider.capabilities.includes('startVideo'))
  const providerName = videoProvider?.title ?? 'Kie.ai'
  const configured = videoProvider?.secrets.every(secret => secret.configured)
  let image, motion, motionSeconds, busy, timer, refreshing = false
  let jobs = existing.toSorted((a, b) => b.createdAt.localeCompare(a.createdAt))
  const field = (name, input) => el('label', { class: 'field' }, el('span', {}, name), input)
  const select = entries => el('select', { class: 'text-in' }, entries.map(([value, name]) => el('option', { value }, name)))
  const seedanceModel = hotapi ? 'seedance-hotapi' : 'seedance'
  const model = select(hotapi ? [[seedanceModel, 'Seedance 2.5 Spicy · HotAPI']] : [[seedanceModel, 'Seedance 2.5 Flash'], ['kling', 'Kling 2.6']])
  const mode = select([['keyframe', 'Keyframe animieren'], ['motion', 'Bewegung übertragen']])
  const duration = select([['5', '5 Sekunden'], ['10', '10 Sekunden']])
  const sound = el('input', { type: 'checkbox' })
  const resolution = select([['720p', '720p'], ['1080p', '1080p']])
  const orientation = select([['video', 'Bewegungsclip'], ['image', 'Keyframe']])
  const prompt = el('textarea', { class: 'text-in influencer-prompt', rows: 4, maxlength: 2500 })
  if (shot) prompt.value = shot.prompt
  const cameraPreset = select([['', 'Kamerabewegung wählen'], ...cameraMoves])
  const scenePreset = select([['', 'Szene wählen'], ...scenePresets])
  cameraPreset.setAttribute('aria-label', 'Kamerabewegung')
  scenePreset.setAttribute('aria-label', 'Szenenvorlage')
  const insertPresets = el('button', { type: 'button', class: 'btn sm', disabled: true, onclick: () => {
    const scene = scenePresets.find(([id]) => id === scenePreset.value)
    const camera = cameraMoves.find(([id]) => id === cameraPreset.value)
    const addition = [scene?.[2], camera?.[2]].filter(Boolean).join(' ')
    const combined = [prompt.value.trimEnd(), addition].filter(Boolean).join('\n\n')
    if (combined.length > prompt.maxLength) return status('Der Szenenprompt darf höchstens ' + prompt.maxLength.toLocaleString('de') + ' Zeichen haben.')
    prompt.value = combined
    cameraPreset.value = scenePreset.value = ''
    insertPresets.disabled = true
    update()
    prompt.focus()
    prompt.setSelectionRange(combined.length, combined.length)
  } }, 'In Prompt einfügen')
  cameraPreset.onchange = scenePreset.onchange = () => { insertPresets.disabled = !cameraPreset.value && !scenePreset.value }
  const presets = el('div', { class: 'pg-bar' },
    field('Kamerabewegung', cameraPreset), field('Szenenvorlage', scenePreset), insertPresets)
  const project = select([['', 'Nur Library'], ...projects.map(item => [item.id, item.title])])
  if (projects.some(item => item.id === params.get('project'))) project.value = params.get('project')
  if (shot) project.disabled = true
  const imageSlot = el('div', { class: 'pg-bar' })
  const motionSlot = el('div', { class: 'pg-bar' })
  const message = el('p', { class: 'meta', role: 'status', hidden: true })
  const motionHelp = el('span', { class: 'meta' })
  const start = el('button', { type: 'submit', class: 'btn primary' }, 'Kostenpflichtig starten')
  const history = el('div', { class: 'studio-renders' })
  const queueSummary = el('span', { class: 'meta' })
  const jumpToRenders = el('button', { type: 'button', class: 'btn sm', onclick: () => {
    renders.scrollIntoView({ block: 'start' })
    renders.focus({ preventScroll: true })
  } }, icon('film'), 'Render-Verlauf')
  const markHint = el('p', { class: 'meta studio-note', role: 'status', hidden: true })
  const { monitor, timeline, show } = studioMonitor({ el, icon, media, request: videoApi, status })
  const byDate = new Intl.DateTimeFormat('de', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })
  const labels = { submitting: 'Wird eingereicht', queued: 'Beim Anbieter in Arbeit', done: 'In der Library', failed: 'Fehlgeschlagen', unknown: 'Einreichung prüfen' }
  let selectedJobId = jobs.find(job => ['queued', 'submitting'].includes(job.status))?.id ??
    jobs.find(job => job.status === 'done' && assets.some(item => item.id === job.assetId))?.id ?? jobs[0]?.id
  const pollError = el('p', { class: 'meta', role: 'status', hidden: true })

  function status(text = '') {
    message.textContent = text
    message.hidden = !text
  }

  function update() {
    const usingSeedance = model.value === seedanceModel
    const transferring = mode.value === 'motion' && !usingSeedance
    klingFields.hidden = usingSeedance
    seedance.tabs.hidden = seedance.inputs.hidden = seedance.settings.hidden = !usingSeedance
    prompt.maxLength = usingSeedance ? seedancePromptLimit : 2500
    promptTools.refresh(usingSeedance)
    const max = orientation.value === 'image' ? 10 : 30
    motionControls.hidden = !transferring
    keyframeControls.hidden = transferring
    presets.parentElement.hidden = transferring
    prompt.required = usingSeedance ? seedance.needsPrompt : !transferring
    prompt.placeholder = transferring ? 'Optional, etwa eine Änderung am Hintergrund' : 'Beschreibe Bewegung, Kamerafahrt oder gesprochenen Text.'
    motionHelp.textContent = !motion ? `MP4 · 3 bis ${max} Sekunden` : Number.isFinite(motionSeconds)
      ? `${motionSeconds.toFixed(1)} s · erlaubt sind 3 bis ${max} s` : motionSeconds === Infinity
        ? 'Die Länge des Clips konnte nicht gelesen werden.' : 'Liest die Cliplänge …'
    const hasInput = usingSeedance ? seedance.hasInput : image && (!transferring ||
      (motion && Number.isFinite(motionSeconds) && motionSeconds >= 3 && motionSeconds <= max))
    const context = usingSeedance ? seedance.promptContext() : null
    const marks = new Set(context?.references.map(item => item.mark.toLowerCase()))
    if (context?.startFrame) marks.add('@image1')
    if (context?.endFrame) marks.add('@image2')
    const missingMark = usingSeedance && (prompt.value.match(/@(image|video|audio)[0-9]+\b/gi) ?? []).find(mark => !marks.has(mark.toLowerCase()))
    markHint.hidden = !missingMark
    markHint.textContent = missingMark ? missingMark + ' ist in diesem Modus nicht ausgewählt.' : ''
    start.disabled = Boolean(busy || !configured || !hasInput || missingMark || (prompt.required && !prompt.value.trim()) || prompt.value.length > prompt.maxLength)
  }

  const matchesTypes = (item, types) => types.includes(item.media_type) ||
    (!item.media_type && item.preview && types.some(type => type.startsWith('image/')))

  function choose(types, title, onSelect, excluded = []) {
    const items = assets.filter(item => matchesTypes(item, types) && !excluded.includes(item.id))
    const dialog = el('dialog', { class: 'pg-editor styler-picker', 'aria-label': title })
    const sources = [['generation', 'Library'], ['clips', 'Sammlung']]
    let source = items.some(item => item.library === 'generation') ? 'generation' : 'clips'
    const search = el('input', { class: 'text-in', type: 'search', placeholder: 'Nach Titel suchen',
      'aria-label': 'Nach Titel suchen', oninput: draw,
      onkeydown: event => { if (event.key === 'Enter') event.preventDefault() } })
    const tabs = el('div', { class: 'seg', role: 'group', 'aria-label': 'Quelle' },
      sources.map(([value, label]) => el('button', { type: 'button', onclick: () => {
        source = value
        draw()
      } }, label)))
    const results = el('div')
    function draw() {
      for (const [index, [value]] of sources.entries()) {
        tabs.children[index].setAttribute('aria-pressed', String(source === value))
      }
      const query = search.value.trim().toLocaleLowerCase('de')
      const matches = items.filter(item => item.library === source && item.title.toLocaleLowerCase('de').includes(query))
      const empty = query ? 'Keine Treffer für diese Suche.'
        : `Keine passenden Dateien in ${source === 'generation' ? 'der Library' : 'der Sammlung'}.`
      results.replaceChildren(matches.length ? el('div', { class: 'pick-grid' }, matches.map(item =>
        withFullscreen(item, el('button', { type: 'button', class: 'styler-choice', 'aria-label': item.title, onclick: () => {
          dialog.close()
          onSelect(item)
        } }, el('span', { class: 'pick' }, media(item)), el('span', {}, item.title)))))
        : el('p', { class: 'meta', role: 'status' }, empty))
    }
    draw()
    dialog.append(el('form', { method: 'dialog' }, el('h2', {}, title), el('div', { class: 'pg-bar' }, tabs, search),
      results, el('button', { class: 'btn' }, 'Schließen')))
    dialog.onclose = () => dialog.remove()
    document.body.append(dialog)
    dialog.showModal()
  }

  function upload(types, onSelect, label, { dropTarget, compact, capacity } = {}) {
    const input = el('input', { type: 'file', accept: types.join(','), multiple: Boolean(capacity), hidden: true })
    async function save(files) {
      if (!files.length || busy) return
      const available = capacity ? capacity() : 1
      const valid = files.filter(file => types.includes(file.type)).slice(0, available)
      if (!available) return
      if (!valid.length) return status('Wähle eine Datei in einem der angebotenen Formate.')
      busy = true
      update()
      status('Speichert die Datei in der Sammlung …')
      try {
        for (const file of valid) {
          const item = await videoApi('/media?title=' + encodeURIComponent(file.name.replace(/\.[^.]+$/, '')), undefined, file)
          assets.unshift(item)
          if (container.isConnected) onSelect(item)
        }
        status()
      } catch (error) { status(error.message) }
      finally {
        busy = false
        update()
        refreshCounts().catch(error => status(error.message))
      }
    }
    input.onchange = () => {
      const files = Array.from(input.files ?? [])
      input.value = ''
      void save(files)
    }
    if (dropTarget) {
      dropTarget.addEventListener('dragover', event => {
        if (!Array.from(event.dataTransfer.types).includes('Files')) return
        event.preventDefault()
        dropTarget.classList.add('is-drop-target')
      })
      dropTarget.addEventListener('dragleave', event => {
        if (!dropTarget.contains(event.relatedTarget)) dropTarget.classList.remove('is-drop-target')
      })
      dropTarget.addEventListener('drop', event => {
        const files = Array.from(event.dataTransfer.files)
        if (!files.length) return
        event.preventDefault()
        dropTarget.classList.remove('is-drop-target')
        void save(files)
      })
    }
    return el('span', { class: 'studio-upload' }, input,
      el('button', { type: 'button', class: 'btn sm', 'aria-label': label, onclick: () => input.click() },
        compact ? 'Upload' : label))
  }

  function setAsset(kind, item) {
    const forImage = kind === 'image'
    const slot = forImage ? imageSlot : motionSlot
    const types = forImage ? ['image/png', 'image/jpeg'] : ['video/mp4']
    const label = forImage ? 'Keyframe' : 'Bewegungsclip'
    const set = entry => setAsset(kind, entry)
    if (forImage) image = item
    else { motion = item; motionSeconds = undefined }
    const thumbnail = item && media(item, { full: true })
    if (thumbnail && !forImage) {
      thumbnail.addEventListener('loadedmetadata', () => {
        if (motion?.id !== item.id) return
        motionSeconds = thumbnail.duration
        update()
      })
      thumbnail.addEventListener('error', () => {
        if (motion?.id !== item.id) return
        motionSeconds = Infinity
        update()
      })
    }
    slot.replaceChildren(...[thumbnail && withFullscreen(item, el('span', { class: 'styler-thumb' }, thumbnail)),
      item && el('span', { class: 'meta influencer-asset' }, item.title),
      el('button', { type: 'button', class: 'btn sm', onclick: () => choose(types, label + ' wählen', set) }, label + ' wählen'),
      upload(types, set, forImage ? 'Keyframe hochladen' : 'MP4 hochladen'),
    ].filter(Boolean))
    update()
  }

  function resultAsset(job) {
    return assets.find(item => item.id === job.assetId)
  }

  function jobModel(job) {
    if (job.provider === 'hotapi') return 'Seedance 2.5 Spicy · HotAPI'
    return job.model?.startsWith('bytedance/') ? 'Seedance 2.5 Flash' : job.model?.startsWith('kling') ? 'Kling 2.6' : ''
  }

  function showJob(job) {
    const item = resultAsset(job)
    const extension = job.format ?? 'mp4'
    const nextShot = new URLSearchParams({ ref: job.frameId ?? '' })
    if (job.projectId) nextShot.set('project', job.projectId)
    const buttons = [
      job.frameId && assets.some(asset => asset.id === job.frameId) && el('a', {
        class: 'btn sm', href: '#/video-playground?' + nextShot,
        title: 'Eine separate Einstellung mit dem Schlussbild dieses Clips als Startframe beginnen',
      }, 'Ab Schlussbild weiter'),
      item && el('button', { type: 'button', class: 'btn sm', onclick: () => {
        model.value = seedanceModel
        seedance.setExtension(item)
        status('Ausgangsclip @Video1 gesetzt.')
        prompt.focus()
      } }, 'Verlängern'),
      item && el('a', { class: 'icon studio-icon', 'aria-label': 'Video herunterladen', title: 'Video herunterladen',
        href: '/creativity-hub/api/media/' + job.assetId, download: 'Video.' + extension }, icon('down')),
      job.frameId && el('a', { class: 'btn sm', href: '/creativity-hub/api/media/' + job.frameId, download: 'Letzter-Frame.jpg' }, 'Letzter Frame'),
      (job.taskId || job.status === 'unknown') && el('a', { class: 'meta', href: job.provider === 'hotapi' ? 'https://hotapi.ai/en/docs/guides/async-tasks' : logs, target: '_blank', rel: 'noopener noreferrer' }, job.provider === 'hotapi' ? 'HotAPI-Auftrag' + (job.taskId ? ' · ' + job.taskId : '') : 'Kie.ai-Logs'),
    ].filter(Boolean)
    const heading = job.title || 'Render'
    const note = job.error || job.extensionError || (job.status === 'done' && !item ? 'Dieser Render ist nicht mehr in der Library.' : labels[job.status])
    show({ key: job.id + ':' + job.status, title: heading,
      description: [jobModel(job), labels[job.status], job.credits == null ? '' : job.credits + ' Credits'].filter(Boolean).join(' · '),
      item, buttons, note, prompt: job.submittedPrompt ?? job.prompt,
      ...(item && { warning: job.extensionError || job.frameError }) })
  }

  function preview(item, mark) {
    selectedJobId = undefined
    show({ key: 'asset:' + item.id + ':' + (mark ?? ''), title: item.title,
      description: mark ? 'Referenz ' + mark : 'Keyframe', item })
    drawJobs()
  }

  function drawJobs() {
    const queued = jobs.filter(job => ['submitting', 'queued'].includes(job.status)).length
    jumpToRenders.replaceChildren(icon('film'), queued ? 'Render-Verlauf · ' + queued + ' in Arbeit' : 'Render-Verlauf')
    queueSummary.textContent = queued ? queued + ' in Arbeit' : jobs.length ? jobs.length + ' im Verlauf' : ''
    history.replaceChildren(...jobs.map(job => el('button', { type: 'button', class: 'studio-render', 'aria-pressed': String(selectedJobId === job.id),
      title: job.title, onclick: event => {
        selectedJobId = job.id
        for (const card of history.children) card.setAttribute('aria-pressed', String(card === event.currentTarget))
        showJob(job)
      } },
    el('span', { class: 'studio-render-top' }, icon('film'), el('time', { class: 'meta', datetime: job.createdAt }, byDate.format(new Date(job.createdAt)))),
    el('b', { class: 'studio-caption' }, job.title),
    el('span', { class: 'meta studio-render-status', 'data-status': job.status }, labels[job.status]))))
    if (!jobs.length) history.append(el('p', { class: 'meta studio-note' }, 'Neue Render erscheinen hier.'))
    const selected = jobs.find(job => job.id === selectedJobId)
    if (selected) showJob(selected)
  }

  async function poll() {
    clearTimeout(timer)
    if (!container.isConnected || refreshing) return
    const queued = jobs.filter(job => job.status === 'queued')
    if (!queued.length) return
    refreshing = true
    let retry = false
    pollError.hidden = true
    try {
      for (const job of queued) {
        if (!container.isConnected) break
        try {
          const next = await videoApi('/jobs/' + job.id + '/refresh', {})
          jobs = jobs.map(item => item.id === next.id ? next : item)
          if (next.status === 'done') {
            if (next.frameId && !assets.some(asset => asset.id === next.frameId)) assets.unshift({
              id: next.frameId, library: 'generation', title: 'Schlussbild · ' + next.title, media_type: 'image/jpeg',
            })
            if (next.assetId && !resultAsset(next)) assets.unshift({ id: next.assetId, library: 'generation',
              title: next.title, media_type: next.format === 'mov' ? 'video/quicktime' : 'video/mp4' })
            refreshCounts().catch(error => status(error.message))
          }
          if (next.status !== 'queued' && container.isConnected) drawJobs()
        } catch (error) {
          retry = true
          pollError.textContent = error.message
          pollError.hidden = false
        }
      }
    } finally {
      refreshing = false
      if (container.isConnected && jobs.some(job => job.status === 'queued')) timer = setTimeout(poll, retry ? 12000 : 5000)
    }
  }

  async function submit(event) {
    event.preventDefault()
    if (start.disabled) return
    busy = true
    update()
    status('Reicht den Auftrag bei ' + providerName + ' ein …')
    try {
      const options = model.value === seedanceModel ? seedance.payload() : {
        mode: mode.value, imageId: image.id, motionId: motion?.id, duration: duration.value, sound: sound.checked,
        resolution: resolution.value, orientation: orientation.value,
      }
      const job = await videoApi('/jobs', { ...options,
        requestId: crypto.randomUUID(), prompt: prompt.value, projectId: project.value, shotId: shot?.id,
      })
      jobs = [job, ...jobs.filter(item => item.id !== job.id)]
      selectedJobId = job.id
      status(job.status === 'queued' ? 'Auftrag eingereicht.' : '')
      drawJobs()
      history.scrollLeft = 0
      void poll()
    } catch (error) { status(error.message) }
    finally { busy = false; update() }
  }

  const motionControls = el('div', { class: 'pg-fields' }, motionSlot, motionHelp,
    el('div', { class: 'pg-bar' }, field('Auflösung', resolution), field('Ausrichtung nach', orientation)))
  const keyframeControls = el('div', { class: 'pg-bar' }, field('Dauer', duration), el('label', { class: 'meta' }, sound, ' Mit Ton'))
  const initial = assets.find(item => item.id === (shot?.ref || params.get('ref')))
  const seedance = seedanceForm({ el, icon, select, field, choose, upload, media, withFullscreen, preview, update,
    hotapi: Boolean(hotapi), initialDuration: shot?.duration, initial: initial && matchesTypes(initial, seedanceFrames) ? initial : undefined,
    removeMark: (prefix, removedNumber) => {
      const pattern = new RegExp(prefix + '([1-9]\\d*)\\b', 'gi')
      prompt.value = prompt.value.replace(pattern, (match, number) => {
        const index = Number(number)
        if (index === removedNumber) return ''
        return index > removedNumber ? prefix + (index - 1) : match
      })
    },
    insertMark: mark => {
      if (prompt.value.length - (prompt.selectionEnd - prompt.selectionStart) + mark.length + 2 > prompt.maxLength) return
      const start = prompt.selectionStart
      const end = prompt.selectionEnd
      const before = start > 0 && !/\s/.test(prompt.value[start - 1]) ? ' ' : ''
      prompt.focus()
      prompt.setRangeText(before + mark + ' ', start, end, 'end')
      update()
    },
  })
  const promptTools = seedancePromptTools({ el, field, prompt, seedance, request: videoApi, update,
    canImprove: providers.some(provider => provider.capabilities.includes('chat') && provider.secrets.every(secret => secret.configured)),
  })
  const klingFields = el('div', { class: 'pg-fields' }, field('Modus', mode), imageSlot, motionControls, keyframeControls)
  model.onchange = mode.onchange = orientation.onchange = prompt.oninput = update
  const form = el('form', { class: 'studio-panel studio-composer', onsubmit: submit },
    el('header', { class: 'studio-panel-head' }, el('h2', {}, 'Regie')),
    el('div', { class: 'studio-composer-body pg-fields' }, klingFields, seedance.inputs,
      field('Szenenprompt', prompt), markHint, promptTools.node,
      el('details', { class: 'styler-more' }, el('summary', {}, 'Kamera und Szenenvorlagen'), presets),
      seedance.settings, field('Speichern in', project)),
    el('div', { class: 'studio-composer-footer' }, start,
      !configured && el('a', { class: 'meta', href: '#/anbieter' }, providerName + '-Schlüssel einrichten'),
      el('a', { class: 'meta', href: hotapi ? 'https://hotapi.ai/en/pricing' : pricing, target: '_blank', rel: 'noopener noreferrer' }, providerName + '-Preise'), message))
  const toolbar = el('div', { class: 'studio-toolbar' }, el('a',{class:'btn sm',href:'#/storyboard'+(storyProject?'?project='+encodeURIComponent(storyProject):'')},shot?'Zur Einstellung · '+(shot.title||'Storyboard'):'Storyboard'), seedance.tabs, el('div', { class: 'studio-toolbar-tools' }, jumpToRenders, field('Videomodell', model)))
  const renders = el('section', { class: 'studio-panel studio-queue', 'aria-label': 'Render-Verlauf', tabindex: '-1' },
    el('header', { class: 'studio-panel-head' }, el('div', { class: 'studio-heading' }, el('h2', {}, 'Render-Verlauf'), queueSummary),
      el('button', { type: 'button', class: 'btn sm', onclick: poll }, 'Status aktualisieren')), pollError, history)
  container.classList.add('studio-scroll')
  container.replaceChildren(el('div', { class: 'video-studio' }, toolbar,
    el('div', { class: 'studio-grid' }, form, monitor), timeline, renders))
  setAsset('image', initial && isKeyframe(initial) ? initial : undefined)
  setAsset('motion')
  if (initial && matchesTypes(initial, seedanceFrames)) preview(initial)
  else if (jobs.length) drawJobs()
  else { show({ key: 'empty' }); drawJobs() }
  void poll()
}
