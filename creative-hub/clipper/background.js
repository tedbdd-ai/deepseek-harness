// Atelier Clipper: saves images, pages, selections and links straight into Mymind (library "clips").
// Requests go to the hub's token route `/creativity-launcher/api/`. In Safari the token comes from the
// containing app (native message; the app reads ~/.creativity-hub/launcher-token), elsewhere from the
// options page. The popup reaches everything here through runtime messages.
const ext = globalThis.browser ?? globalThis.chrome
const allowedTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
const maxBytes = 12 * 1024 * 1024
let nativeToken = ''

const menus = [
  ['atelier-image', 'Bild ins Atelier', ['image']],
  ['atelier-page', 'Seite ins Atelier (Screenshot)', ['page']],
  ['atelier-selection', 'Auswahl ins Atelier', ['selection']],
  ['atelier-link', 'Link ins Atelier', ['link']],
]

ext.runtime.onInstalled.addListener(() => {
  ext.contextMenus.removeAll(() => {
    for (const [id, title, contexts] of menus) ext.contextMenus.create({ id, title, contexts })
  })
})

/** The hub token: typed into the options, else read by the Safari app. */
async function token() {
  const { token: typed = '' } = await ext.storage.local.get('token')
  if (typed) return typed
  if (nativeToken) return nativeToken
  try {
    const answer = await ext.runtime.sendNativeMessage('local.atelier.clipper', { type: 'token' })
    nativeToken = typeof answer?.token === 'string' ? answer.token.trim() : ''
    if (!nativeToken && answer?.error) throw new Error(answer.error)
  } catch (error) {
    throw new Error('Kein Hub-Schlüssel. ' + (error.message || '') + ' Trag ihn in den Einstellungen der Erweiterung ein.')
  }
  if (!nativeToken) throw new Error('Kein Hub-Schlüssel. Starte den Hub einmal, er legt ~/.creativity-hub/launcher-token an.')
  return nativeToken
}

async function hubFetch(path, method = 'GET', body) {
  const { port = 3080 } = await ext.storage.local.get('port')
  let response
  try {
    response = await fetch(`http://127.0.0.1:${port}/creativity-launcher/api/${path}`, {
      method,
      headers: { Authorization: 'Bearer ' + await token(), ...(body && { 'Content-Type': 'application/json' }) },
      ...(body && { body: JSON.stringify(body) }),
    })
  } catch {
    throw new Error(`Der Hub antwortet nicht auf Port ${port}. Läuft start.command?`)
  }
  const result = await response.json().catch(() => ({}))
  if (response.status === 401) nativeToken = ''
  if (!response.ok) throw new Error(result.error || `Der Hub meldet HTTP ${response.status}.`)
  return result
}

function base64(buffer) {
  const bytes = new Uint8Array(buffer)
  let text = ''
  for (let index = 0; index < bytes.length; index += 0x8000) text += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  return btoa(text)
}

/** Downloads an image; formats the hub does not store (AVIF, SVG, …) are converted to PNG. */
async function imagePayload(src) {
  if (!/^(https?|data):/i.test(src ?? '')) throw new Error('Dieses Bild hat keine ladbare Adresse.')
  const response = await fetch(src, { credentials: 'include' }).catch(() => null)
  if (!response?.ok) throw new Error('Das Bild ließ sich nicht laden.')
  let blob = await response.blob()
  if (!allowedTypes.includes(blob.type)) {
    try {
      const bitmap = await createImageBitmap(blob)
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
      canvas.getContext('2d').drawImage(bitmap, 0, 0)
      blob = await canvas.convertToBlob({ type: 'image/png' })
    } catch {
      throw new Error(`Das Format ${blob.type || 'unbekannt'} kann ich nicht umwandeln.`)
    }
  }
  if (blob.size > maxBytes) throw new Error('Das Bild ist größer als 12 MB.')
  return { media: base64(await blob.arrayBuffer()), mediaType: blob.type }
}

/** Title, description, og:image and selection of the page, read in the tab. */
async function pageInfo(tabId) {
  const [result] = await ext.scripting.executeScript({
    target: { tabId },
    func: () => {
      const meta = key => document.querySelector(`meta[property="${key}"],meta[name="${key}"]`)?.content || ''
      let image = ''
      try { image = meta('og:image') ? new URL(meta('og:image'), location.href).href : '' } catch { image = '' }
      return { title: meta('og:title') || document.title, description: meta('og:description') || meta('description'), image, selection: String(getSelection() || '') }
    },
  })
  return result?.result ?? {}
}

