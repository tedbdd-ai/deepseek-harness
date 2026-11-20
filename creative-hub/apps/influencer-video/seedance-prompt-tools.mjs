import { referenceKinds, seedancePromptLimit } from './seedance-options.mjs'

const guide = 'https://seegen.ai/seedance-2-5-prompt-guide'
const referenceRoles = {
  image: [
    ['Person', 'Vorlage für [Person]. Gesicht und Proportionen bleiben über den Clip konsistent.'],
    ['Outfit oder Produkt', 'Vorlage für [Outfit oder Produkt]. Farbe, Form und Material bleiben konsistent.'],
    ['Umgebung und Licht', 'Vorlage für Schauplatz, Hintergrund und Lichtstimmung.'],
    ['Storyboard', 'Vorlage für Einstellungsfolge, Bildausschnitte und Schnittrhythmus.'],
  ],
  video: [
    ['Bewegung und Timing', 'Vorlage für Bewegungsablauf und Timing von [Person oder Objekt].'],
    ['Kamera', 'Vorlage für Kamerabewegung, Perspektive und Bildausschnitt.'],
  ],
  audio: [
    ['Rhythmus', 'Vorlage für den Rhythmus. Stimme Bewegung und Schnitte auf markante Schläge ab.'],
    ['Stimme', 'Vorlage für Stimme und Sprechtempo. [Figur] sagt auf [Sprache]: „[Dialog]“.'],
  ],
}

function blocks({ mode, task, duration, audio, endFrame, references, extensionDirection }) {
  const timeline = duration > 0
    ? `0–${Math.floor(duration / 2)} s: [Auftakt].\n${Math.floor(duration / 2)}–${duration} s: [Bewegung und Endposition].`
    : 'Zu Beginn: [Auftakt]. Anschließend: [Bewegung]. Zum Ende: [Endposition].'
  const groups = [['Regie', [
    ['Motiv und Schauplatz', '[Person oder Produkt] befindet sich in [Umgebung]. Im Bild ist [konkreter Hintergrund] zu sehen.'],
    ['Zeitablauf', timeline],
    ['Kamera und Bildausschnitt', 'Die Einstellung beginnt [Bildausschnitt und Perspektive]. Die Kamera [Bewegung] und endet auf [Motiv].'],
    ['Stil und Licht', '[Visuelle Gestaltung]. Das Licht kommt aus [Richtung oder Quelle] und erzeugt [Schatten oder Kontrast].'],
    ['Kontinuität', '[Gesicht, Outfit oder Produktdetails] bleiben in allen Einstellungen konsistent.'],
    ...(audio ? [
      ['Dialog', '[Figur] sagt auf [Sprache] in [Tonfall]: „[Dialog]“.'],
      ['Atmosphäre und Ton', 'Hörbar sind [Umgebungsgeräusche]. Bei [Aktion] setzt [Geräusch oder Musik] ein.'],
    ] : []),
  ]]]
  if (mode === 'frames') {
    groups.push(['Keyframes', [['Übergang', endFrame
      ? 'Beginne exakt im Startframe. [Bewegung und Kamerafahrt] führen fließend zur Komposition des Endframes.'
      : 'Beginne exakt im Startframe. [Person oder Objekt] bewegt sich [konkrete Bewegung] und endet in [Position].']]])
  }
  for (const { kind, title, mark } of references) {
    const roles = referenceRoles[kind].map(([label, text]) => [label, mark + ' als ' + text])
    if (kind === 'video' && ['edit', 'auto'].includes(task)) {
      roles.unshift(['Gezielte Änderung', `Bearbeite ${mark}: [konkrete Änderung]. Bildaufbau, Licht und übrige Bewegungen bleiben erhalten.`])
    }
    if (mark === '@Video1' && task === 'extend') {
      roles.unshift(['Anschluss an den Clip', `Verlängere ${mark} ${extensionDirection === 'before' ? 'direkt vor dem ersten Bild' : 'direkt ab dem letzten Bild'}. [Handlung am Übergang]. Blickrichtung, Tempo und Licht bleiben konsistent.`])
    }
    groups.push([`${mark} · ${title}`, roles])
  }
  return groups
}

