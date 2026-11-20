const editableImages = new Set(['image/jpeg', 'image/png', 'image/webp'])

export const canEditImage = item => editableImages.has(item.media_type)
export const formatSize = bytes => {
  const unit = bytes >= 1024 ** 2 ? 'MiB' : bytes >= 1024 ? 'KiB' : 'B'
  const divisor = unit === 'MiB' ? 1024 ** 2 : unit === 'KiB' ? 1024 : 1
  return (bytes / divisor).toLocaleString('de-DE', { maximumFractionDigits: 1 }) + ' ' + unit
}

function hasAnimation(bytes, type) {
  const view = new DataView(bytes)
  if (type === 'image/png') {
    for (let offset = 8; offset + 12 <= view.byteLength;) {
      const chunk = view.getUint32(offset + 4)
      if (chunk === 0x6163544c) return true // acTL
      if (chunk === 0x49444154) return false // IDAT
      offset += 12 + view.getUint32(offset)
    }
  }
  return type === 'image/webp' && view.byteLength > 20 &&
    view.getUint32(12) === 0x56503858 && (view.getUint8(20) & 2) !== 0
}

async function loadImage(url) {
  const source = new URL(url, location.origin)
  source.searchParams.set('edit', '1')
  const response = await fetch(source)
  if (!response.ok) throw new Error('Das Bild konnte nicht geladen werden.')
  const image = new Image()
  const blob = await response.blob()
  if (hasAnimation(await blob.arrayBuffer(), blob.type)) throw new Error('Dieses Bild ist animiert. Beim Bearbeiten gingen die Einzelbilder verloren.')
  const objectUrl = URL.createObjectURL(blob)
  image.src = objectUrl
  try {
    await image.decode()
    return { image, type: blob.type, tag: response.headers.get('ETag'), release: () => URL.revokeObjectURL(objectUrl) }
  } catch (error) {
    URL.revokeObjectURL(objectUrl)
    throw new Error('Das Bild konnte nicht gelesen werden.', { cause: error })
  }
}

function encodeImage(image, region, size, type, quality) {
  const canvas = document.createElement('canvas')
  canvas.width = size.width
  canvas.height = size.height
  canvas.getContext('2d').drawImage(image, region.x, region.y, region.width, region.height, 0, 0, size.width, size.height)
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (!blob) return reject(new Error('Das bearbeitete Bild konnte nicht erstellt werden.'))
      if (blob.size > 12 * 1024 ** 2) return reject(new Error('Das bearbeitete Bild überschreitet 12 MiB. Wähle einen kleineren Ausschnitt.'))
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result).split(',')[1])
      reader.onerror = () => reject(new Error('Die Bilddatei konnte nicht gelesen werden.'))
      reader.readAsDataURL(blob)
    }, type, quality)
  })
}