/** Images of the page at least 120 px wide or tall, og:image first, without duplicates. */
async function pageImages(tabId) {
  const [result] = await ext.scripting.executeScript({
    target: { tabId },
    func: () => {
      const found = new Map()
      const add = (src, width, height, alt) => { if (src && /^(https?|data):/.test(src) && !found.has(src)) found.set(src, { src, width, height, alt }) }
      const og = document.querySelector('meta[property="og:image"]')?.content
      if (og) try { add(new URL(og, location.href).href, 0, 0, 'Vorschaubild der Seite') } catch {}
      for (const img of document.images) if (Math.max(img.naturalWidth, img.naturalHeight) >= 120) add(img.currentSrc || img.src, img.naturalWidth, img.naturalHeight, img.alt)
      return [...found.values()].slice(0, 120)
    },
  })
  return result?.result ?? []
}

async function target() {
  const { ideaId = '' } = await ext.storage.local.get('ideaId')
  return ideaId ? { projectId: ideaId } : {}
}

const hostOf = url => { try { return new URL(url).hostname } catch { return '' } }
const httpOnly = url => (/^https?:\/\//i.test(url ?? '') ? url.slice(0, 4096) : '')

async function saveImage(src, pageUrl, title) {
  return hubFetch('assets', 'POST', {
    library: 'clips', title: (title || hostOf(pageUrl) || 'Bild').slice(0, 200),
    source: httpOnly(pageUrl), preview: httpOnly(src), ...(await imagePayload(src)), ...(await target()),
  })
}

async function savePage(tab) {
  const info = await pageInfo(tab.id).catch(() => ({}))
  const shot = await ext.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 85 })
  return hubFetch('assets', 'POST', {
    library: 'clips', title: (info.title || tab.title || hostOf(tab.url) || 'Seite').slice(0, 200),
    source: httpOnly(tab.url), preview: httpOnly(info.image),
    description: (info.selection || info.description || '').slice(0, 4000),
    media: shot.split(',')[1], mediaType: 'image/jpeg', ...(await target()),
  })
}

async function saveText(tab, text) {
  return hubFetch('assets', 'POST', { library: 'clips', title: (tab.title || text).slice(0, 200), source: httpOnly(tab.url), description: text.slice(0, 4000), ...(await target()) })
}

async function saveLink(url, text) {
  return hubFetch('assets', 'POST', { library: 'clips', title: (text || hostOf(url) || url).slice(0, 200), source: httpOnly(url), ...(await target()) })
}

function setBadge(text, color) {
  ext.action.setBadgeBackgroundColor?.({ color })
  ext.action.setBadgeText({ text })
  setTimeout(() => ext.action.setBadgeText({ text: '' }), 2500)
}

/** Runs a context-menu save and reports it on the toolbar badge; the popup shows the last error. */
async function report(work) {
  try {
    await work()
    await ext.storage.local.set({ lastError: '' })
    setBadge('✓', '#22C55E')
  } catch (error) {
    await ext.storage.local.set({ lastError: error.message })
    setBadge('!', '#EF4444')
  }
}

ext.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab) return
  if (info.menuItemId === 'atelier-image') report(() => saveImage(info.srcUrl, info.pageUrl || tab.url, tab.title))
  if (info.menuItemId === 'atelier-page') report(() => savePage(tab))
  if (info.menuItemId === 'atelier-selection') report(() => saveText(tab, info.selectionText || ''))
  if (info.menuItemId === 'atelier-link') report(() => saveLink(info.linkUrl, info.linkText || info.selectionText))
})

ext.runtime.onMessage.addListener((message, sender, reply) => {
  const run = async () => {
    switch (message.type) {
      case 'ideas': return hubFetch('projects')
      case 'images': return pageImages(message.tab.id)
      case 'savePage': return savePage(message.tab)
      case 'saveImage': return saveImage(message.src, message.pageUrl, message.title)
      case 'ping': return hubFetch('projects').then(list => ({ ideas: list.length }))
      default: throw new Error('Unbekannte Aktion.')
    }
  }
  run().then(result => reply({ ok: true, result }), error => reply({ ok: false, error: error.message }))
  return true
})