export function seedancePromptTools({ el, field, prompt, seedance, request, update, canImprove }) {
  const snippet = el('select', { class: 'text-in' })
  const add = el('button', { type: 'button', class: 'btn sm', disabled: true, onclick: insert }, 'Baustein einfügen')
  const improve = el('button', { type: 'button', class: 'btn sm', onclick: generate }, 'Prompt verbessern')
  const feedback = el('p', { class: 'meta', role: 'status', hidden: true })
  const suggestion = el('textarea', { class: 'text-in influencer-prompt', rows: 4, maxlength: seedancePromptLimit })
  const apply = el('button', { type: 'button', class: 'btn sm', onclick: accept }, 'Vorschlag übernehmen')
  const preview = el('div', { class: 'pg-fields', hidden: true }, field('Verbesserter Vorschlag', suggestion),
    el('div', { class: 'pg-bar' }, apply, el('button', { type: 'button', class: 'btn sm', onclick: () => closePreview(true) }, 'Verwerfen')))
  const node = el('div', { class: 'pg-fields' },
    el('div', { class: 'pg-bar' }, improve, !canImprove && el('a', { class: 'meta', href: '#/anbieter' }, 'Textanbieter einrichten')),
    feedback, preview,
    el('details', { class: 'styler-more' }, el('summary', {}, 'Prompt-Bausteine'),
      el('div', { class: 'pg-fields' }, field('Baustein', snippet), el('div', { class: 'pg-bar' }, add,
        el('a', { class: 'meta', href: guide, target: '_blank', rel: 'noopener noreferrer' }, 'SeeGen-Prompt-Guide')))))
  let pending = false
  let draftContext
  let shownBlocks

  snippet.onchange = () => { add.disabled = !snippet.value }
  suggestion.oninput = () => { apply.disabled = !suggestion.value.trim() || suggestion.value.length > seedancePromptLimit }
  const signature = context => JSON.stringify([prompt.value, context])
  function message(text = '') {
    feedback.textContent = text
    feedback.hidden = !text
  }
  function closePreview(focus = false) {
    preview.hidden = true
    suggestion.value = ''
    draftContext = undefined
    if (focus) improve.focus()
  }
  function refresh(active) {
    node.hidden = !active
    if (!active) {
      if (!preview.hidden) closePreview()
      return
    }
    const context = seedance.promptContext()
    if (!preview.hidden && draftContext !== signature(context)) {
      closePreview()
      message('Eingaben geändert. Erstelle bei Bedarf einen neuen Vorschlag.')
    }
    improve.disabled = pending || !canImprove || !prompt.value.trim() || prompt.value.length > seedancePromptLimit
    const groups = blocks(context)
    const next = JSON.stringify(groups)
    if (next === shownBlocks) return
    shownBlocks = next
    const selected = snippet.value
    snippet.replaceChildren(el('option', { value: '' }, 'Baustein wählen'), ...groups.map(([label, options]) =>
      el('optgroup', { label }, options.map(([title, value]) => el('option', { value }, title)))))
    snippet.value = Array.from(snippet.options).some(option => option.value === selected) ? selected : ''
    add.disabled = !snippet.value
  }
  function insert() {
    const start = prompt.selectionStart
    const end = prompt.selectionEnd
    const addition = (start && prompt.value[start - 1] !== '\n' ? '\n' : '') + snippet.value +
      (end < prompt.value.length && prompt.value[end] !== '\n' ? '\n' : '')
    if (prompt.value.length - (end - start) + addition.length > seedancePromptLimit) return message('Der Szenenprompt ist zu lang.')
    prompt.focus()
    prompt.setRangeText(addition, start, end, 'end')
    message()
    update()
  }
  async function generate() {
    closePreview()
    const context = seedance.promptContext()
    const before = signature(context)
    const { mode, task, duration, audio, startFrame, endFrame, references, extensionDirection } = context
    const referenceCounts = Object.fromEntries(referenceKinds.map(([kind]) => [kind, references.filter(ref => ref.kind === kind).length]))
    pending = true
    update()
    message('Textmodell überarbeitet den Prompt …')
    try {
      const result = await request('/prompt/improve', { prompt: prompt.value, mode, task, duration, audio, extensionDirection, startFrame: Boolean(startFrame), endFrame: Boolean(endFrame), referenceCounts })
      if (node.hidden || before !== signature(seedance.promptContext())) {
        message('Eingaben geändert. Erstelle bei Bedarf einen neuen Vorschlag.')
        return
      }
      suggestion.value = result.prompt
      draftContext = before
      preview.hidden = false
      suggestion.oninput()
      message()
      suggestion.focus()
    } catch (error) {
      message(error.message)
    } finally {
      pending = false
      update()
    }
  }
  function accept() {
    if (draftContext !== signature(seedance.promptContext())) {
      closePreview(true)
      message('Eingaben geändert. Erstelle bei Bedarf einen neuen Vorschlag.')
      return
    }
    prompt.value = suggestion.value.trim()
    closePreview()
    update()
    prompt.focus()
  }
  return { node, refresh }
}
