const assetUrl = id => '/creativity-hub/api/media/' + encodeURIComponent(id)

export function displayTime(seconds) {
  const whole = Math.max(0, Math.floor(seconds || 0))
  return String(Math.floor(whole / 60)).padStart(2, '0') + ':' + String(whole % 60).padStart(2, '0')
}

function wave(canvas, peaks) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const { width, height } = canvas
  const step = width / peaks.length
  ctx.fillStyle = getComputedStyle(canvas).color
  peaks.forEach((value, index) => {
    const bar = Math.max(1, value * (height - 8))
    ctx.fillRect(index * step, (height - bar) / 2, Math.max(1, step - 2), bar)
  })
}

export function studioMonitor({ el, icon, media, request, status }) {
  const label = el('h2', {}, 'Vorschau')
  const detail = el('span', { class: 'meta studio-detail' })
  const warning = el('p', { class: 'meta studio-note', role: 'status', hidden: true })
  const promptText = el('p', { class: 'meta' })
  const promptDetails = el('details', { class: 'styler-more studio-render-prompt', hidden: true },
    el('summary', {}, 'Render-Prompt'), promptText)
  const actions = el('div', { class: 'pg-bar studio-monitor-actions' })
  const stage = el('div', { class: 'studio-stage' })
  const elapsed = el('output', { class: 'studio-time' }, '00:00 / 00:00')
  const scrub = el('input', { class: 'studio-scrub', type: 'range', min: '0', max: '1', value: '0', step: '0.01', 'aria-label': 'Abspielposition', disabled: true })
  const play = button('Abspielen', 'play', togglePlayback)
  const mute = button('Stumm schalten', 'volume', () => { player.muted = !player.muted; sync() })
  const fullscreen = button('Vollbild', 'expand', async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else if (document.fullscreenEnabled) await monitor.requestFullscreen()
      else player?.webkitEnterFullscreen?.()
    } catch { status('Vollbild konnte nicht geöffnet werden.') }
  })
  const transport = el('div', { class: 'studio-transport' }, play, elapsed, scrub, mute, fullscreen)
  const monitor = el('section', { class: 'studio-panel studio-monitor', 'aria-label': 'Vorschaumonitor' },
    el('header', { class: 'studio-panel-head' }, el('div', { class: 'studio-heading' }, label, detail), actions), stage, transport, warning, promptDetails)
  const marks = el('div', { class: 'studio-ruler', 'aria-hidden': 'true' })
  const track = el('div', { class: 'studio-track' })
  const trackLabel = el('span', { class: 'meta' }, 'Video')
  const audioTrack = el('div', { class: 'studio-track studio-wave' })
  const audioRow = el('div', { class: 'studio-track-row', hidden: true }, el('span', { class: 'meta' }, 'Ton'), audioTrack)
  const videoRow = el('div', { class: 'studio-track-row' }, trackLabel, track)
  const timelineNote = el('span', { class: 'meta' })
  const timeline = el('section', { class: 'studio-panel studio-timeline', 'aria-label': 'Timeline' },
    el('header', { class: 'studio-panel-head' }, el('h2', {}, 'Timeline'), timelineNote),
    marks, videoRow, audioRow)
  let player, selected, generation = 0
  const overviews = new Map()

  function button(name, symbol, onclick) {
    return el('button', { type: 'button', class: 'icon studio-icon', 'aria-label': name, title: name, onclick }, icon(symbol))
  }
  function setButton(control, name, symbol) {
    if (control.title === name) return
    control.title = name
    control.setAttribute('aria-label', name)
    control.replaceChildren(icon(symbol))
  }
  function sync() {
    const duration = Number.isFinite(player?.duration) ? player.duration : 0
    const playerTime = player?.currentTime || 0
    play.disabled = mute.disabled = !player
    scrub.disabled = !duration
    scrub.max = duration || 1
    scrub.value = playerTime
    elapsed.textContent = displayTime(playerTime) + ' / ' + displayTime(duration)
    timeline.style.setProperty('--position', (duration ? Math.min(100, 100 * playerTime / duration) : 0) + '%')
    setButton(play, !player || player.paused ? 'Abspielen' : 'Pause', !player || player.paused ? 'play' : 'pause')
    setButton(mute, player?.muted ? 'Ton einschalten' : 'Stumm schalten', player?.muted ? 'muted' : 'volume')
  }
  function togglePlayback() {
    if (!player) return
    if (player.paused) void player.play().catch(() => status('Die Datei konnte nicht abgespielt werden.'))
    else player.pause()
  }
  function seek(seconds) {
    if (!player || !Number.isFinite(player.duration)) return
    player.currentTime = Math.min(player.duration, Math.max(0, seconds))
    sync()
  }
  scrub.oninput = () => seek(Number(scrub.value))

  function updateRuler(duration) {
    marks.replaceChildren(...Array.from({ length: 5 }, (_, i) =>
      el('span', {}, duration > 0 ? displayTime(duration * i / 4) : '')))
  }
  function audioWave(peaks, duration) {
    const canvas = el('canvas', { width: '768', height: '42', 'aria-hidden': 'true' })
    const ruler = el('button', { type: 'button', class: 'studio-waveform', 'aria-label': 'Abspielposition auf der Tonspur setzen',
      onclick: event => {
        const rect = event.currentTarget.getBoundingClientRect()
        seek(event.detail ? duration * (event.clientX - rect.x) / rect.width : 0)
      } }, canvas)
    audioTrack.replaceChildren(ruler)
    audioRow.hidden = false
    wave(canvas, peaks)
  }
  function renderOverview(overview, audioOnly) {
    const { duration, frameCount, image, peaks } = overview
    updateRuler(duration)
    if (image && frameCount) {
      track.style.setProperty('--frame-count', frameCount)
      track.style.setProperty('--filmstrip', 'url("data:image/jpeg;base64,' + image + '")')
      track.replaceChildren(...Array.from({ length: frameCount }, (_, index) => {
        const second = duration * index / frameCount
        const cell = el('button', { type: 'button', class: 'studio-film-frame', 'aria-label': 'Zum Einzelbild bei ' + second.toLocaleString('de', { maximumFractionDigits: 2 }) + ' Sekunden',
          onclick: () => seek(second) })
        cell.style.backgroundPositionX = (index * 100 / (frameCount - 1)) + '%'
        return cell
      }))
    } else {
      videoRow.hidden = audioOnly
      track.textContent = 'Keine Einzelbilder verfügbar'
    }
    if (peaks.length) audioWave(peaks, duration)
    timelineNote.textContent = peaks.length && !audioOnly ? 'Video und gemischte Tonspur' : audioOnly ? 'Audioreferenz' : 'Video ohne Tonspur'
  }
  function show({ key, title = 'Vorschau', description = '', note = 'Wähle eine Referenz oder einen Render für die Vorschau.', warning: alert, prompt, item, buttons = [] } = {}) {
    if (selected === key) return
    selected = key
    const view = ++generation
    player?.pause()
    player = undefined
    label.textContent = title
    label.title = title
    detail.textContent = description
    warning.textContent = alert ?? ''
    warning.hidden = !alert
    promptDetails.open = false
    promptDetails.hidden = !prompt
    promptText.textContent = prompt ?? ''
    actions.replaceChildren(...buttons)
    timelineNote.textContent = ''
    videoRow.hidden = false
    audioRow.hidden = true
    updateRuler(0)
    track.classList.remove('is-ready')
    track.style.removeProperty('--filmstrip')
    track.textContent = 'Sobald ein Video vorliegt, erscheinen hier die Einzelbilder.'
    const audioOnly = item?.media_type?.startsWith('audio/')
    const moving = audioOnly || item?.media_type?.startsWith('video/')
    let content
    if (moving) {
      const element = el(audioOnly ? 'audio' : 'video', { src: assetUrl(item.id), preload: 'metadata', playsinline: true, 'aria-label': title })
      player = element
      for (const event of ['play', 'pause', 'ended', 'timeupdate', 'volumechange', 'seeking']) element.addEventListener(event, () => {
        if (element === player) sync()
      })
      element.addEventListener('loadedmetadata', () => {
        if (element !== player) return
        sync()
        if (Number.isFinite(element.duration)) updateRuler(element.duration)
      })
      element.addEventListener('error', () => {
        if (element !== player) return
        player = undefined
        stage.replaceChildren(el('p', { class: 'meta' }, 'Diese Datei ist nicht verfügbar oder wird vom Browser nicht unterstützt.'))
        sync()
      })
      content = audioOnly ? el('div', { class: 'studio-placeholder' }, icon('wave'), el('b', {}, 'Audioreferenz'),
        el('span', { class: 'meta' }, item.title), element) : element
      track.textContent = 'Liest Timeline …'
      timelineNote.textContent = 'Liest Timeline …'
      const known = overviews.get(item.id)
      const task = known ?? request('/media/' + encodeURIComponent(item.id) + '/timeline')
      if (!known) {
        overviews.set(item.id, task)
        if (overviews.size > 20) overviews.delete(overviews.keys().next().value)
      }
      task.then(data => {
        if (view !== generation || !monitor.isConnected) return
        renderOverview(data, audioOnly)
        track.classList.toggle('is-ready', Boolean(data.image))
      }).catch(() => {
        if (overviews.get(item.id) === task) overviews.delete(item.id)
        if (view !== generation || !monitor.isConnected) return
        timelineNote.textContent = 'Timeline-Daten nicht verfügbar'
        track.textContent = 'Die Abspielposition lässt sich am Player einstellen.'
      })
    } else if (item) {
      content = media(item)
    } else {
      content = el('div', { class: 'studio-placeholder' }, icon('film'), el('span', {}, note))
    }
    stage.replaceChildren(content)
    fullscreen.disabled = !item || audioOnly
    sync()
  }
  return { monitor, timeline, show }
}