export async function reduceImage(url, save) {
  const file = await loadImage(url)
  try {
    const { naturalWidth: width, naturalHeight: height } = file.image
    const scale = Math.min(1, 1600 / Math.max(width, height))
    const region = { x: 0, y: 0, width, height }
    const size = { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
    const media = await encodeImage(file.image, region, size, 'image/webp', 0.82)
    return await save({ tag: file.tag, action: 'reduce', media })
  } finally {
    file.release()
  }
}

export async function cropImage(url, title, { el, save }) {
  const file = await loadImage(url)
  const { image, type, tag } = file
  const { naturalWidth: width, naturalHeight: height } = image
  image.alt = title
  image.draggable = false
  const overlay = el('div', { class: 'crop-outline', hidden: true, 'aria-hidden': 'true' })
  const stage = el('div', { class: 'crop-stage' }, image, overlay)
  const status = el('p', { class: 'meta', role: 'status' })
  const apply = el('button', { class: 'btn primary', type: 'submit', disabled: true }, 'Zuschnitt speichern')
  const cancel = el('button', { class: 'btn', type: 'button' }, 'Abbrechen')
  const numeric = [
    ['x', 'Links', width - 1], ['y', 'Oben', height - 1],
    ['width', 'Breite', width], ['height', 'Höhe', height],
  ]
  const inputs = Object.fromEntries(numeric.map(([key, , max]) => [key, el('input', {
    type: 'number', class: 'text-in', min: key === 'x' || key === 'y' ? 0 : 1, max, step: 1,
  })]))
  let selection = { x: 0, y: 0, width, height }
  let start, pointer, result, saving = false
  function draw() {
    for (const [key, input] of Object.entries(inputs)) input.value = selection[key]
    const full = selection.width === width && selection.height === height
    overlay.hidden = full
    overlay.style.left = 100 * selection.x / width + '%'
    overlay.style.top = 100 * selection.y / height + '%'
    overlay.style.width = 100 * selection.width / width + '%'
    overlay.style.height = 100 * selection.height / height + '%'
    apply.disabled = saving || full || !selection.width || !selection.height
  }
  for (const [key, input] of Object.entries(inputs)) input.addEventListener('change', () => {
    const value = input.valueAsNumber
    if (Number.isFinite(value)) {
      selection[key] = Math.max(Number(input.min), Math.min(Number(input.max), Math.round(value)))
      selection.width = Math.min(selection.width || 1, width - selection.x)
      selection.height = Math.min(selection.height || 1, height - selection.y)
    }
    draw()
  })
  function point(event) {
    const bounds = image.getBoundingClientRect()
    const pixel = (value, max) => Math.round(Math.max(0, Math.min(1, value)) * max)
    return { x: pixel((event.clientX - bounds.x) / bounds.width, width), y: pixel((event.clientY - bounds.y) / bounds.height, height) }
  }
  stage.addEventListener('pointerdown', event => {
    if (saving || pointer !== undefined || event.button !== 0) return
    event.preventDefault()
    start = point(event)
    pointer = event.pointerId
    stage.setPointerCapture(pointer)
  })
  function drag(event) {
    if (event.pointerId !== pointer) return
    const end = point(event)
    const next = { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y),
      width: Math.abs(start.x - end.x), height: Math.abs(start.y - end.y) }
    if (next.width && next.height) { selection = next; draw() }
  }
  stage.addEventListener('pointermove', drag)
  stage.addEventListener('pointerup', event => { if (event.pointerId === pointer) { drag(event); pointer = undefined } })
  stage.addEventListener('lostpointercapture', () => { pointer = undefined })
  const form = el('form', {},
    el('h2', { id: 'crop-title' }, 'Bild zuschneiden'),
    el('p', { class: 'meta' }, 'Ziehe einen Rahmen auf dem Bild auf. Beim Speichern ersetzt der Ausschnitt die gespeicherte Datei.'),
    stage,
    el('div', { class: 'crop-fields' }, numeric.map(([key, label]) => el('label', { class: 'field' }, el('span', {}, label + ' (px)'), inputs[key]))),
    status, el('div', { class: 'row' }, cancel, apply))
  const dialog = el('dialog', { class: 'crop-editor', 'aria-labelledby': 'crop-title' }, form)
  const closed = new Promise(resolve => dialog.addEventListener('close', () => {
    file.release()
    dialog.remove()
    resolve(result)
  }, { once: true }))
  cancel.onclick = () => dialog.close()
  dialog.addEventListener('cancel', event => { if (saving) event.preventDefault() })
  form.addEventListener('submit', async event => {
    event.preventDefault()
    if (apply.disabled) return
    saving = true
    apply.disabled = cancel.disabled = true
    for (const input of Object.values(inputs)) input.disabled = true
    status.textContent = 'Speichert …'
    try {
      const media = await encodeImage(image, selection, selection, type, 0.94)
      result = await save({ tag, action: 'crop', media })
      dialog.close()
    } catch (error) {
      status.textContent = error.message
      saving = false
      cancel.disabled = false
      for (const input of Object.values(inputs)) input.disabled = false
      draw()
    }
  })
  draw()
  document.body.append(dialog)
  dialog.showModal()
  return closed
}
