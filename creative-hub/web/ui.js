// UI primitives the hub passes to app modules as `context.ui`.
const base = '/creativity-hub'

export function element(tag, content, className) {
  const node = document.createElement(tag)
  if (content) node.textContent = content
  if (className) node.className = className
  return node
}

export function icon(path, size = 16) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  for (const [key, value] of Object.entries({ width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(key, value)
  const shape = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  shape.setAttribute('d', path)
  svg.append(shape)
  return svg
}

export function iconButton(label, ariaLabel, onClick) {
  const button = element('button', label, 'icon-button')
  button.type = 'button'
  button.setAttribute('aria-label', ariaLabel)
  button.onclick = onClick
  return button
}

/**
 * Editable table. Calls `onChange(rows)` after a cell loses focus with a changed
 * value, after adding a row and after removing one.
 * @param {{ columns: { key: string, label: string, placeholder?: string }[], rows: object[], onChange(rows: object[]): void }} options
 */
export function rowsEditor({ columns, rows, onChange }) {
  let current = rows.map(row => ({ ...row }))
  const wrap = element('div', '', 'rows-editor')
  const table = element('table')
  const head = element('tr')
  for (const column of columns) head.append(element('th', column.label))
  head.append(element('th'))
  const thead = element('thead')
  thead.append(head)
  const body = element('tbody')
  table.append(thead, body)
  const add = element('button', '+ Zeile', 'ghost')
  add.type = 'button'
  add.onclick = () => { current = [...current, Object.fromEntries(columns.map(column => [column.key, '']))]; draw(); onChange(current); body.lastElementChild?.querySelector('input')?.focus() }
  function draw() {
    body.replaceChildren(...current.map((row, index) => {
      const tr = element('tr')
      for (const column of columns) {
        const td = element('td')
        const input = element('input')
        input.value = typeof row[column.key] === 'string' ? row[column.key] : ''
        input.placeholder = column.placeholder ?? ''
        input.setAttribute('aria-label', `${column.label}, Zeile ${index + 1}`)
        input.onchange = () => { current = current.map((other, i) => i === index ? { ...other, [column.key]: input.value } : other); onChange(current) }
        td.append(input)
        tr.append(td)
      }
      const td = element('td')
      td.append(iconButton('×', `Zeile ${index + 1} entfernen`, () => { current = current.filter((_, i) => i !== index); draw(); onChange(current) }))
      tr.append(td)
      return tr
    }))
  }
  draw()
  const scroll = element('div', '', 'table-scroll')
  scroll.append(table)
  wrap.append(scroll, add)
  return wrap
}

let lightboxActions = () => []

/** Sets the extra buttons the large view shows for an asset, e.g. remove background. */
export function setLightboxActions(fn) { lightboxActions = fn }

const mediaUrl = asset => asset.media_type ? base + '/api/media/' + asset.id : asset.preview
const shownAssets = new WeakMap()

/**
 * Media of a clip or generation: an `<img>`, a `<video>` or nothing. A click opens the large view
 * over every asset media in the same grid (the parent of the media's tile).
 */
export function assetMedia(asset) {
  if (!asset.media_type && !asset.preview) return null
  const video = asset.media_type?.startsWith('video/')
  const media = element(video ? 'video' : 'img')
  media.src = mediaUrl(asset)
  media.classList.add('zoomable')
  media.title = 'Groß anzeigen'
  shownAssets.set(media, asset)
  media.onclick = () => {
    const grid = media.closest('figure, article')?.parentElement
    const all = grid ? [...grid.querySelectorAll('.zoomable')].filter(node => shownAssets.has(node)) : [media]
    lightbox(all.map(node => shownAssets.get(node)), Math.max(0, all.indexOf(media)))
  }
  if (video) { media.muted = true; media.loop = true; media.preload = 'metadata'; media.onmouseenter = () => media.play(); media.onmouseleave = () => media.pause() }
  else { media.alt = ''; media.loading = 'lazy'; media.referrerPolicy = 'no-referrer' }
  return media
}

/** Small tile for an asset inside an idea, with an optional remove action. */
export function assetTile(asset, onRemove) {
  const tile = element('figure', '', 'asset-tile')
  const media = assetMedia(asset)
  if (media) tile.append(media)
  else tile.append(element('p', asset.description || asset.title, 'tile-text'))
  const caption = element('figcaption', asset.title)
  if (onRemove) caption.append(iconButton('×', asset.title + ' aus der Idee entfernen', onRemove))
  tile.append(caption)
  return tile
}

/**
 * Large view of assets in a modal dialog: ← → page, Esc closes, "Original" opens the file in a
 * new tab for zooming.
 * @param {object[]} assets assets with media, in grid order.
 * @param {number} index the asset shown first.
 */
export function lightbox(assets, index) {
  let dialog = document.getElementById('lightbox')
  if (!dialog) {
    dialog = element('dialog', '', 'lightbox')
    dialog.id = 'lightbox'
    dialog.setAttribute('aria-label', 'Großansicht')
    dialog.onclick = event => { if (event.target === dialog || event.target.classList.contains('lightbox-stage')) dialog.close() }
    document.body.append(dialog)
  }
  const show = position => {
    index = (position + assets.length) % assets.length
    const asset = assets[index]
    const head = element('header')
    head.append(element('h2', asset.title), element('span', assets.length > 1 ? `${index + 1} / ${assets.length}` : '', 'muted'))
    const original = element('a', 'Original', 'ghost')
    original.href = mediaUrl(asset)
    original.target = '_blank'
    original.rel = 'noreferrer'
    head.append(...lightboxActions(asset), original, iconButton('×', 'Großansicht schließen', () => dialog.close()))
    const stage = element('div', '', 'lightbox-stage')
    const video = asset.media_type?.startsWith('video/')
    const media = element(video ? 'video' : 'img')
    media.src = mediaUrl(asset)
    if (video) { media.controls = true; media.autoplay = true } else { media.alt = asset.title; media.referrerPolicy = 'no-referrer' }
    stage.append(media)
    if (assets.length > 1) stage.append(iconButton('‹', 'Vorheriges Bild', () => show(index - 1)), iconButton('›', 'Nächstes Bild', () => show(index + 1)))
    stage.children[1]?.classList.add('lightbox-prev')
    stage.children[2]?.classList.add('lightbox-next')
    const parts = [head, stage]
    if (asset.description) parts.push(element('p', asset.description, 'lightbox-detail'))
    dialog.replaceChildren(...parts)
  }
  dialog.onkeydown = event => {
    if (event.key === 'ArrowLeft') { event.preventDefault(); show(index - 1) }
    if (event.key === 'ArrowRight') { event.preventDefault(); show(index + 1) }
  }
  show(index)
  if (!dialog.open) dialog.showModal()
}
